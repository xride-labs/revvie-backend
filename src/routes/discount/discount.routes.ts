import { Router, Request, Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma.js";
import { requireAuth } from "../../config/auth.js";
import { ApiResponse } from "../../lib/utils/apiResponse.js";
import {
  validateQuery,
  asyncHandler,
} from "../../middlewares/validation.js";

const router = Router();

router.use(requireAuth);

const listDiscountsQuerySchema = z.object({
  featured: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * GET /api/business/discounts
 *
 * Active discounts whose validity window includes now. Featured first
 * (sorted desc by validUntil so freshly-launched promos surface). The
 * `featured=true` query restricts to featured items only.
 *
 * Discounts are visible to all users (Pro and Free) — they're not ads.
 */
router.get(
  "/",
  validateQuery(listDiscountsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { featured, page, limit } = req.query as unknown as {
      featured?: boolean;
      page: number;
      limit: number;
    };

    const now = new Date();
    const where: any = {
      validFrom: { lte: now },
      validUntil: { gte: now },
      // Only show discounts whose business is approved — keeps unvetted
      // brands out of the offer wall.
      business: { verification: "APPROVED" },
    };
    if (featured) where.isFeatured = true;

    const [items, total] = await Promise.all([
      prisma.discount.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ isFeatured: "desc" }, { validUntil: "desc" }],
        include: {
          business: {
            select: {
              id: true,
              displayName: true,
              slug: true,
              logoUrl: true,
              categories: true,
            },
          },
        },
      }),
      prisma.discount.count({ where }),
    ]);

    ApiResponse.paginated(res, items, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

export default router;
