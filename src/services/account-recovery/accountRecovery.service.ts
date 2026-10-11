import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizePhoneNumber } from "../../lib/sms/apitxt.js";
import type {
  AccountRecoveryServiceOptions,
  CreateRecoveryChallengeInput,
  CreateRecoveryRequestInput,
  RecoveryChannel,
  RecoveryFactor,
  VerifyRecoveryChallengeInput,
} from "./accountRecovery.types.js";

export const RECOVERY_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const RECOVERY_REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RECOVERY_HOLD_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CHALLENGE_ATTEMPTS = 5;

type Database = PrismaClient | Prisma.TransactionClient;

export class AccountRecoveryError extends Error {
  constructor(
    readonly code:
      | "CHALLENGE_INVALID"
      | "CHALLENGE_EXPIRED"
      | "CHALLENGE_CONSUMED"
      | "REQUEST_NOT_FOUND"
      | "REQUEST_NOT_CANCELLABLE"
      | "REQUEST_NOT_REVIEWABLE"
      | "DESTINATION_ALREADY_LINKED",
    message: string,
  ) {
    super(message);
    this.name = "AccountRecoveryError";
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Owns the durable recovery lifecycle. HTTP routes deliberately expose only a
 * subset of this service, keeping OTP delivery and support-review UI separate
 * from state transitions that affect an account's sign-in factors.
 */
export class AccountRecoveryService {
  private readonly secret: string;
  private readonly getNow: () => Date;
  private readonly getCode: () => string;

  constructor(
    private readonly db: PrismaClient,
    options: AccountRecoveryServiceOptions = {},
  ) {
    this.secret = options.hmacSecret || process.env.BETTER_AUTH_SECRET || "recovery-development-secret";
    this.getNow = options.now || (() => new Date());
    this.getCode = options.generateCode || (() => crypto.randomInt(100000, 1_000_000).toString());
  }

  private hash(namespace: string, value: string): string {
    return crypto
      .createHmac("sha256", this.secret)
      .update(`${namespace}:${value}`)
      .digest("hex");
  }

  private normalize(channel: RecoveryChannel, value: string): string {
    const trimmed = value.trim();
    if (channel === "EMAIL") return trimmed.toLowerCase();
    return normalizePhoneNumber(trimmed);
  }

  private channelForLookup(lookup: string): RecoveryChannel {
    return lookup.includes("@") ? "EMAIL" : "PHONE";
  }

  private publicRequest(request: {
    id: string;
    status: string;
    releaseAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: request.id,
      status: request.status,
      releaseAt: request.releaseAt,
      createdAt: request.createdAt,
    };
  }

  async createChallenge(input: CreateRecoveryChallengeInput) {
    const now = this.getNow();
    const value = this.normalize(input.channel, input.value);
    const challengeToken = crypto.randomBytes(32).toString("base64url");
    const code = this.getCode();
    const expiresAt = new Date(now.getTime() + RECOVERY_CHALLENGE_TTL_MS);

    await this.db.accountRecoveryChallenge.create({
      data: {
        tokenHash: this.hash("challenge-token", challengeToken),
        destinationHash: this.hash("destination", value),
        channel: input.channel,
        purpose: input.purpose,
        codeHash: this.hash("challenge-code", `${challengeToken}:${code}`),
        expiresAt,
      },
    });

    // The caller that delivers an OTP can use this ephemeral value; public
    // routes must never put it in an HTTP response or persistent log.
    return { challengeToken, code, expiresAt };
  }

  async verifyChallenge(input: VerifyRecoveryChallengeInput) {
    const tokenHash = this.hash("challenge-token", input.challengeToken);
    const challenge = await this.db.accountRecoveryChallenge.findUnique({ where: { tokenHash } });
    if (!challenge) {
      throw new AccountRecoveryError("CHALLENGE_INVALID", "The verification code is invalid.");
    }
    if (challenge.expiresAt <= this.getNow()) {
      throw new AccountRecoveryError("CHALLENGE_EXPIRED", "The verification code has expired.");
    }
    if (challenge.consumedAt || challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
      throw new AccountRecoveryError("CHALLENGE_CONSUMED", "Request a new verification code.");
    }
    if (!constantTimeEqual(challenge.codeHash, this.hash("challenge-code", `${input.challengeToken}:${input.code.trim()}`))) {
      await this.db.accountRecoveryChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AccountRecoveryError("CHALLENGE_INVALID", "The verification code is invalid.");
    }

    await this.db.accountRecoveryChallenge.update({
      where: { id: challenge.id },
      data: { verifiedAt: this.getNow() },
    });
    return { challengeToken: input.challengeToken };
  }

  async createRequest(input: CreateRecoveryRequestInput) {
    const now = this.getNow();
    const lookupChannel = this.channelForLookup(input.lookup);
    const lookup = this.normalize(lookupChannel, input.lookup);
    const destinationValue = this.normalize(input.destination.channel, input.destination.value);
    const challengeTokenHash = this.hash("challenge-token", input.destination.challengeToken);
    const destinationHash = this.hash("destination", destinationValue);

    const [challenge, resolvedUser] = await Promise.all([
      this.db.accountRecoveryChallenge.findUnique({ where: { tokenHash: challengeTokenHash } }),
      lookupChannel === "EMAIL"
        ? this.db.user.findUnique({ where: { email: lookup }, select: { id: true } })
        : this.db.user.findUnique({ where: { phone: lookup }, select: { id: true } }),
    ]);

    if (
      !challenge ||
      !challenge.verifiedAt ||
      challenge.consumedAt ||
      challenge.expiresAt <= now ||
      challenge.purpose !== "RECOVERY_DESTINATION" ||
      challenge.channel !== input.destination.channel ||
      !constantTimeEqual(challenge.destinationHash, destinationHash)
    ) {
      throw new AccountRecoveryError("CHALLENGE_INVALID", "Verify the replacement destination first.");
    }

    const receiptToken = crypto.randomBytes(32).toString("base64url");
    const request = await this.db.$transaction(async (tx) => {
      const created = await tx.accountRecoveryRequest.create({
        data: {
          userId: resolvedUser?.id,
          lookupHash: this.hash("lookup", lookup),
          destinationChannel: input.destination.channel,
          destinationValue,
          destinationHash,
          receiptTokenHash: this.hash("receipt", receiptToken),
          challengeId: challenge.id,
          explanation: input.explanation?.trim() || null,
          expiresAt: new Date(now.getTime() + RECOVERY_REQUEST_TTL_MS),
        },
      });

      await tx.accountRecoveryChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: now },
      });

      if (resolvedUser) {
        await tx.accountSecurityEvent.create({
          data: {
            userId: resolvedUser.id,
            requestId: created.id,
            type: "RECOVERY_REQUESTED",
          },
        });
      }
      return created;
    });

    return { ...this.publicRequest(request), receiptToken };
  }

  async getReceiptStatus(requestId: string, receiptToken: string) {
    const request = await this.db.accountRecoveryRequest.findUnique({ where: { id: requestId } });
    if (!request || !constantTimeEqual(request.receiptTokenHash, this.hash("receipt", receiptToken))) {
      throw new AccountRecoveryError("REQUEST_NOT_FOUND", "Recovery request not found.");
    }
    return this.publicRequest(request);
  }

  async review(
    requestId: string,
    reviewerId: string,
    decision: "APPROVE" | "REJECT" | "NEEDS_INFO",
    options: { retireFactors?: RecoveryFactor[]; note?: string } = {},
  ) {
    if (decision === "APPROVE") {
      return this.approve(requestId, reviewerId, options.retireFactors || [], options.note);
    }

    const now = this.getNow();
    const status = decision === "REJECT" ? "REJECTED" : "NEEDS_INFO";
    const result = await this.db.accountRecoveryRequest.updateMany({
      where: { id: requestId, status: "PENDING_REVIEW" },
      data: {
        status,
        reviewerId,
        reviewerNote: options.note?.trim() || null,
        rejectedAt: decision === "REJECT" ? now : null,
      },
    });
    if (!result.count) {
      throw new AccountRecoveryError("REQUEST_NOT_REVIEWABLE", "This recovery request cannot be reviewed.");
    }
    return this.db.accountRecoveryRequest.findUniqueOrThrow({ where: { id: requestId } });
  }

  async approve(
    requestId: string,
    reviewerId: string,
    retireFactors: RecoveryFactor[],
    note?: string,
  ) {
    const now = this.getNow();
    const releaseAt = new Date(now.getTime() + RECOVERY_HOLD_MS);
    const result = await this.db.accountRecoveryRequest.updateMany({
      where: { id: requestId, status: { in: ["PENDING_REVIEW", "NEEDS_INFO"] } },
      data: {
        status: "APPROVED",
        reviewerId,
        reviewerNote: note?.trim() || null,
        retireFactors,
        approvedAt: now,
        releaseAt,
        lastError: null,
      },
    });
    if (!result.count) {
      throw new AccountRecoveryError("REQUEST_NOT_REVIEWABLE", "This recovery request cannot be approved.");
    }
    const request = await this.db.accountRecoveryRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (request.userId) {
      await this.db.accountSecurityEvent.create({
        data: {
          userId: request.userId,
          requestId,
          actorUserId: reviewerId,
          type: "RECOVERY_APPROVED",
          metadata: { releaseAt: releaseAt.toISOString(), retireFactors },
        },
      });
    }
    return request;
  }

  async cancelByAuthenticatedUser(requestId: string, userId: string) {
    const now = this.getNow();
    const result = await this.db.accountRecoveryRequest.updateMany({
      where: {
        id: requestId,
        userId,
        status: { in: ["PENDING_REVIEW", "NEEDS_INFO", "APPROVED"] },
      },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    if (!result.count) {
      throw new AccountRecoveryError("REQUEST_NOT_CANCELLABLE", "This recovery request cannot be cancelled.");
    }
    await this.db.accountSecurityEvent.create({
      data: { userId, requestId, actorUserId: userId, type: "RECOVERY_CANCELLED" },
    });
    return this.db.accountRecoveryRequest.findUniqueOrThrow({ where: { id: requestId } });
  }

  private async completeClaimedRequest(tx: Database, requestId: string, now: Date) {
    const request = await tx.accountRecoveryRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== "PROCESSING") return false;

    if (!request.userId) {
      await tx.accountRecoveryRequest.update({
        where: { id: request.id },
        data: { status: "COMPLETED", completedAt: now, lastError: null },
      });
      return true;
    }

    const conflict = request.destinationChannel === "EMAIL"
      ? await tx.user.findFirst({ where: { email: request.destinationValue, NOT: { id: request.userId } }, select: { id: true } })
      : await tx.user.findFirst({ where: { phone: request.destinationValue, NOT: { id: request.userId } }, select: { id: true } });
    if (conflict) {
      throw new AccountRecoveryError("DESTINATION_ALREADY_LINKED", "The replacement factor belongs to another account.");
    }

    await tx.session.deleteMany({ where: { userId: request.userId } });
    if (request.retireFactors.includes("PASSKEY")) {
      await tx.passkey.deleteMany({ where: { userId: request.userId } });
    }
    if (request.retireFactors.includes("OAUTH")) {
      await tx.account.deleteMany({
        where: { userId: request.userId, providerId: { in: ["google", "apple"] } },
      });
    }

    const userData = request.destinationChannel === "EMAIL"
      ? { email: request.destinationValue, emailVerified: true }
      : { phone: request.destinationValue, phoneVerified: true };
    await tx.user.update({ where: { id: request.userId }, data: userData });
    await tx.accountRecoveryRequest.update({
      where: { id: request.id },
      data: { status: "COMPLETED", completedAt: now, lastError: null },
    });
    await tx.accountSecurityEvent.create({
      data: {
        userId: request.userId,
        requestId: request.id,
        type: "RECOVERY_COMPLETED",
        metadata: { destinationChannel: request.destinationChannel, retireFactors: request.retireFactors },
      },
    });
    return true;
  }

  async completeDueRequests(now = this.getNow()) {
    const candidates = await this.db.accountRecoveryRequest.findMany({
      where: { status: "APPROVED", releaseAt: { lte: now }, expiresAt: { gt: now } },
      select: { id: true },
      take: 100,
    });
    let completed = 0;
    let retried = 0;

    for (const candidate of candidates) {
      const claim = await this.db.accountRecoveryRequest.updateMany({
        where: { id: candidate.id, status: "APPROVED", releaseAt: { lte: now } },
        data: { status: "PROCESSING" },
      });
      if (!claim.count) continue;

      try {
        if (await this.db.$transaction((tx) => this.completeClaimedRequest(tx, candidate.id, now))) {
          completed += 1;
        }
      } catch (error) {
        retried += 1;
        await this.db.accountRecoveryRequest.updateMany({
          where: { id: candidate.id, status: "PROCESSING" },
          data: {
            status: "APPROVED",
            lastError: error instanceof Error ? error.message.slice(0, 1000) : "Recovery completion failed.",
          },
        });
      }
    }

    await this.db.accountRecoveryRequest.updateMany({
      where: { status: { in: ["PENDING_REVIEW", "NEEDS_INFO", "APPROVED"] }, expiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });
    return { completed, retried };
  }
}
