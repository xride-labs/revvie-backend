import { afterEach, beforeEach, describe, expect, it } from "vitest";
import prisma from "../../lib/prisma.js";
import { createTestUser, cleanupTestData } from "../../test/utils.js";
import {
  AccountRecoveryService,
  RECOVERY_HOLD_MS,
} from "./accountRecovery.service.js";

describe("AccountRecoveryService", () => {
  const service = new AccountRecoveryService(prisma, {
    hmacSecret: "account-recovery-test-secret",
    generateCode: () => "123456",
  });

  beforeEach(async () => {
    await prisma.accountSecurityEvent.deleteMany();
    await prisma.accountRecoveryRequest.deleteMany();
    await prisma.accountRecoveryChallenge.deleteMany();
  });

  afterEach(async () => {
    await prisma.accountSecurityEvent.deleteMany();
    await prisma.accountRecoveryRequest.deleteMany();
    await prisma.accountRecoveryChallenge.deleteMany();
    await cleanupTestData();
  });

  async function createVerifiedEmailChallenge(email: string) {
    const challenge = await service.createChallenge({
      channel: "EMAIL",
      value: email,
      purpose: "RECOVERY_DESTINATION",
    });

    return service.verifyChallenge({
      challengeToken: challenge.challengeToken,
      code: challenge.code,
    });
  }

  it("creates an opaque receipt for a verified replacement destination", async () => {
    const challenge = await createVerifiedEmailChallenge("new@example.test");

    const result = await service.createRequest({
      lookup: "nobody@example.test",
      destination: {
        channel: "EMAIL",
        value: "new@example.test",
        challengeToken: challenge.challengeToken,
      },
      explanation: "Lost access while changing phones.",
    });

    expect(result.status).toBe("PENDING_REVIEW");
    expect(result.receiptToken).toEqual(expect.any(String));
    expect(result.receiptToken).not.toContain("new@example.test");

    const request = await prisma.accountRecoveryRequest.findUnique({
      where: { id: result.id },
    });
    expect(request).toMatchObject({
      status: "PENDING_REVIEW",
      destinationChannel: "EMAIL",
      destinationValue: "new@example.test",
    });
    expect(request?.receiptTokenHash).not.toBe(result.receiptToken);
  });

  it("does not complete a cancelled request", async () => {
    const { user: originalUser } = await createTestUser();
    const { user: reviewer } = await createTestUser();
    const challenge = await createVerifiedEmailChallenge("replacement@example.test");
    const request = await service.createRequest({
      lookup: originalUser.email!,
      destination: {
        channel: "EMAIL",
        value: "replacement@example.test",
        challengeToken: challenge.challengeToken,
      },
      explanation: "Lost every sign-in method.",
    });

    await service.approve(request.id, reviewer.id, ["EMAIL", "PHONE", "OAUTH", "PASSKEY"]);
    await service.cancelByAuthenticatedUser(request.id, originalUser.id);
    await service.completeDueRequests(new Date(Date.now() + RECOVERY_HOLD_MS + 1));

    await expect(
      prisma.accountRecoveryRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: originalUser.id } }),
    ).resolves.toMatchObject({ email: originalUser.email });
  });

  it("completes an approved request once and revokes its active sessions", async () => {
    const { user: originalUser } = await createTestUser();
    const { user: reviewer } = await createTestUser();
    await prisma.session.create({
      data: {
        userId: originalUser.id,
        token: `recovery-session-${originalUser.id}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const challenge = await createVerifiedEmailChallenge("safe@example.test");
    const request = await service.createRequest({
      lookup: originalUser.email!,
      destination: {
        channel: "EMAIL",
        value: "safe@example.test",
        challengeToken: challenge.challengeToken,
      },
      explanation: "I lost both my phone and my email inbox.",
    });

    const approved = await service.approve(request.id, reviewer.id, ["EMAIL", "PASSKEY"]);
    await service.completeDueRequests(new Date(approved.releaseAt.getTime() + 1));
    await service.completeDueRequests(new Date(approved.releaseAt.getTime() + 1));

    await expect(
      prisma.accountRecoveryRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(prisma.session.count({ where: { userId: originalUser.id } })).resolves.toBe(0);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: originalUser.id } }),
    ).resolves.toMatchObject({ email: "safe@example.test", emailVerified: true });
  });
});
