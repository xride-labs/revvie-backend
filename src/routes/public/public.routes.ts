import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { asyncHandler, validateParams } from "../../middlewares/validation.js";
import { z } from "zod";
import { requireMarketplaceEnabled } from "../../middlewares/appSettings.js";

const router = Router();

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

/** Small, fixed-size preview for the marketing landing page — not paginated. */
const PUBLIC_MARKETPLACE_PREVIEW_LIMIT = 8;

/**
 * GET /api/public/marketplace
 * Unauthenticated marketplace preview for the marketing site's landing page.
 * Mirrors the visibility rules of the authenticated `GET /marketplace` list
 * (active, non club-only listings, featured first) but returns a small fixed
 * page with a curated field set — no pagination params, no internal filters.
 */
router.get(
  "/marketplace",
  requireMarketplaceEnabled,
  asyncHandler(async (_req: Request, res: Response) => {
    const listings = await prisma.marketplaceListing.findMany({
      where: {
        status: "ACTIVE",
        visibility: { not: "CLUB_ONLY" },
      },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: PUBLIC_MARKETPLACE_PREVIEW_LIMIT,
      include: {
        seller: { select: { id: true, name: true, avatar: true } },
        club: { select: { id: true, name: true } },
      },
    });

    return ApiResponse.success(res, {
      listings: listings.map((listing) => ({
        id: listing.id,
        title: listing.title,
        price: listing.price,
        currency: listing.currency,
        condition: listing.condition ?? null,
        image: listing.images[0] ?? null,
        category: listing.category ?? null,
        featured: listing.featured,
        seller: {
          id: listing.seller.id,
          name: listing.seller.name,
          avatar: listing.seller.avatar ?? null,
        },
        club: listing.club ? { id: listing.club.id, name: listing.club.name } : null,
        rating: listing.reviewCount > 0 ? listing.avgRating : null,
        ratingCount: listing.reviewCount,
      })),
    });
  }),
);

/**
 * GET /api/public/marketplace/:id
 * Unauthenticated listing preview for web share pages.
 */
router.get(
  "/marketplace/:id",
  validateParams(idParam),
  requireMarketplaceEnabled,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        price: true,
        currency: true,
        condition: true,
        images: true,
        category: true,
        status: true,
      },
    });
    if (!listing) {
      return ApiResponse.notFound(
        res,
        "Listing not found",
        ErrorCode.NOT_FOUND,
      );
    }
    return ApiResponse.success(res, {
      id: listing.id,
      title: listing.title,
      price: listing.price,
      currency: listing.currency,
      condition: listing.condition ?? null,
      image: listing.images[0] ?? null,
      category: listing.category ?? null,
      status: listing.status,
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
