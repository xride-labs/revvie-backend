import { Router, Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import prisma from "../../lib/prisma.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import {
  asyncHandler,
  validateBody,
  validateParams,
  validateQuery,
} from "../../middlewares/validation.js";
import { z } from "zod";
import { requireMarketplaceEnabled } from "../../middlewares/appSettings.js";
import { sendEmail } from "../../lib/mailer.js";
import { buildMarketplaceContactTemplate } from "../../lib/emailTemplates.js";

const router = Router();
const isProduction = process.env.NODE_ENV === "production";

const idParam = z.object({ id: z.string().min(1) });

/**
 * GET /api/public/rides/:id
 * Unauthenticated ride preview for web share pages.
 */
router.get(
  "/rides/:id",
  validateParams(idParam),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const ride = await prisma.ride.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        startLocation: true,
        scheduledAt: true,
        images: true,
        status: true,
        _count: { select: { participants: true } },
      },
    });
    if (!ride) {
      return ApiResponse.notFound(res, "Ride not found", ErrorCode.NOT_FOUND);
    }
    return ApiResponse.success(res, {
      id: ride.id,
      title: ride.title,
      startLocation: ride.startLocation,
      scheduledAt: ride.scheduledAt,
      bannerImage: ride.images[0] ?? null,
      participantCount: ride._count.participants,
      status: ride.status,
    });
  }),
);

/** Curated, non-sensitive card shape shared by the list and detail routes below. */
function toPublicListingCard(listing: any) {
  return {
    id: listing.id,
    title: listing.title,
    price: listing.price,
    currency: listing.currency,
    condition: listing.condition ?? null,
    category: listing.category ?? null,
    subcategory: listing.subcategory ?? null,
    images: listing.images,
    locationLabel: listing.locationLabel ?? null,
    allowBids: listing.allowBids,
    status: listing.status,
    featured: listing.featured,
    seller: {
      id: listing.seller.id,
      name: listing.seller.name,
      avatar: listing.seller.avatar ?? null,
    },
    club: listing.club ? { id: listing.club.id, name: listing.club.name } : null,
    rating: listing.reviewCount > 0 ? listing.avgRating : null,
    ratingCount: listing.reviewCount,
    createdAt: listing.createdAt,
  };
}

/** A listing hidden from public view regardless of the status/visibility filters below. */
function isPubliclyHidden(listing: { status: string; visibility: string }): boolean {
  return listing.status === "DRAFT" || listing.visibility === "CLUB_ONLY";
}

const publicListingQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  category: z.string().optional(),
  condition: z.string().optional(),
  minPrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  search: z.string().optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "rating"]).optional().default("newest"),
});

/**
 * GET /api/public/marketplace
 * Unauthenticated, paginated marketplace browse — used both for the full public
 * `/marketplace` page and (with `limit=8`, no other params) the marketing landing
 * page's teaser section. Always active, non club-only listings, featured first.
 */
router.get(
  "/marketplace",
  validateQuery(publicListingQuerySchema),
  requireMarketplaceEnabled,
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, category, condition, minPrice, maxPrice, search, sort } =
      req.query as any;
    const skip = (page - 1) * limit;

    const where: any = {
      status: "ACTIVE",
      visibility: { not: "CLUB_ONLY" },
    };
    if (category) where.category = category;
    if (condition) where.condition = condition;
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const orderBy: any[] = [{ featured: "desc" }];
    switch (sort) {
      case "price_asc":
        orderBy.push({ price: "asc" });
        break;
      case "price_desc":
        orderBy.push({ price: "desc" });
        break;
      case "rating":
        orderBy.push({ avgRating: "desc" });
        break;
    }
    orderBy.push({ createdAt: "desc" });

    const [listings, total] = await Promise.all([
      prisma.marketplaceListing.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          seller: { select: { id: true, name: true, avatar: true } },
          club: { select: { id: true, name: true } },
        },
      }),
      prisma.marketplaceListing.count({ where }),
    ]);

    return ApiResponse.success(res, {
      listings: listings.map(toPublicListingCard),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  }),
);

/**
 * GET /api/public/marketplace/:id
 * Unauthenticated listing detail — used for web share pages and the public
 * `/marketplace/:id` page. Drafts and club-only listings are masked as
 * "not found" so a guessed id can't confirm they exist.
 */
router.get(
  "/marketplace/:id",
  validateParams(idParam),
  requireMarketplaceEnabled,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
      include: {
        seller: { select: { id: true, name: true, avatar: true } },
        club: { select: { id: true, name: true } },
        interests: { select: { id: true } },
      },
    });
    if (!listing || isPubliclyHidden(listing)) {
      return ApiResponse.notFound(
        res,
        "Listing not found",
        ErrorCode.LISTING_NOT_FOUND,
      );
    }
    return ApiResponse.success(res, {
      ...toPublicListingCard(listing),
      description: listing.description ?? "",
      videos: listing.videos,
      specifications: listing.specifications ?? null,
      latitude: listing.latitude ?? null,
      longitude: listing.longitude ?? null,
      interestCount: listing.interests.length,
    });
  }),
);

const marketplaceContactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  phone: z.string().trim().min(6).max(20).optional(),
  message: z.string().trim().min(10).max(2000),
});

/**
 * Anonymous "contact seller" is an email relay, not a chat conversation — no
 * account needed on either side. 5 messages per 15 minutes per IP keeps it from
 * becoming a spam vector while still allowing a genuine back-and-forth.
 */
const marketplaceContactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 5 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? ""),
  handler: (_req, res) => {
    ApiResponse.tooManyRequests(
      res,
      "Too many messages sent. Please try again later.",
    );
  },
});

/**
 * POST /api/public/marketplace/:id/contact
 * Relays a buyer's message to the seller's email with `replyTo` set to the
 * buyer's address — the seller just hits reply to continue the conversation in
 * their own inbox. The seller's email is never returned to the caller.
 */
router.post(
  "/marketplace/:id/contact",
  marketplaceContactLimiter,
  validateParams(idParam),
  requireMarketplaceEnabled,
  validateBody(marketplaceContactSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, email, phone, message } = req.body;

    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        visibility: true,
        seller: { select: { name: true, email: true } },
      },
    });

    if (!listing || isPubliclyHidden(listing)) {
      return ApiResponse.notFound(
        res,
        "Listing not found",
        ErrorCode.LISTING_NOT_FOUND,
      );
    }

    if (!listing.seller.email) {
      return ApiResponse.error(
        res,
        "This seller can't be reached right now.",
        502,
        ErrorCode.INTERNAL_ERROR,
      );
    }

    const template = buildMarketplaceContactTemplate({
      sellerName: listing.seller.name,
      listingTitle: listing.title,
      listingUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/marketplace/${listing.id}`,
      buyerName: name,
      buyerEmail: email,
      buyerPhone: phone ?? null,
      message,
    });

    const sent = await sendEmail({
      to: listing.seller.email,
      toName: listing.seller.name ?? undefined,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: email,
      tags: template.tags,
    });

    if (!sent) {
      return ApiResponse.error(
        res,
        "Failed to send your message. Please try again later.",
        502,
        ErrorCode.INTERNAL_ERROR,
      );
    }

    return ApiResponse.success(res, {
      message: "Your message has been sent to the seller.",
    });
  }),
);

const publicEventQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  category: z.string().optional(),
  search: z.string().optional(),
});

/** An event hidden from public view regardless of any other filter. */
function isPubliclyHiddenEvent(event: { visibility: string; status: string }): boolean {
  return event.visibility !== "PUBLIC" || event.status === "CANCELLED";
}

/**
 * GET /api/public/events
 * Unauthenticated, paginated upcoming-events browse. Hard-filtered to
 * `visibility: "PUBLIC"` regardless of any other param — club-only and private
 * events never reach this route, even for a signed-in caller elsewhere in the
 * app. Shape matches the authenticated `GET /events` response minus the
 * session-dependent fields (`isAttending`, `isHost`, `myTickets`), which are
 * already optional on the web's `EventItem` type.
 */
router.get(
  "/events",
  validateQuery(publicEventQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, category, search } = req.query as any;
    const skip = (page - 1) * limit;

    const where: any = {
      visibility: "PUBLIC",
      status: { not: "CANCELLED" },
      scheduledAt: { gte: new Date() },
    };
    if (category && category !== "ALL") where.category = category;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ];
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          creator: { select: { id: true, name: true, avatar: true, username: true } },
          club: { select: { id: true, name: true, image: true, memberCount: true } },
          ticketTiers: {
            select: { id: true, name: true, price: true, availableQuantity: true },
          },
          _count: {
            select: { participants: { where: { status: "ACCEPTED" } }, tickets: true },
          },
        },
        orderBy: { scheduledAt: "asc" },
        skip,
        take: limit,
      }),
      prisma.event.count({ where }),
    ]);

    const formatted = events.map(({ _count, ...event }) => ({
      ...event,
      participantCount: _count.participants,
      ticketsSold: _count.tickets,
    }));

    return ApiResponse.success(res, {
      events: formatted,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + events.length < total,
    });
  }),
);

/**
 * GET /api/public/events/:id
 * Unauthenticated event detail. A `CLUB_ONLY`/`PRIVATE`/cancelled event 404s
 * here — never a 403 — so a guessed id can't even confirm it exists.
 */
router.get(
  "/events/:id",
  validateParams(idParam),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true, avatar: true, username: true } },
        club: { select: { id: true, name: true, image: true, memberCount: true } },
        ticketTiers: { orderBy: { price: "asc" } },
        _count: {
          select: { participants: { where: { status: "ACCEPTED" } }, tickets: true },
        },
      },
    });

    if (!event || isPubliclyHiddenEvent(event)) {
      return ApiResponse.notFound(res, "Event not found", ErrorCode.NOT_FOUND);
    }

    const { _count, ...rest } = event;
    return ApiResponse.success(res, {
      ...rest,
      participantCount: _count.participants,
      ticketsSold: _count.tickets,
    });
  }),
);

/**
 * GET /api/public/clubs/:id
 * Unauthenticated club preview for web share pages.
 */
router.get(
  "/clubs/:id",
  validateParams(idParam),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const club = await prisma.club.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        image: true,
        location: true,
        memberCount: true,
        isPublic: true,
      },
    });
    if (!club) {
      return ApiResponse.notFound(res, "Club not found", ErrorCode.NOT_FOUND);
    }
    if (!club.isPublic) {
      return ApiResponse.notFound(res, "Club not found", ErrorCode.NOT_FOUND);
    }
    return ApiResponse.success(res, {
      id: club.id,
      name: club.name,
      description: club.description ?? null,
      image: club.image ?? null,
      location: club.location ?? null,
      memberCount: club.memberCount,
      isPublic: club.isPublic,
    });
  }),
);

export default router;
