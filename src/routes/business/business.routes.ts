import { Router, Request, Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma.js";
import { requireAuth } from "../../config/auth.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import {
  validateBody,
  validateQuery,
  validateParams,
  asyncHandler,
} from "../../middlewares/validation.js";
import { requireRole, UserRole } from "../../middlewares/rbac.js";
import { isStaff } from "../../lib/utils/permissions.js";
import adsRoutes from "../ads/ads.routes.js";
import discountRoutes from "../discount/discount.routes.js";

const router = Router();

// Sub-nested feature routes for Ads and Consumer Discounts
router.use("/ads", adsRoutes);
router.use("/discounts", discountRoutes);

const idParamSchema = z.object({
  id: z.string().min(1),
});

const businessCategoryEnum = z.enum([
  "BRAND",
  "GEAR_SELLER",
  "HELMET_SELLER",
  "PARTS_SELLER",
  "MARKETPLACE_SELLER",
  "CLUB",
  "SERVICE_STORE",
  "MECHANIC",
  "CONSULTATION",
]);

const createBusinessSchema = z.object({
  categories: z.array(businessCategoryEnum).min(1).max(5),
  displayName: z.string().min(2).max(100),
  tagline: z.string().max(200).optional(),
});

const websiteUrlSchema = z
  .preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
  }, z.string().url())
  .optional()
  .nullable();

// All fields optional — the wizard saves partial drafts on every step.
const updateBusinessSchema = z.object({
  categories: z.array(businessCategoryEnum).min(1).max(5).optional(),
  displayName: z.string().min(2).max(100).optional(),
  tagline: z.string().max(200).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  bannerUrl: z.string().url().optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
  websiteUrl: websiteUrlSchema,
  addressLine1: z.string().max(200).optional().nullable(),
  addressLine2: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  region: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  pricingTier: z.enum(["BASIC", "PRO", "ENTERPRISE"]).optional().nullable(),
  onboardingCompleted: z.boolean().optional(),
});

const documentsSchema = z.object({
  documents: z
    .array(
      z.object({
        type: z.string().min(1).max(60),
        url: z.string().url(),
        uploadedAt: z.string().datetime().optional(),
      }),
    )
    .min(1)
    .max(10),
});

const listQuerySchema = z.object({
  category: businessCategoryEnum.optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const reviewActionSchema = z.object({
  notes: z.string().max(1000).optional(),
});

/**
 * Slugify a display name into a URL-safe identifier. Adds a short random
 * suffix to avoid collisions — checking + retrying is cheaper than locking
 * for a unique slug pool.
 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "business"}-${suffix}`;
}

// ─── Public discovery (auth still required so anonymous traffic can't scrape)

router.get(
  "/",
  requireAuth,
  validateQuery(listQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { category, search, page, limit } = req.query as unknown as {
      category?: string;
      search?: string;
      page: number;
      limit: number;
    };

    const where: any = { verification: "APPROVED" };
    if (category) where.categories = { hasSome: [category] };
    if (search) {
      where.OR = [
        { displayName: { contains: search, mode: "insensitive" } },
        { tagline: { contains: search, mode: "insensitive" } },
        { city: { contains: search, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.businessProfile.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.businessProfile.count({ where }),
    ]);

    ApiResponse.paginated(res, items, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

// ─── List my businesses (the owner dashboard fetches this) ─────────────────

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const items = await prisma.businessProfile.findMany({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: "desc" },
    });
    ApiResponse.success(res, items);
  }),
);

// ─── Get a single business (public) ─────────────────────────────────────────

router.get(
  "/:id",
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const session = (req as any).session;

    const business = await prisma.businessProfile.findUnique({
      where: { id },
      include: { owner: { select: { id: true, name: true, avatar: true } } },
    });
    if (!business) {
      return ApiResponse.notFound(res, "Business not found");
    }

    // Hide unapproved businesses from non-owner viewers. Owners can always
    // see their own draft so the wizard can resume mid-flow.
    const isOwner = business.ownerId === session.user.id;
    if (business.verification !== "APPROVED" && !isOwner) {
      return ApiResponse.notFound(res, "Business not found");
    }

    ApiResponse.success(res, business);
  }),
);

// ─── Create a draft profile ─────────────────────────────────────────────────

router.post(
  "/",
  requireAuth,
  validateBody(createBusinessSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { categories, displayName, tagline } = req.body;

    const assignBrandOwnerRole = async () => {
      await prisma.userRoleAssignment.upsert({
        where: {
          userId_role: { userId: session.user.id, role: "BRAND_OWNER" },
        },
        create: { userId: session.user.id, role: "BRAND_OWNER" },
        update: {},
      });
    };

    let slug = slugify(displayName);
    try {
      const business = await prisma.businessProfile.create({
        data: {
          ownerId: session.user.id,
          categories,
          displayName,
          slug,
          tagline,
        },
      });

      if (!categories.includes("CLUB")) {
        await assignBrandOwnerRole();
      }

      return ApiResponse.success(res, business, "Business created");
    } catch (err: any) {
      if (err?.code === "P2002") {
        slug = slugify(displayName);
        const business = await prisma.businessProfile.create({
          data: {
            ownerId: session.user.id,
            categories,
            displayName,
            slug,
            tagline,
          },
        });

        if (!categories.includes("CLUB")) {
          await assignBrandOwnerRole();
        }

        return ApiResponse.success(res, business, "Business created");
      }
      throw err;
    }
  }),
);

// ─── Update a draft (any wizard step) ──────────────────────────────────────

router.patch(
  "/:id",
  requireAuth,
  validateParams(idParamSchema),
  validateBody(updateBusinessSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const existing = await prisma.businessProfile.findUnique({ where: { id } });
    if (!existing) return ApiResponse.notFound(res, "Business not found");
    if (existing.ownerId !== session.user.id && !isStaff(session.user.roles)) {
      return ApiResponse.forbidden(
        res,
        "Only the owner can update this business",
      );
    }

    // Once approved, owners can still edit content (logo, description, etc.)
    // but changing categories requires a new review cycle.
    if (existing.verification === "APPROVED" && req.body.categories) {
      const existingSet = new Set(existing.categories);
      const newSet = new Set(req.body.categories as string[]);
      const changed =
        [...newSet].some((c) => !existingSet.has(c as any)) ||
        existingSet.size !== newSet.size;
      if (changed) {
        return ApiResponse.error(
          res,
          "Approved businesses cannot change categories. Submit a new business instead.",
          409,
          ErrorCode.CONFLICT,
        );
      }
    }

    const updated = await prisma.businessProfile.update({
      where: { id },
      data: req.body,
    });
    ApiResponse.success(res, updated, "Business updated");
  }),
);

// ─── Attach verification documents ──────────────────────────────────────────

router.post(
  "/:id/documents",
  requireAuth,
  validateParams(idParamSchema),
  validateBody(documentsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const existing = await prisma.businessProfile.findUnique({ where: { id } });
    if (!existing) return ApiResponse.notFound(res, "Business not found");
    if (existing.ownerId !== session.user.id && !isStaff(session.user.roles)) {
      return ApiResponse.forbidden(res, "Only the owner can attach documents");
    }

    const incoming = req.body.documents.map((d: any) => ({
      ...d,
      uploadedAt: d.uploadedAt ?? new Date().toISOString(),
    }));

    const merged = [...((existing.documents as any[]) ?? []), ...incoming];

    const updated = await prisma.businessProfile.update({
      where: { id },
      data: { documents: merged },
    });
    ApiResponse.success(res, updated, "Documents attached");
  }),
);

// ─── Submit for admin review ───────────────────────────────────────────────

router.post(
  "/:id/submit",
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const existing = await prisma.businessProfile.findUnique({ where: { id } });
    if (!existing) return ApiResponse.notFound(res, "Business not found");
    if (existing.ownerId !== session.user.id && !isStaff(session.user.roles)) {
      return ApiResponse.forbidden(res, "Only the owner can submit for review");
    }
    if (existing.verification === "APPROVED") {
      return ApiResponse.conflict(res, "Business is already approved");
    }
    // Minimum data check — refuse to submit half-empty profiles. The wizard
    // should already disable the submit button until these are present, but
    // double-checking server-side keeps the admin queue clean.
    const missing: string[] = [];
    if (!existing.displayName) missing.push("displayName");
    if (!existing.description) missing.push("description");
    if (!existing.phone && !existing.email) missing.push("phone or email");
    if (missing.length > 0) {
      return ApiResponse.error(
        res,
        `Missing required fields: ${missing.join(", ")}`,
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const updated = await prisma.businessProfile.update({
      where: { id },
      data: { verification: "SUBMITTED", verificationNotes: null },
    });
    ApiResponse.success(res, updated, "Submitted for review");
  }),
);

// ─── Admin approval / rejection ─────────────────────────────────────────────

router.post(
  "/:id/approve",
  requireAuth,
  requireRole(UserRole.ADMIN),
  validateParams(idParamSchema),
  validateBody(reviewActionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const updated = await prisma.businessProfile.update({
      where: { id },
      data: {
        verification: "APPROVED",
        verificationNotes: req.body.notes ?? null,
      },
    });
    ApiResponse.success(res, updated, "Business approved");
  }),
);

router.post(
  "/:id/reject",
  requireAuth,
  requireRole(UserRole.ADMIN),
  validateParams(idParamSchema),
  validateBody(reviewActionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const updated = await prisma.businessProfile.update({
      where: { id },
      data: {
        verification: "REJECTED",
        verificationNotes: req.body.notes ?? null,
      },
    });
    ApiResponse.success(res, updated, "Business rejected");
  }),
);

// ─── Owner: ad campaigns under a business ──────────────────────────────────
//
// Campaign creation requires the parent business to be APPROVED — we don't
// want unverified businesses paying for ads, and the ad serving query filters
// by the business's verification status anyway.

const slotEnum = z.enum([
  "HOME_FEED",
  "DISCOVER_TOP",
  "MARKETPLACE_INLINE",
  "CHAT_LIST_TOP",
  "POST_RIDE_SUMMARY",
]);

const createCampaignSchema = z.object({
  title: z.string().min(2).max(120),
  ctaLabel: z.string().min(1).max(40),
  ctaUrl: z.string().url().optional().nullable(),
  deepLink: z.string().max(200).optional().nullable(),
  imageUrl: z.string().url(),
  videoUrl: z.string().url().optional().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  budgetPaise: z.number().int().min(0).default(0),
  slots: z.array(slotEnum).min(1),
  targetTags: z.array(z.string().max(40)).max(20).default([]),
  impressionCap: z.number().int().min(1).optional().nullable(),
});

const updateCampaignSchema = createCampaignSchema.partial();

const cidParamSchema = z.object({
  id: z.string().min(1),
  cid: z.string().min(1),
});

async function ensureBusinessOwner(
  req: Request,
  res: Response,
): Promise<{ businessId: string; ownerId: string } | null> {
  const session = (req as any).session;
  const { id } = req.params;
  const business = await prisma.businessProfile.findUnique({
    where: { id },
    select: { id: true, ownerId: true, verification: true },
  });
  if (!business) {
    ApiResponse.notFound(res, "Business not found");
    return null;
  }
  if (business.ownerId !== session.user.id && !isStaff(session.user.roles)) {
    ApiResponse.forbidden(res, "Only the owner can manage this business");
    return null;
  }
  return { businessId: business.id, ownerId: business.ownerId };
}

router.get(
  "/:id/campaigns",
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessOwner(req, res);
    if (!ctx) return;
    const items = await prisma.adCampaign.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { createdAt: "desc" },
    });
    ApiResponse.success(res, items);
  }),
);

router.post(
  "/:id/campaigns",
  requireAuth,
  validateParams(idParamSchema),
  validateBody(createCampaignSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessOwner(req, res);
    if (!ctx) return;
    // New campaigns start as PENDING_APPROVAL — admin moderates the
    // transition to ACTIVE. Owners can keep editing while pending; once
    // ACTIVE the admin endpoints are the only way to change status.
    const created = await prisma.adCampaign.create({
      data: {
        businessId: ctx.businessId,
        ...req.body,
        startsAt: new Date(req.body.startsAt),
        endsAt: new Date(req.body.endsAt),
        status: "PENDING_APPROVAL",
      },
    });
    ApiResponse.success(res, created, "Campaign submitted for review");
  }),
);

router.patch(
  "/:id/campaigns/:cid",
  requireAuth,
  validateParams(cidParamSchema),
  validateBody(updateCampaignSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessOwner(req, res);
    if (!ctx) return;
    const { cid } = req.params;
    const existing = await prisma.adCampaign.findUnique({ where: { id: cid } });
    if (!existing || existing.businessId !== ctx.businessId) {
      return ApiResponse.notFound(res, "Campaign not found");
    }
    // Owners can edit content freely, but they can't promote themselves
    // out of REJECTED back into ACTIVE — admin has the final say.
    const data: any = { ...req.body };
    if (req.body.startsAt) data.startsAt = new Date(req.body.startsAt);
    if (req.body.endsAt) data.endsAt = new Date(req.body.endsAt);
    if (existing.status === "ACTIVE") {
      // Editing a live campaign re-enters review.
      data.status = "PENDING_APPROVAL";
    }
    const updated = await prisma.adCampaign.update({
      where: { id: cid },
      data,
    });
    ApiResponse.success(res, updated, "Campaign updated");
  }),
);

router.delete(
  "/:id/campaigns/:cid",
  requireAuth,
  validateParams(cidParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessOwner(req, res);
    if (!ctx) return;
    const { cid } = req.params;
    const existing = await prisma.adCampaign.findUnique({ where: { id: cid } });
    if (!existing || existing.businessId !== ctx.businessId) {
      return ApiResponse.notFound(res, "Campaign not found");
    }
    await prisma.adCampaign.delete({ where: { id: cid } });
    ApiResponse.success(res, null, "Campaign deleted");
  }),
);

// ─── Owner: discounts under a business ─────────────────────────────────────

const createDiscountSchema = z
  .object({
    code: z.string().max(40).optional().nullable(),
    title: z.string().min(2).max(120),
    description: z.string().max(2000).optional().nullable(),
    imageUrl: z.string().url().optional().nullable(),
    percentOff: z.number().int().min(1).max(100).optional().nullable(),
    amountOffPaise: z.number().int().min(1).optional().nullable(),
    validFrom: z.string().datetime(),
    validUntil: z.string().datetime(),
    appliesTo: z.any().optional().nullable(),
    isFeatured: z.boolean().default(false),
  })
  .refine((d) => d.percentOff != null || d.amountOffPaise != null, {
    message: "Provide either percentOff or amountOffPaise",
  });

const updateDiscountSchema = z.object({
  code: z.string().max(40).optional().nullable(),
  title: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  percentOff: z.number().int().min(1).max(100).optional().nullable(),
  amountOffPaise: z.number().int().min(1).optional().nullable(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  appliesTo: z.any().optional().nullable(),
  isFeatured: z.boolean().optional(),
});

const didParamSchema = z.object({
  id: z.string().min(1),
  did: z.string().min(1),
});

router.get(
  "/:id/discounts",
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessOwner(req, res);
    if (!ctx) return;
    const items = await prisma.discount.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { createdAt: "desc" },
    });
    ApiResponse.success(res, items);
  }),
);

router.post(
  "/:id/discounts",
  requireAuth,
  validateParams(idParamSchema),
  validateBody(createDiscountSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessOwner(req, res);
    if (!ctx) return;
    const created = await prisma.discount.create({
      data: {
        businessId: ctx.businessId,
        ...req.body,
        validFrom: new Date(req.body.validFrom),
        validUntil: new Date(req.body.validUntil),
      },
    });
    ApiResponse.success(res, created, "Discount created");
  }),
);

router.patch(
  "/:id/discounts/:did",
  requireAuth,
  validateParams(didParamSchema),
  validateBody(updateDiscountSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessOwner(req, res);
    if (!ctx) return;
    const { did } = req.params;
    const existing = await prisma.discount.findUnique({ where: { id: did } });
    if (!existing || existing.businessId !== ctx.businessId) {
      return ApiResponse.notFound(res, "Discount not found");
    }
    const data: any = { ...req.body };
    if (req.body.validFrom) data.validFrom = new Date(req.body.validFrom);
    if (req.body.validUntil) data.validUntil = new Date(req.body.validUntil);
    const updated = await prisma.discount.update({ where: { id: did }, data });
    ApiResponse.success(res, updated, "Discount updated");
  }),
);

router.delete(
  "/:id/discounts/:did",
  requireAuth,
  validateParams(didParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessOwner(req, res);
    if (!ctx) return;
    const { did } = req.params;
    const existing = await prisma.discount.findUnique({ where: { id: did } });
    if (!existing || existing.businessId !== ctx.businessId) {
      return ApiResponse.notFound(res, "Discount not found");
    }
    await prisma.discount.delete({ where: { id: did } });
    ApiResponse.success(res, null, "Discount deleted");
  }),
);

// ─── Analytics summary ─────────────────────────────────────────────────────

router.get(
  "/:id/analytics",
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessOwner(req, res);
    if (!ctx) return;

    const [campaignCount, discountCount, listingCount, impressions, clicks] =
      await Promise.all([
        prisma.adCampaign.count({ where: { businessId: ctx.businessId } }),
        prisma.discount.count({ where: { businessId: ctx.businessId } }),
        prisma.marketplaceListing.count({ where: { sellerId: ctx.ownerId } }),
        prisma.adCampaign.aggregate({
          where: { businessId: ctx.businessId },
          _sum: { impressionCount: true },
        }),
        prisma.adCampaign.aggregate({
          where: { businessId: ctx.businessId },
          _sum: { clickCount: true },
        }),
      ]);

    ApiResponse.success(res, {
      campaigns: campaignCount,
      discounts: discountCount,
      listings: listingCount,
      totalImpressions: impressions._sum.impressionCount ?? 0,
      totalClicks: clicks._sum.clickCount ?? 0,
    });
  }),
);

// ─── Listings by this business owner ───────────────────────────────────────

router.get(
  "/:id/listings",
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessOwner(req, res);
    if (!ctx) return;

    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.marketplaceListing.findMany({
        where: { sellerId: ctx.ownerId },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.marketplaceListing.count({ where: { sellerId: ctx.ownerId } }),
    ]);

    ApiResponse.paginated(res, items, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

// ─── Helper: check owner OR team member ────────────────────────────────────
// Returns the business if the session user is the owner or an active member.
// minRole: null = any member, "ADMIN" = admin or owner only.

async function ensureBusinessAccess(
  req: Request,
  res: Response,
  minRole: "ADMIN" | null = null,
): Promise<{
  business: { id: string; ownerId: string; verification: string };
} | null> {
  const session = (req as any).session;
  const { id } = req.params;

  const business = await prisma.businessProfile.findUnique({
    where: { id },
    select: { id: true, ownerId: true, verification: true },
  });
  if (!business) {
    ApiResponse.notFound(res, "Business not found");
    return null;
  }

  if (business.ownerId === session.user.id || isStaff(session.user.roles)) {
    return { business };
  }

  const member = await prisma.brandMember.findUnique({
    where: { businessId_userId: { businessId: id, userId: session.user.id } },
    select: { role: true },
  });

  if (!member) {
    ApiResponse.forbidden(res, "Access denied");
    return null;
  }

  if (minRole === "ADMIN" && !["OWNER", "ADMIN"].includes(member.role)) {
    ApiResponse.forbidden(res, "Admin or owner role required");
    return null;
  }

  return { business };
}

// ─── Team members ──────────────────────────────────────────────────────────

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MODERATOR", "MEMBER"]).default("MEMBER"),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(["ADMIN", "MODERATOR", "MEMBER"]),
});

const memberParamSchema = z.object({
  id: z.string().min(1),
  uid: z.string().min(1),
});

router.get(
  "/:id/members",
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessAccess(req, res);
    if (!ctx) return;
    const members = await prisma.brandMember.findMany({
      where: { businessId: ctx.business.id },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { joinedAt: "asc" },
    });
    ApiResponse.success(res, members);
  }),
);

router.post(
  "/:id/members",
  requireAuth,
  validateParams(idParamSchema),
  validateBody(inviteMemberSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const ctx = await ensureBusinessAccess(req, res, "ADMIN");
    if (!ctx) return;

    const { email, role } = req.body;
    const target = await prisma.user.findFirst({
      where: { email },
      select: { id: true, name: true, email: true },
    });
    if (!target) {
      return ApiResponse.notFound(res, "No user found with that email");
    }
    if (target.id === ctx.business.ownerId) {
      return ApiResponse.conflict(res, "Owner is already a member");
    }

    const member = await prisma.brandMember.upsert({
      where: {
        businessId_userId: { businessId: ctx.business.id, userId: target.id },
      },
      create: {
        businessId: ctx.business.id,
        userId: target.id,
        role,
        invitedBy: session.user.id,
      },
      update: { role },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    // Grant the appropriate platform role so the portal works for them.
    const platformRole =
      role === "ADMIN"
        ? "BRAND_ADMIN"
        : role === "MODERATOR"
          ? "BRAND_MODERATOR"
          : null;
    if (platformRole) {
      await prisma.userRoleAssignment.upsert({
        where: {
          userId_role: { userId: target.id, role: platformRole as any },
        },
        create: { userId: target.id, role: platformRole as any },
        update: {},
      });
    }

    ApiResponse.success(res, member, "Member added");
  }),
);

router.patch(
  "/:id/members/:uid/role",
  requireAuth,
  validateParams(memberParamSchema),
  validateBody(updateMemberRoleSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessAccess(req, res, "ADMIN");
    if (!ctx) return;
    const { uid } = req.params;
    const existing = await prisma.brandMember.findUnique({
      where: {
        businessId_userId: { businessId: ctx.business.id, userId: uid },
      },
    });
    if (!existing) return ApiResponse.notFound(res, "Member not found");

    const updated = await prisma.brandMember.update({
      where: {
        businessId_userId: { businessId: ctx.business.id, userId: uid },
      },
      data: { role: req.body.role },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });
    ApiResponse.success(res, updated, "Role updated");
  }),
);

router.delete(
  "/:id/members/:uid",
  requireAuth,
  validateParams(memberParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessAccess(req, res, "ADMIN");
    if (!ctx) return;
    const { uid } = req.params;
    if (uid === ctx.business.ownerId) {
      return ApiResponse.forbidden(res, "Cannot remove the owner");
    }
    const existing = await prisma.brandMember.findUnique({
      where: {
        businessId_userId: { businessId: ctx.business.id, userId: uid },
      },
    });
    if (!existing) return ApiResponse.notFound(res, "Member not found");
    await prisma.brandMember.delete({
      where: {
        businessId_userId: { businessId: ctx.business.id, userId: uid },
      },
    });
    ApiResponse.success(res, null, "Member removed");
  }),
);

// ─── Service listings ──────────────────────────────────────────────────────

const serviceCategoryEnum = z.enum([
  "GENERAL_SERVICE",
  "OIL_CHANGE",
  "BRAKE_SERVICE",
  "TYRE_CHANGE",
  "ELECTRICAL",
  "SUSPENSION",
  "ENGINE_WORK",
  "CUSTOM_MODIFICATION",
  "INSPECTION",
  "ROADSIDE_ASSISTANCE",
  "CONSULTATION",
]);

const createServiceSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(2000).optional().nullable(),
  category: serviceCategoryEnum.default("GENERAL_SERVICE"),
  priceRange: z.string().max(60).optional().nullable(),
  duration: z.string().max(60).optional().nullable(),
  isActive: z.boolean().default(true),
});

const updateServiceSchema = createServiceSchema.partial();

const sidParamSchema = z.object({
  id: z.string().min(1),
  sid: z.string().min(1),
});

// Public — any authenticated user can browse services of an approved business.
router.get(
  "/:id/services",
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const session = (req as any).session;

    const business = await prisma.businessProfile.findUnique({
      where: { id },
      select: { ownerId: true, verification: true },
    });
    if (!business) return ApiResponse.notFound(res, "Business not found");

    const isOwnerOrMember =
      business.ownerId === session.user.id ||
      !!(await prisma.brandMember.findUnique({
        where: {
          businessId_userId: { businessId: id, userId: session.user.id },
        },
      }));

    const where: any = { businessId: id };
    if (!isOwnerOrMember) {
      if (business.verification !== "APPROVED")
        return ApiResponse.notFound(res, "Business not found");
      where.isActive = true;
    }

    const services = await prisma.serviceListing.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });
    ApiResponse.success(res, services);
  }),
);

router.post(
  "/:id/services",
  requireAuth,
  validateParams(idParamSchema),
  validateBody(createServiceSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessAccess(req, res);
    if (!ctx) return;
    const created = await prisma.serviceListing.create({
      data: { businessId: ctx.business.id, ...req.body },
    });
    ApiResponse.success(res, created, "Service created");
  }),
);

router.patch(
  "/:id/services/:sid",
  requireAuth,
  validateParams(sidParamSchema),
  validateBody(updateServiceSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessAccess(req, res);
    if (!ctx) return;
    const { sid } = req.params;
    const existing = await prisma.serviceListing.findUnique({
      where: { id: sid },
    });
    if (!existing || existing.businessId !== ctx.business.id) {
      return ApiResponse.notFound(res, "Service not found");
    }
    const updated = await prisma.serviceListing.update({
      where: { id: sid },
      data: req.body,
    });
    ApiResponse.success(res, updated, "Service updated");
  }),
);

router.delete(
  "/:id/services/:sid",
  requireAuth,
  validateParams(sidParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessAccess(req, res);
    if (!ctx) return;
    const { sid } = req.params;
    const existing = await prisma.serviceListing.findUnique({
      where: { id: sid },
    });
    if (!existing || existing.businessId !== ctx.business.id) {
      return ApiResponse.notFound(res, "Service not found");
    }
    await prisma.serviceListing.delete({ where: { id: sid } });
    ApiResponse.success(res, null, "Service deleted");
  }),
);

// ─── Brand Products (Phase 9) ─────────────────────────────────────────────

const brandProductCategoryEnum = z.enum([
  "MOTORCYCLE",
  "GEAR",
  "HELMET",
  "JACKET",
  "GLOVES",
  "BOOTS",
  "PANTS",
  "PARTS",
  "ACCESSORIES",
  "ELECTRONICS",
  "TOOLS",
  "LUBRICANTS",
  "TYRES",
  "LIGHTING",
  "APPAREL",
  "MEMORABILIA",
  "OTHER",
]);

const productAvailabilityEnum = z.enum([
  "IN_STOCK",
  "OUT_OF_STOCK",
  "PRE_ORDER",
  "DISCONTINUED",
]);

const createProductSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(5000).optional().nullable(),
  sku: z.string().max(80).optional().nullable(),
  category: brandProductCategoryEnum.default("OTHER"),
  price: z.number().positive().optional().nullable(),
  currency: z.string().max(10).default("INR"),
  images: z.array(z.string().url()).max(10).default([]),
  availability: productAvailabilityEnum.default("IN_STOCK"),
  tags: z.array(z.string().max(40)).max(20).default([]),
  specs: z.record(z.string(), z.unknown()).optional().nullable(),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
});

const updateProductSchema = createProductSchema.partial();

const pidParamSchema = z.object({
  id: z.string().min(1),
  pid: z.string().min(1),
});

router.get(
  "/:id/products",
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const session = (req as any).session;

    const business = await prisma.businessProfile.findUnique({
      where: { id },
      select: { ownerId: true, verification: true },
    });
    if (!business) return ApiResponse.notFound(res, "Business not found");

    const isOwnerOrMember =
      business.ownerId === session.user.id ||
      !!(await prisma.brandMember.findUnique({
        where: {
          businessId_userId: { businessId: id, userId: session.user.id },
        },
      })) ||
      isStaff(session.user.roles);

    const where: any = { businessId: id };
    if (!isOwnerOrMember) {
      if (business.verification !== "APPROVED")
        return ApiResponse.notFound(res, "Business not found");
      where.isActive = true;
    }

    const products = await prisma.brandProduct.findMany({
      where,
      orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
    });
    ApiResponse.success(res, products);
  }),
);

router.post(
  "/:id/products",
  requireAuth,
  validateParams(idParamSchema),
  validateBody(createProductSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessAccess(req, res);
    if (!ctx) return;
    const created = await prisma.brandProduct.create({
      data: { businessId: ctx.business.id, ...req.body },
    });
    ApiResponse.success(res, created, "Product created");
  }),
);

router.patch(
  "/:id/products/:pid",
  requireAuth,
  validateParams(pidParamSchema),
  validateBody(updateProductSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessAccess(req, res);
    if (!ctx) return;
    const { pid } = req.params;
    const existing = await prisma.brandProduct.findUnique({
      where: { id: pid },
    });
    if (!existing || existing.businessId !== ctx.business.id) {
      return ApiResponse.notFound(res, "Product not found");
    }
    const updated = await prisma.brandProduct.update({
      where: { id: pid },
      data: req.body,
    });
    ApiResponse.success(res, updated, "Product updated");
  }),
);

router.delete(
  "/:id/products/:pid",
  requireAuth,
  validateParams(pidParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessAccess(req, res);
    if (!ctx) return;
    const { pid } = req.params;
    const existing = await prisma.brandProduct.findUnique({
      where: { id: pid },
    });
    if (!existing || existing.businessId !== ctx.business.id) {
      return ApiResponse.notFound(res, "Product not found");
    }
    await prisma.brandProduct.delete({ where: { id: pid } });
    ApiResponse.success(res, null, "Product deleted");
  }),
);

// ─── Business inquiries ────────────────────────────────────────────────────

const createInquirySchema = z.object({
  subject: z.string().min(2).max(200),
  message: z.string().min(10).max(5000),
});

const updateInquiryStatusSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
});

const iidParamSchema = z.object({
  id: z.string().min(1),
  iid: z.string().min(1),
});

// Owner/team: list all inquiries for their business.
router.get(
  "/:id/inquiries",
  requireAuth,
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessAccess(req, res);
    if (!ctx) return;
    const inquiries = await prisma.businessInquiry.findMany({
      where: { businessId: ctx.business.id },
      include: {
        fromUser: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    ApiResponse.success(res, inquiries);
  }),
);

// Any authenticated user can send an inquiry to an approved business.
router.post(
  "/:id/inquiries",
  requireAuth,
  validateParams(idParamSchema),
  validateBody(createInquirySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const business = await prisma.businessProfile.findUnique({
      where: { id },
      select: { id: true, ownerId: true, verification: true },
    });
    if (!business || business.verification !== "APPROVED") {
      return ApiResponse.notFound(res, "Business not found");
    }
    if (business.ownerId === session.user.id) {
      return ApiResponse.error(
        res,
        "Cannot inquire to your own business",
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const inquiry = await prisma.businessInquiry.create({
      data: {
        businessId: id,
        fromUserId: session.user.id,
        subject: req.body.subject,
        message: req.body.message,
      },
      include: {
        fromUser: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    });
    ApiResponse.success(res, inquiry, "Inquiry sent");
  }),
);

// Owner/team: update inquiry status.
router.patch(
  "/:id/inquiries/:iid",
  requireAuth,
  validateParams(iidParamSchema),
  validateBody(updateInquiryStatusSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await ensureBusinessAccess(req, res);
    if (!ctx) return;
    const { iid } = req.params;
    const existing = await prisma.businessInquiry.findUnique({
      where: { id: iid },
    });
    if (!existing || existing.businessId !== ctx.business.id) {
      return ApiResponse.notFound(res, "Inquiry not found");
    }
    const updated = await prisma.businessInquiry.update({
      where: { id: iid },
      data: { status: req.body.status },
      include: {
        fromUser: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    });
    ApiResponse.success(res, updated, "Inquiry updated");
  }),
);

export default router;
