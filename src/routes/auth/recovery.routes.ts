import { Router, Request, Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma.js";
import { requireAuth } from "../../config/auth.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { asyncHandler, validateBody } from "../../middlewares/validation.js";
import {
  AccountRecoveryError,
  AccountRecoveryService,
} from "../../services/account-recovery/accountRecovery.service.js";
import { deliverRecoveryCode } from "../../services/account-recovery/accountRecovery.delivery.js";

export const accountRecoveryService = new AccountRecoveryService(prisma);

const CHALLENGE_SENT_MESSAGE =
  "If this destination can receive codes, a verification code is on its way.";
const REQUEST_ACCEPTED_MESSAGE =
  "Your recovery request was received. Our team will review it and contact you at the verified destination.";

const channelSchema = z.enum(["EMAIL", "PHONE"]);
const destinationValueSchema = z.string().trim().min(3).max(254);
const codeSchema = z.string().trim().length(6).regex(/^\d+$/);

const challengeBodySchema = z.object({
  channel: channelSchema,
  value: destinationValueSchema,
});
const verifyBodySchema = z.object({
  challengeToken: z.string().min(20).max(200),
  code: codeSchema,
});
const requestBodySchema = z.object({
  lookup: z.string().trim().min(3).max(254),
  destination: z.object({
    channel: channelSchema,
    value: destinationValueSchema,
    challengeToken: z.string().min(20).max(200),
  }),
  explanation: z.string().trim().max(1000).optional(),
});
const factorBodySchema = z.object({ value: destinationValueSchema });
const factorVerifyBodySchema = factorBodySchema.merge(verifyBodySchema);

const ERROR_STATUS: Record<AccountRecoveryError["code"], number> = {
  CHALLENGE_INVALID: 400,
  CHALLENGE_EXPIRED: 400,
  CHALLENGE_CONSUMED: 400,
  REQUEST_NOT_FOUND: 404,
  REQUEST_NOT_CANCELLABLE: 409,
  REQUEST_NOT_REVIEWABLE: 409,
  DESTINATION_ALREADY_LINKED: 409,
  RATE_LIMITED: 429,
};

function sendRecoveryError(res: Response, error: unknown): void {
  if (error instanceof AccountRecoveryError) {
    const code = error.code === "DESTINATION_ALREADY_LINKED" ? "FACTOR_ALREADY_LINKED" : error.code;
    return ApiResponse.error(res, error.message, ERROR_STATUS[error.code], code);
  }
  throw error;
}

function parseChannel(value: string): "EMAIL" | "PHONE" | null {
  const upper = value.toUpperCase();
  return upper === "EMAIL" || upper === "PHONE" ? upper : null;
}

function accepted(res: Response, data: unknown, message: string): void {
  res.status(202).json({ success: true, message, data });
}

/** Public endpoints, mounted at /api/auth/recovery (behind the auth limiter). */
export const publicRecoveryRouter = Router();

publicRecoveryRouter.post(
  "/challenge",
  validateBody(challengeBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { channel, value } = req.body;
    try {
      const challenge = await accountRecoveryService.createChallenge({
        channel,
        value,
        purpose: "RECOVERY_DESTINATION",
      });
      await deliverRecoveryCode(channel, value, challenge.code);
      accepted(
        res,
        { challengeToken: challenge.challengeToken, expiresAt: challenge.expiresAt },
        CHALLENGE_SENT_MESSAGE,
      );
    } catch (error) {
      sendRecoveryError(res, error);
    }
  }),
);

publicRecoveryRouter.post(
  "/challenge/verify",
  validateBody(verifyBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      await accountRecoveryService.verifyChallenge(req.body);
      ApiResponse.success(res, { verified: true }, "Destination verified.");
    } catch (error) {
      sendRecoveryError(res, error);
    }
  }),
);

publicRecoveryRouter.post(
  "/requests",
  validateBody(requestBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      // Known and unknown lookups intentionally yield the same response shape.
      const created = await accountRecoveryService.createRequest(req.body);
      accepted(
        res,
        { id: created.id, status: created.status, receiptToken: created.receiptToken },
        REQUEST_ACCEPTED_MESSAGE,
      );
    } catch (error) {
      sendRecoveryError(res, error);
    }
  }),
);

publicRecoveryRouter.get(
  "/requests/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const receipt = req.header("x-recovery-receipt");
    if (!receipt) {
      return ApiResponse.error(res, "Recovery request not found.", 404, "REQUEST_NOT_FOUND");
    }
    try {
      const status = await accountRecoveryService.getReceiptStatus(String(req.params.id), receipt);
      ApiResponse.success(res, status);
    } catch (error) {
      sendRecoveryError(res, error);
    }
  }),
);

/** Authenticated endpoints, mounted at /api/account. */
export const accountRecoveryRouter = Router();

accountRecoveryRouter.post(
  "/recovery/requests/:id/cancel",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const cancelled = await accountRecoveryService.cancelByAuthenticatedUser(
        String(req.params.id),
        req.session!.user.id,
      );
      ApiResponse.success(res, { id: cancelled.id, status: cancelled.status }, "Recovery request cancelled.");
    } catch (error) {
      sendRecoveryError(res, error);
    }
  }),
);

accountRecoveryRouter.get(
  "/recovery/requests",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const requests = await prisma.accountRecoveryRequest.findMany({
      where: { userId: req.session!.user.id, status: { in: ["PENDING_REVIEW", "NEEDS_INFO", "APPROVED"] } },
      select: { id: true, status: true, releaseAt: true, createdAt: true, destinationChannel: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    ApiResponse.success(res, requests);
  }),
);

accountRecoveryRouter.post(
  "/factors/:channel/challenge",
  requireAuth,
  validateBody(factorBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const channel = parseChannel(String(req.params.channel));
    if (!channel) return ApiResponse.error(res, "Unsupported factor.", 400, ErrorCode.INVALID_INPUT);
    try {
      const challenge = await accountRecoveryService.createChallenge({
        channel,
        value: req.body.value,
        purpose: "FACTOR_LINK",
        userId: req.session!.user.id,
      });
      const delivered = await deliverRecoveryCode(channel, req.body.value, challenge.code);
      if (!delivered) {
        return ApiResponse.error(res, "We could not send a code. Try again shortly.", 503, ErrorCode.INTERNAL_ERROR);
      }
      ApiResponse.success(
        res,
        { challengeToken: challenge.challengeToken, expiresAt: challenge.expiresAt },
        "Verification code sent.",
      );
    } catch (error) {
      sendRecoveryError(res, error);
    }
  }),
);

accountRecoveryRouter.post(
  "/factors/:channel/verify",
  requireAuth,
  validateBody(factorVerifyBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const channel = parseChannel(String(req.params.channel));
    if (!channel) return ApiResponse.error(res, "Unsupported factor.", 400, ErrorCode.INVALID_INPUT);
    try {
      const user = await accountRecoveryService.linkFactor({
        userId: req.session!.user.id,
        channel,
        value: req.body.value,
        challengeToken: req.body.challengeToken,
        code: req.body.code,
      });
      ApiResponse.success(res, { user }, "Verified and linked.");
    } catch (error) {
      sendRecoveryError(res, error);
    }
  }),
);
