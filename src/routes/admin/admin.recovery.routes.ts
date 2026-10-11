import { Router, Request, Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma.js";
import { requireAuth } from "../../config/auth.js";
import { requireAdmin, requireSuperAdmin } from "../../middlewares/rbac.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import {
  asyncHandler,
  validateBody,
  validateParams,
  validateQuery,
} from "../../middlewares/validation.js";
import { AccountRecoveryError } from "../../services/account-recovery/accountRecovery.service.js";
import { accountRecoveryService } from "../auth/recovery.routes.js";
import { notifyRecoveryMilestone } from "../../services/account-recovery/accountRecovery.notifications.js";

const router = Router();

// Support (CO_ADMIN) can read and ask for more information; only a security
// admin (ADMIN) can approve or reject, because approval retires sign-in factors.
router.use(requireAuth);

const idSchema = z.object({ id: z.string().min(10).max(40) });
const listQuerySchema = z.object({
  status: z
    .enum(["PENDING_REVIEW", "NEEDS_INFO", "REJECTED", "APPROVED", "CANCELLED", "PROCESSING", "COMPLETED", "EXPIRED"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const noteSchema = z.object({ note: z.string().trim().max(1000).optional() });
const approveSchema = noteSchema.extend({
  retireFactors: z.array(z.enum(["EMAIL", "PHONE", "OAUTH", "PASSKEY"])).min(1),
});

const recoverySelect = {
  id: true,
  status: true,
  destinationChannel: true,
  destinationValue: true,
  explanation: true,
  reviewerNote: true,
  retireFactors: true,
  approvedAt: true,
  releaseAt: true,
  completedAt: true,
  cancelledAt: true,
  rejectedAt: true,
  expiresAt: true,
  lastError: true,
  createdAt: true,
  user: { select: { id: true, name: true, username: true } },
  reviewer: { select: { id: true, name: true } },
} as const;

function sendReviewError(res: Response, error: unknown): void {
  if (error instanceof AccountRecoveryError) {
    return ApiResponse.error(res, error.message, 409, error.code);
  }
  throw error;
}

router.get(
  "/account-recoveries",
  requireAdmin,
  validateQuery(listQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { status, limit } = req.query as unknown as z.infer<typeof listQuerySchema>;
    const rows = await prisma.accountRecoveryRequest.findMany({
      where: status ? { status } : undefined,
      select: recoverySelect,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    ApiResponse.success(res, rows);
  }),
);

router.get(
  "/account-recoveries/:id",
  requireAdmin,
  validateParams(idSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const row = await prisma.accountRecoveryRequest.findUnique({
      where: { id: String(req.params.id) },
      select: {
        ...recoverySelect,
        events: {
          select: { id: true, type: true, actorUserId: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!row) return ApiResponse.notFound(res, "Recovery request not found", ErrorCode.NOT_FOUND);
    ApiResponse.success(res, row);
  }),
);

router.post(
  "/account-recoveries/:id/request-info",
  requireAdmin,
  validateParams(idSchema),
  validateBody(noteSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const row = await accountRecoveryService.review(
        String(req.params.id),
        req.session!.user.id,
        "NEEDS_INFO",
        { note: req.body.note },
      );
      ApiResponse.success(res, { id: row.id, status: row.status });
    } catch (error) {
      sendReviewError(res, error);
    }
  }),
);

router.post(
  "/account-recoveries/:id/reject",
  requireSuperAdmin,
  validateParams(idSchema),
  validateBody(noteSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const row = await accountRecoveryService.review(
        String(req.params.id),
        req.session!.user.id,
        "REJECT",
        { note: req.body.note },
      );
      ApiResponse.success(res, { id: row.id, status: row.status });
    } catch (error) {
      sendReviewError(res, error);
    }
  }),
);

router.post(
  "/account-recoveries/:id/approve",
  requireSuperAdmin,
  validateParams(idSchema),
  validateBody(approveSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const existing = await prisma.accountRecoveryRequest.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!existing) return ApiResponse.notFound(res, "Recovery request not found", ErrorCode.NOT_FOUND);
    if (!existing.userId) {
      return ApiResponse.error(
        res,
        "This request does not match an existing account and cannot be approved.",
        409,
        "NO_MATCHING_ACCOUNT",
      );
    }

    try {
      const row = await accountRecoveryService.approve(
        id,
        req.session!.user.id,
        req.body.retireFactors,
        req.body.note,
      );
      await notifyRecoveryMilestone(existing.userId, "APPROVED", row.releaseAt);
      ApiResponse.success(res, { id: row.id, status: row.status, releaseAt: row.releaseAt });
    } catch (error) {
      sendReviewError(res, error);
    }
  }),
);

export default router;
