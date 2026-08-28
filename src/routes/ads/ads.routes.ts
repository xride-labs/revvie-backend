import { Router, Request, Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma.js";
import { requireAuth } from "../../config/auth.js";
import { ApiResponse } from "../../lib/utils/apiResponse.js";
import {
  validateBody,
  validateQuery,
  validateParams,
  asyncHandler,
} from "../../middlewares/validation.js";

const router = Router();

router.use(requireAuth);

const slotEnum = z.enum([
  "HOME_FEED",
  "DISCOVER_TOP",
  "MARKETPLACE_INLINE",
  "CHAT_LIST_TOP",
  "POST_RIDE_SUMMARY",
]);

const listAdsQuerySchema = z.object({
  slot: slotEnum,
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

const idParamSchema = z.object({ id: z.string().min(1) });

/**
 * GET /api/business/ads?slot=HOME_FEED
 *
 * Returns up to `limit` ads for the requested placement slot, filtered to:
 *   - status = ACTIVE
 *   - now is within [startsAt, endsAt]
 *   - impressionCap not yet reached (or null)
 *
 * Pro-tier users get an empty array — they paid for an ad-free experience.
 *
 * No bidding/exchange — picked in createdAt-desc order. Good enough until
 * we have real demand to optimise for.
 */
router.get(
  "/",
  validateQuery(listAdsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { slot, limit } = req.query as unknown as { slot: string; limit: number };

    // Resolve subscription tier. The Better-Auth session usually carries it
    // on `session.user.subscriptionTier` after onboarding; fall back to FREE
    // when missing so we err on the side of *showing* ads.
    const tier =
      (session.user as any)?.subscriptionTier ??
      (await prisma.user
        .findUnique({
          where: { id: session.user.id },
          select: { subscriptionTier: true },
        })
        .then((u) => u?.subscriptionTier ?? "FREE"));

    if (tier === "PRO") {
      return ApiResponse.success(res, { items: [] });
    }

    const now = new Date();
    const items = await prisma.adCampaign.findMany({
      where: {
        status: "ACTIVE",
        startsAt: { lte: now },
        endsAt: { gte: now },
        slots: { has: slot as any },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        ctaLabel: true,
        ctaUrl: true,
        deepLink: true,
        imageUrl: true,
        videoUrl: true,
        business: {
          select: {
            id: true,
            displayName: true,
            slug: true,
            logoUrl: true,
            verification: true,
          },
        },
      },
    });

    // Filter out campaigns that have hit their impression cap. Doing this
    // server-side rather than in the WHERE clause means we don't need a
    // computed-column expression — caps are rare so the hit list is small.
    const capped = await prisma.adCampaign.findMany({
      where: {
        id: { in: items.map((i) => i.id) },
        AND: [{ impressionCap: { not: null } }],
      },
      select: { id: true, impressionCap: true, impressionCount: true },
    });
    const overCap = new Set(
      capped
        .filter((c) => c.impressionCap != null && c.impressionCount >= c.impressionCap)
        .map((c) => c.id),
    );
    const filtered = items.filter((i) => !overCap.has(i.id));

    ApiResponse.success(res, { items: filtered });
  }),
);

/**
 * POST /api/business/ads/:id/impression — beacon. Best-effort; we don't fail the
 * request if the campaign is gone.
 */
router.post(
  "/:id/impression",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    await prisma.adCampaign
      .update({
        where: { id },
        data: { impressionCount: { increment: 1 } },
      })
      .catch(() => null);
    ApiResponse.success(res, null, "Logged");
  }),
);

/**
 * POST /api/business/ads/:id/click — beacon. Same lenient handling.
 */
router.post(
  "/:id/click",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    await prisma.adCampaign
      .update({
        where: { id },
        data: { clickCount: { increment: 1 } },
      })
      .catch(() => null);
    ApiResponse.success(res, null, "Logged");
  }),
);

export default router;
