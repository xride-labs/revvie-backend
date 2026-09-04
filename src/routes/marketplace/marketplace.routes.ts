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
import { requireOwnershipOrAdmin } from "../../middlewares/rbac.js";
import {
  createListingSchema,
  updateListingSchema,
  listingQuerySchema,
  myListingsQuerySchema,
  idParamSchema,
  createReviewSchema,
  createListingOfferSchema,
  updateListingOfferSchema,
  createSavedSearchSchema,
  paginationSchema,
} from "../../validators/schemas.js";
import {
  countUserActiveListings,
  FREE_MARKETPLACE_LISTING_LIMIT,
  isUserPro,
} from "../../lib/subscription.js";
import { requireMarketplaceEnabled } from "../../middlewares/appSettings.js";
import { boundingBox, haversineDistance } from "../../lib/utils/geo.js";

const router = Router();

/** Ceiling on rows scanned for the in-memory radius filter on GET /. */
const GEO_SCAN_CAP = 2000;

// All marketplace routes require authentication
router.use(requireAuth);
router.use(requireMarketplaceEnabled);

const offerIdParamSchema = z.object({
  id: z.string().cuid("Invalid listing ID format"),
  offerId: z.string().cuid("Invalid offer ID format"),
});

async function isAdminOrCoAdmin(userId: string): Promise<boolean> {
  const role = await prisma.userRoleAssignment.findFirst({
    where: {
      userId,
      role: { in: ["ADMIN", "CO_ADMIN"] },
    },
    select: { id: true },
  });

  return !!role;
}

/**
 * @swagger
 * /api/marketplace:
 *   get:
 *     summary: Get all marketplace listings
 *     description: Retrieve a paginated list of active marketplace listings with optional filters
 *     tags: [Marketplace]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of items per page
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *         description: Minimum price filter
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *         description: Maximum price filter
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by listing title or description
 *       - in: query
 *         name: condition
 *         schema:
 *           type: string
 *         description: Filter by item condition
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, SOLD, INACTIVE]
 *         description: Filter by listing status (default ACTIVE)
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *         description: >
 *           Latitude for optional geo filtering. Must be provided together
 *           with lng; omit both to browse without a location filter.
 *       - in: query
 *         name: lng
 *         schema:
 *           type: number
 *         description: >
 *           Longitude for optional geo filtering. Must be provided together
 *           with lat.
 *       - in: query
 *         name: radiusKm
 *         schema:
 *           type: number
 *           default: 25
 *         description: >
 *           Search radius in kilometres, only used when lat/lng are
 *           provided.
 *     responses:
 *       200:
 *         description: >
 *           List of marketplace listings. When lat/lng are supplied, each
 *           listing in the response also includes a `distanceKm` field
 *           (distance from the given point, in kilometres).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 listings:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MarketplaceListing'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get(
  "/",
  validateQuery(listingQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const {
      page,
      limit,
      category,
      subcategory,
      minPrice,
      maxPrice,
      condition,
      status,
      search,
      featured,
      sellerId,
      sort,
      lat,
      lng,
      radiusKm,
    } = req.query as any;
    const skip = (page - 1) * limit;

    const where: any = { status: status || "ACTIVE" };
    if (category) where.category = category;
    if (subcategory) where.subcategory = subcategory;
    if (condition) where.condition = condition;
    if (sellerId) where.sellerId = sellerId;
    if (featured === "true") where.featured = true;
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }
    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }
    // Club-only listings never surface in the global marketplace — they live
    // exclusively inside their club's market. PUBLIC (incl. legacy rows that
    // default to PUBLIC) show here as usual.
    where.visibility = { not: "CLUB_ONLY" };

    // Featured (Pro-boosted) listings always sort first regardless of the
    // requested sort — `sort` only controls the tiebreak within/after that.
    // `trending` proxies "activity" as offer + interest volume (no view
    // tracking exists) since it's the closest real signal available.
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
      case "trending":
        orderBy.push({ offers: { _count: "desc" } }, { interests: { _count: "desc" } });
        break;
    }
    orderBy.push({ createdAt: "desc" });

    const isGeo = lat !== undefined && lng !== undefined;
    let listings: any[];
    let total: number;

    if (isGeo) {
      const bbox = boundingBox(lat, lng, radiusKm);
      where.latitude = { not: null, gte: bbox.minLat, lte: bbox.maxLat };
      where.longitude = { not: null, gte: bbox.minLng, lte: bbox.maxLng };

      // The bbox is a rectangular superset of the true circle, so a
      // Prisma-level skip/take/count against it alone would return short
      // pages and an inflated total. Fetch the (capped) candidate set
      // instead, narrow it to the true circle in memory, then paginate by
      // hand.
      const candidates = await prisma.marketplaceListing.findMany({
        where,
        take: GEO_SCAN_CAP,
        orderBy,
        include: {
          seller: {
            select: { id: true, name: true, avatar: true, phoneVerified: true },
          },
        },
      });
      if (candidates.length === GEO_SCAN_CAP) {
        console.warn(
          `[marketplace] geo scan hit GEO_SCAN_CAP (${GEO_SCAN_CAP}) for lat=${lat} lng=${lng} radiusKm=${radiusKm}`,
        );
      }

      const inCircle: any[] = [];
      for (const l of candidates) {
        if (l.latitude == null || l.longitude == null) continue;
        const d = haversineDistance(lat, lng, l.latitude, l.longitude);
        if (d > radiusKm) continue;
        inCircle.push({ ...l, distanceKm: Math.round(d * 10) / 10 });
      }
      total = inCircle.length;
      listings = inCircle.slice(skip, skip + limit);
    } else {
      const [nonGeoListings, nonGeoTotal] = await Promise.all([
        prisma.marketplaceListing.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            seller: {
              select: { id: true, name: true, avatar: true, phoneVerified: true },
            },
          },
        }),
        prisma.marketplaceListing.count({ where }),
      ]);
      listings = nonGeoListings;
      total = nonGeoTotal;
    }

    // Batched, not per-row: which of these listings has the viewer wishlisted.
    const wishlisted = session?.user?.id
      ? await prisma.wishlist.findMany({
          where: {
            userId: session.user.id,
            listingId: { in: listings.map((l) => l.id) },
          },
          select: { listingId: true },
        })
      : [];
    const wishlistedIds = new Set(wishlisted.map((w) => w.listingId));
    const withWishlist = listings.map((l) => ({
      ...l,
      isWishlisted: wishlistedIds.has(l.id),
    }));

    ApiResponse.paginated(res, withWishlist, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

/**
 * @swagger
 * /api/marketplace/my-listings:
 *   get:
 *     summary: Get current user's listings
 *     description: Retrieve a paginated list of marketplace listings created by the current user
 *     tags: [Marketplace]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, SOLD, INACTIVE]
 *         description: Filter by listing status
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by title or description
 *     responses:
 *       200:
 *         description: List of user's listings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 listings:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MarketplaceListing'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get(
  "/my-listings",
  validateQuery(myListingsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { page, limit, status, category, search } = req.query as any;
    const skip = (page - 1) * limit;

    const where: any = { sellerId: session.user.id };
    if (status) where.status = status;
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [listings, total] = await Promise.all([
      prisma.marketplaceListing.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.marketplaceListing.count({ where }),
    ]);

    ApiResponse.paginated(res, listings, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

/**
 * GET /api/marketplace/wishlist
 * The current user's saved (hearted) listings, newest-saved first.
 * Registered before GET /:id so "wishlist" is never matched as a listing id.
 */
router.get(
  "/wishlist",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { page = 1, limit = 20 } = req.query as any;
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [saved, total] = await Promise.all([
      prisma.wishlist.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
        include: {
          listing: {
            include: {
              seller: { select: { id: true, name: true, avatar: true, phoneVerified: true } },
            },
          },
        },
      }),
      prisma.wishlist.count({ where: { userId: session.user.id } }),
    ]);

    const listings = saved
      .filter((w) => w.listing) // listing may have been deleted since saving
      .map((w) => ({ ...w.listing, isWishlisted: true }));

    ApiResponse.paginated(res, listings, {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    });
  }),
);

/**
 * POST /api/marketplace/:id/wishlist
 * Toggle saving a listing. Body: {} — idempotent toggle, not a set operation.
 */
router.post(
  "/:id/wishlist",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const listing = await prisma.marketplaceListing.findUnique({ where: { id } });
    if (!listing) {
      return ApiResponse.notFound(res, "Listing not found", ErrorCode.LISTING_NOT_FOUND);
    }

    const existing = await prisma.wishlist.findUnique({
      where: { userId_listingId: { userId: session.user.id, listingId: id } },
    });

    if (existing) {
      await prisma.wishlist.delete({ where: { id: existing.id } });
      return ApiResponse.success(res, { wishlisted: false }, "Removed from wishlist");
    }

    await prisma.wishlist.create({
      data: { userId: session.user.id, listingId: id },
    });
    ApiResponse.success(res, { wishlisted: true }, "Saved to wishlist");
  }),
);

/**
 * GET /api/marketplace/recently-viewed
 * Most-recently-viewed listings first. Registered before GET /:id so
 * "recently-viewed" is never matched as a listing id.
 */
router.get(
  "/recently-viewed",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));

    const viewed = await prisma.recentlyViewedListing.findMany({
      where: { userId: session.user.id },
      orderBy: { viewedAt: "desc" },
      take: limit,
      include: {
        listing: {
          include: {
            seller: { select: { id: true, name: true, avatar: true, phoneVerified: true } },
          },
        },
      },
    });

    const listings = viewed
      .filter((v) => v.listing && v.listing.status !== "DRAFT")
      .map((v) => ({ ...v.listing, viewedAt: v.viewedAt }));

    ApiResponse.success(res, { listings });
  }),
);

/**
 * POST /api/marketplace/:id/view
 * Records/bumps a view for "Recently Viewed". Idempotent per (user, listing)
 * — repeat views just bump viewedAt rather than creating a log of rows.
 */
router.post(
  "/:id/view",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
      select: { id: true, sellerId: true },
    });
    if (!listing) {
      return ApiResponse.notFound(res, "Listing not found", ErrorCode.LISTING_NOT_FOUND);
    }

    // Don't clutter a seller's own "recently viewed" with their own listing.
    if (listing.sellerId !== session.user.id) {
      await prisma.recentlyViewedListing.upsert({
        where: { userId_listingId: { userId: session.user.id, listingId: id } },
        create: { userId: session.user.id, listingId: id },
        update: { viewedAt: new Date() },
      });
    }

    ApiResponse.success(res, { recorded: true });
  }),
);

/**
 * Saved Searches — bookmarked filter combinations for the Saved screen's
 * "Searches" tab. No push/alerting infra; re-run on demand from the client.
 */
router.get(
  "/saved-searches",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const searches = await prisma.savedSearch.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    });
    ApiResponse.success(res, { searches });
  }),
);

router.post(
  "/saved-searches",
  validateBody(createSavedSearchSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { label, category, subcategory, search, minPrice, maxPrice, condition } = req.body;

    const saved = await prisma.savedSearch.create({
      data: {
        userId: session.user.id,
        label,
        category,
        subcategory,
        search,
        minPrice,
        maxPrice,
        condition,
      },
    });

    ApiResponse.created(res, { search: saved }, "Search saved");
  }),
);

router.delete(
  "/saved-searches/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const existing = await prisma.savedSearch.findUnique({ where: { id } });
    if (!existing || existing.userId !== session.user.id) {
      return ApiResponse.notFound(res, "Saved search not found");
    }

    await prisma.savedSearch.delete({ where: { id } });
    ApiResponse.success(res, null, "Saved search removed");
  }),
);

/**
 * GET /api/marketplace/dashboard-summary
 * "My Marketplace" overview: selling side (active/draft/sold listings,
 * pending offers, earnings) and buying side (orders, wishlist, recently
 * viewed). Earnings/orders are derived from DEAL_DONE offers — there is no
 * real payment/checkout system, consistent with the marketplace having no
 * cart; this mirrors what the seller and buyer already agreed to offline.
 */
router.get(
  "/dashboard-summary",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const userId = session.user.id;

    const [
      activeListings,
      draftListings,
      soldListings,
      pendingOffers,
      dealsAsSeller,
      dealsAsBuyer,
      wishlistCount,
      recentlyViewedCount,
    ] = await Promise.all([
      prisma.marketplaceListing.count({ where: { sellerId: userId, status: "ACTIVE" } }),
      prisma.marketplaceListing.count({ where: { sellerId: userId, status: "DRAFT" } }),
      prisma.marketplaceListing.count({ where: { sellerId: userId, status: "SOLD" } }),
      prisma.listingOffer.count({
        where: {
          listing: { sellerId: userId },
          status: { in: ["INTERESTED", "OFFER_MADE", "NEGOTIATING"] },
        },
      }),
      prisma.listingOffer.findMany({
        where: { listing: { sellerId: userId }, status: "DEAL_DONE" },
        select: { offeredPrice: true, originalPrice: true },
      }),
      prisma.listingOffer.findMany({
        where: { buyerId: userId, status: "DEAL_DONE" },
        include: {
          listing: {
            select: { id: true, title: true, images: true, price: true, currency: true },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
      }),
      prisma.wishlist.count({ where: { userId } }),
      prisma.recentlyViewedListing.count({ where: { userId } }),
    ]);

    const totalEarnings = dealsAsSeller.reduce(
      (sum, offer) => sum + (offer.offeredPrice ?? offer.originalPrice ?? 0),
      0,
    );

    ApiResponse.success(res, {
      selling: {
        activeListings,
        draftListings,
        soldListings,
        pendingOffers,
        totalEarnings,
        completedSales: dealsAsSeller.length,
      },
      buying: {
        orders: dealsAsBuyer.map((offer) => ({
          id: offer.id,
          listing: offer.listing,
          pricePaid: offer.offeredPrice ?? offer.originalPrice ?? offer.listing.price,
          completedAt: offer.updatedAt,
        })),
        wishlistCount,
        recentlyViewedCount,
      },
    });
  }),
);

/**
 * @swagger
 * /api/marketplace/{id}:
 *   get:
 *     summary: Get listing by ID
 *     description: Retrieve a single marketplace listing by its unique identifier
 *     tags: [Marketplace]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Listing ID
 *     responses:
 *       200:
 *         description: Listing details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 listing:
 *                   $ref: '#/components/schemas/MarketplaceListing'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get(
  "/:id",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
      include: {
        seller: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
            reputationScore: true,
            phoneVerified: true,
            _count: {
              select: {
                marketplaceListings: true,
              },
            },
          },
        },
        reviews: {
          include: {
            reviewer: {
              select: { id: true, name: true, avatar: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        offers: {
          include: {
            buyer: {
              select: {
                id: true,
                name: true,
                username: true,
                avatar: true,
              },
            },
          },
          orderBy: [{ offeredPrice: "desc" }, { updatedAt: "desc" }],
          take: 20,
        },
        interests: {
          select: {
            id: true,
            userId: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    });

    if (!listing) {
      return ApiResponse.notFound(
        res,
        "Listing not found",
        ErrorCode.LISTING_NOT_FOUND,
      );
    }

    const isSeller = listing.sellerId === session.user.id;

    // Drafts are only visible to their own seller — mask as "not found"
    // rather than 403 so non-owners can't even confirm a draft exists.
    if (listing.status === "DRAFT" && !isSeller) {
      return ApiResponse.notFound(
        res,
        "Listing not found",
        ErrorCode.LISTING_NOT_FOUND,
      );
    }

    const myOffer =
      listing.offers.find((offer) => offer.buyerId === session.user.id) || null;
    const activeOffers = listing.offers.filter(
      (offer) => !["REJECTED", "WITHDRAWN", "EXPIRED"].includes(offer.status),
    );
    const highestOffer = activeOffers.reduce<number | null>((best, offer) => {
      if (typeof offer.offeredPrice !== "number") {
        return best;
      }
      if (best === null || offer.offeredPrice > best) {
        return offer.offeredPrice;
      }
      return best;
    }, null);

    // Seller-level rating — the listing's own avgRating/reviewCount cover
    // "how good is THIS item", this covers "how good is THIS seller" across
    // everything they've sold. No cached field for it, so aggregate fresh;
    // fine as a single extra query on a single-item detail endpoint (unlike
    // the list endpoint, where this would be an N+1).
    const [sellerRatingAgg, wishlisted] = await Promise.all([
      prisma.review.aggregate({
        where: { listing: { sellerId: listing.sellerId } },
        _avg: { rating: true },
        _count: true,
      }),
      prisma.wishlist.findUnique({
        where: { userId_listingId: { userId: session.user.id, listingId: id } },
      }),
    ]);

    ApiResponse.success(res, {
      listing: {
        ...listing,
        isWishlisted: !!wishlisted,
        offers: isSeller ? listing.offers : myOffer ? [myOffer] : [],
        offerSummary: {
          totalOffers: listing.offers.length,
          activeOffers: activeOffers.length,
          highestOffer,
          myOffer,
          interestCount: listing.interests.length,
        },
        seller: {
          ...listing.seller,
          avgRating: sellerRatingAgg._avg.rating ?? 0,
          reviewCount: sellerRatingAgg._count,
        },
      },
    });
  }),
);

/**
 * GET /api/marketplace/sellers/:sellerId
 * Seller Profile screen: reputation, verification, active listings, reviews,
 * follow state. Uses its own :sellerId param (not :id) so it never collides
 * with the listing-id routes below.
 */
router.get(
  "/sellers/:sellerId",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { sellerId } = req.params;

    const seller = await prisma.user.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        coverImage: true,
        bio: true,
        location: true,
        phoneVerified: true,
        reputationScore: true,
        createdAt: true,
      },
    });
    if (!seller) {
      return ApiResponse.notFound(res, "Seller not found", ErrorCode.USER_NOT_FOUND);
    }

    const [
      ratingAgg,
      activeListingsCount,
      soldCount,
      listings,
      reviews,
      followerCount,
      followingCount,
      isFollowing,
      offersReceived,
      offersRespondedTo,
    ] = await Promise.all([
      prisma.review.aggregate({
        where: { listing: { sellerId } },
        _avg: { rating: true },
        _count: true,
      }),
      prisma.marketplaceListing.count({ where: { sellerId, status: "ACTIVE" } }),
      prisma.marketplaceListing.count({ where: { sellerId, status: "SOLD" } }),
      prisma.marketplaceListing.findMany({
        where: { sellerId, status: "ACTIVE" },
        orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
        take: 20,
      }),
      prisma.review.findMany({
        where: { listing: { sellerId } },
        include: { reviewer: { select: { id: true, name: true, avatar: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.follow.count({ where: { followingId: sellerId } }),
      prisma.follow.count({ where: { followerId: sellerId } }),
      session?.user?.id && session.user.id !== sellerId
        ? prisma.follow
            .findUnique({
              where: {
                followerId_followingId: { followerId: session.user.id, followingId: sellerId },
              },
              select: { id: true },
            })
            .then((f) => !!f)
        : Promise.resolve(false),
      prisma.listingOffer.count({ where: { listing: { sellerId } } }),
      // A response is any status transition away from the buyer's opening
      // move — an honest proxy since there's no explicit "seller replied" flag.
      prisma.listingOffer.count({
        where: { listing: { sellerId }, status: { notIn: ["INTERESTED", "OFFER_MADE"] } },
      }),
    ]);

    ApiResponse.success(res, {
      seller: {
        ...seller,
        avgRating: ratingAgg._avg.rating ?? 0,
        reviewCount: ratingAgg._count,
        activeListingsCount,
        soldCount,
        followerCount,
        followingCount,
        isFollowing,
        responseRate: offersReceived > 0
          ? Math.round((offersRespondedTo / offersReceived) * 100)
          : null,
      },
      listings,
      reviews,
    });
  }),
);

/**
 * @swagger
 * /api/marketplace:
 *   post:
 *     summary: Create a new listing
 *     description: Create a new marketplace listing with the provided details
 *     tags: [Marketplace]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - price
 *             properties:
 *               title:
 *                 type: string
 *                 example: Carbon Road Bike
 *               description:
 *                 type: string
 *                 example: Excellent condition, barely used
 *               price:
 *                 type: number
 *                 example: 2500.00
 *               currency:
 *                 type: string
 *                 default: USD
 *                 example: USD
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *                 example: ["https://example.com/bike1.jpg"]
 *               category:
 *                 type: string
 *                 example: Bikes
 *               condition:
 *                 type: string
 *                 example: Like New
 *     responses:
 *       201:
 *         description: Listing created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Listing created successfully
 *                 listing:
 *                   $ref: '#/components/schemas/MarketplaceListing'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  "/",
  validateBody(createListingSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const status: "ACTIVE" | "DRAFT" = req.body.status === "DRAFT" ? "DRAFT" : "ACTIVE";

    // Drafts aren't live listings yet, so they don't count against the
    // free-tier active-listing limit.
    if (status === "ACTIVE") {
      const hasPro = await isUserPro(session.user.id);
      if (!hasPro) {
        const activeListingCount = await countUserActiveListings(session.user.id);
        if (activeListingCount >= FREE_MARKETPLACE_LISTING_LIMIT) {
          return ApiResponse.error(
            res,
            `Free users can only keep ${FREE_MARKETPLACE_LISTING_LIMIT} active marketplace listings. Upgrade to Revvie Pro for unlimited listings.`,
            403,
            ErrorCode.SUBSCRIPTION_REQUIRED,
          );
        }
      }
    }

    const {
      title,
      description,
      price,
      currency,
      images,
      videos,
      category,
      subcategory,
      specifications,
      condition,
      locationLabel,
      allowBids,
      latitude,
      longitude,
      clubId,
      visibility,
    } = req.body;

    // Club scoping: you can only post into a club's market if you're a member
    // (or its owner). CLUB_ONLY visibility is meaningless without a club, so it
    // collapses to PUBLIC when no clubId is supplied.
    let effectiveClubId: string | null = null;
    let effectiveVisibility: "PUBLIC" | "CLUB_ONLY" = "PUBLIC";
    if (clubId) {
      const [membership, club] = await Promise.all([
        prisma.clubMember.findUnique({
          where: { clubId_userId: { clubId, userId: session.user.id } },
          select: { id: true },
        }),
        prisma.club.findUnique({
          where: { id: clubId },
          select: { id: true, ownerId: true },
        }),
      ]);
      if (!club) {
        return ApiResponse.notFound(res, "Club not found", ErrorCode.NOT_FOUND);
      }
      if (!membership && club.ownerId !== session.user.id) {
        return ApiResponse.forbidden(
          res,
          "You must be a member of the club to list in its market",
        );
      }
      effectiveClubId = clubId;
      effectiveVisibility = visibility === "CLUB_ONLY" ? "CLUB_ONLY" : "PUBLIC";
    }

    const listing = await prisma.marketplaceListing.create({
      data: {
        title,
        description,
        price,
        currency: currency || "INR",
        images: images || [],
        videos: videos || [],
        category,
        subcategory,
        specifications,
        condition,
        locationLabel,
        allowBids: allowBids ?? true,
        latitude,
        longitude,
        sellerId: session.user.id,
        clubId: effectiveClubId,
        visibility: effectiveVisibility,
      },
      include: {
        seller: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Ensure user has SELLER role
    await prisma.userRoleAssignment.upsert({
      where: { userId_role: { userId: session.user.id, role: "SELLER" } },
      create: { userId: session.user.id, role: "SELLER" },
      update: {},
    });

    ApiResponse.created(res, { listing }, "Listing created successfully");
  }),
);

/**
 * @swagger
 * /api/marketplace/{id}:
 *   patch:
 *     summary: Update a listing
 *     description: Update listing details. Must be the seller or admin. Listing images should be uploaded via /api/media/upload/listing/{listingId} endpoint and will be served via Cloudinary CDN.
 *     tags: [Marketplace]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               currency:
 *                 type: string
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *                 description: Array of Cloudinary image URLs (max 10)
 *               category:
 *                 type: string
 *                 enum: [Motorcycle, Gear, Accessories, Parts, Other]
 *               condition:
 *                 type: string
 *                 enum: [New, Like New, Good, Fair, Poor]
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, SOLD, INACTIVE]
 *     responses:
 *       200:
 *         description: Listing updated successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not listing owner or admin
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch(
  "/:id",
  validateParams(idParamSchema),
  validateBody(updateListingSchema),
  requireOwnershipOrAdmin("listing"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
      title,
      description,
      price,
      currency,
      images,
      videos,
      category,
      subcategory,
      specifications,
      condition,
      locationLabel,
      allowBids,
      latitude,
      longitude,
      status,
    } = req.body;

    // Publishing a draft (or reactivating an inactive listing) still has to
    // clear the free-tier active-listing gate — otherwise a free user could
    // stockpile unlimited drafts and publish past the limit via PATCH.
    if (status === "ACTIVE") {
      const current = await prisma.marketplaceListing.findUnique({
        where: { id },
        select: { status: true, sellerId: true },
      });
      if (current && current.status !== "ACTIVE") {
        const hasPro = await isUserPro(current.sellerId);
        if (!hasPro) {
          const activeListingCount = await countUserActiveListings(current.sellerId);
          if (activeListingCount >= FREE_MARKETPLACE_LISTING_LIMIT) {
            return ApiResponse.error(
              res,
              `Free users can only keep ${FREE_MARKETPLACE_LISTING_LIMIT} active marketplace listings. Upgrade to Revvie Pro for unlimited listings.`,
              403,
              ErrorCode.SUBSCRIPTION_REQUIRED,
            );
          }
        }
      }
    }

    const listing = await prisma.marketplaceListing.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(price !== undefined && { price }),
        ...(currency !== undefined && { currency }),
        ...(images !== undefined && { images }),
        ...(videos !== undefined && { videos }),
        ...(category !== undefined && { category }),
        ...(subcategory !== undefined && { subcategory }),
        ...(specifications !== undefined && { specifications }),
        ...(condition !== undefined && { condition }),
        ...(locationLabel !== undefined && { locationLabel }),
        ...(allowBids !== undefined && { allowBids }),
        ...(latitude !== undefined && { latitude }),
        ...(longitude !== undefined && { longitude }),
        ...(status !== undefined && { status }),
      },
      include: {
        seller: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    ApiResponse.success(res, { listing }, "Listing updated successfully");
  }),
);

/**
 * @swagger
 * /api/marketplace/{id}:
 *   delete:
 *     summary: Delete a listing
 *     description: Delete a marketplace listing and all its reviews. Must be the seller or admin.
 *     tags: [Marketplace]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Listing deleted successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not listing owner or admin
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  "/:id",
  validateParams(idParamSchema),
  requireOwnershipOrAdmin("listing"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Delete reviews first
    await prisma.review.deleteMany({
      where: { listingId: id },
    });

    await prisma.marketplaceListing.delete({
      where: { id },
    });

    ApiResponse.success(res, null, "Listing deleted successfully");
  }),
);

/**
 * Pro-only: feature (boost) a listing so it sorts first in the marketplace.
 * The boost lasts `durationDays` days (default 7); after that the index
 * naturally drops it back. We don't auto-charge per-boost — we treat it as
 * a Pro perk rather than an a-la-carte purchase.
 */
const featureListingSchema = z.object({
  durationDays: z.number().int().min(1).max(30).default(7),
});

router.post(
  "/:id/feature",
  validateParams(idParamSchema),
  validateBody(featureListingSchema),
  requireOwnershipOrAdmin("listing"),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;
    const { durationDays } = req.body;

    const hasPro = await isUserPro(session.user.id);
    if (!hasPro) {
      return ApiResponse.error(
        res,
        "Featuring listings is a Revvie Pro perk. Upgrade to boost your listings.",
        403,
        ErrorCode.SUBSCRIPTION_REQUIRED,
      );
    }

    const featuredUntil = new Date(
      Date.now() + durationDays * 24 * 60 * 60 * 1000,
    );

    const listing = await prisma.marketplaceListing.update({
      where: { id },
      data: { featured: true, featuredUntil },
      select: { id: true, featured: true, featuredUntil: true },
    });

    ApiResponse.success(res, { listing }, "Listing featured successfully");
  }),
);

router.post(
  "/:id/unfeature",
  validateParams(idParamSchema),
  requireOwnershipOrAdmin("listing"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const listing = await prisma.marketplaceListing.update({
      where: { id },
      data: { featured: false, featuredUntil: null },
      select: { id: true, featured: true, featuredUntil: true },
    });

    ApiResponse.success(res, { listing }, "Listing unfeatured");
  }),
);

/**
 * @swagger
 * /api/marketplace/{id}/reviews:
 *   post:
 *     summary: Add a review to a listing
 *     description: Add a review to a marketplace listing. Cannot review own listing. Can only review once per listing.
 *     tags: [Marketplace]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Listing ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - rating
 *             properties:
 *               rating:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *               comment:
 *                 type: string
 *     responses:
 *       201:
 *         description: Review added successfully
 *       400:
 *         description: Cannot review own listing
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Already reviewed this listing
 */
router.post(
  "/:id/reviews",
  validateParams(idParamSchema),
  validateBody(createReviewSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;
    const { rating, comment } = req.body;

    // Check if listing exists
    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
    });

    if (!listing) {
      return ApiResponse.notFound(
        res,
        "Listing not found",
        ErrorCode.LISTING_NOT_FOUND,
      );
    }

    // Can't review own listing
    if (listing.sellerId === session.user.id) {
      return ApiResponse.error(
        res,
        "You cannot review your own listing",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    // Check if already reviewed
    const existingReview = await prisma.review.findUnique({
      where: {
        listingId_reviewerId: { listingId: id, reviewerId: session.user.id },
      },
    });

    if (existingReview) {
      return ApiResponse.conflict(
        res,
        "You have already reviewed this listing",
      );
    }

    const review = await prisma.review.create({
      data: {
        listingId: id,
        reviewerId: session.user.id,
        rating,
        comment,
      },
      include: {
        reviewer: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Recompute the listing's denormalized rating so list-page cards and
    // "sort by rating" stay correct without a join at read time.
    const agg = await prisma.review.aggregate({
      where: { listingId: id },
      _avg: { rating: true },
      _count: true,
    });
    await prisma.marketplaceListing.update({
      where: { id },
      data: {
        avgRating: agg._avg.rating ?? 0,
        reviewCount: agg._count,
      },
    });

    ApiResponse.created(res, { review }, "Review added successfully");
  }),
);

router.post(
  "/:id/interests",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
      select: { id: true, sellerId: true },
    });

    if (!listing) {
      return ApiResponse.notFound(
        res,
        "Listing not found",
        ErrorCode.LISTING_NOT_FOUND,
      );
    }

    if (listing.sellerId === session.user.id) {
      return ApiResponse.error(
        res,
        "You cannot mark interest on your own listing",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    const interest = await prisma.listingInterest.upsert({
      where: {
        listingId_userId: {
          listingId: id,
          userId: session.user.id,
        },
      },
      create: {
        listingId: id,
        userId: session.user.id,
      },
      update: {},
    });

    ApiResponse.success(res, { interest }, "Interest added successfully");
  }),
);

router.post(
  "/:id/offers",
  validateParams(idParamSchema),
  validateBody(createListingOfferSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;
    const { offeredPrice, message } = req.body;

    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        sellerId: true,
        price: true,
        allowBids: true,
        status: true,
      },
    });

    if (!listing) {
      return ApiResponse.notFound(
        res,
        "Listing not found",
        ErrorCode.LISTING_NOT_FOUND,
      );
    }

    if (listing.sellerId === session.user.id) {
      return ApiResponse.error(
        res,
        "You cannot place a bid on your own listing",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    if (listing.status !== "ACTIVE") {
      return ApiResponse.error(
        res,
        "Bids are only allowed on active listings",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    if (!listing.allowBids) {
      return ApiResponse.error(
        res,
        "This seller has disabled bidding for the listing",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    const existingOffer = await prisma.listingOffer.findUnique({
      where: {
        listingId_buyerId: {
          listingId: id,
          buyerId: session.user.id,
        },
      },
      select: {
        id: true,
        negotiationHistory: true,
      },
    });

    let history: Array<Record<string, unknown>> = [];
    if (existingOffer?.negotiationHistory) {
      try {
        history = JSON.parse(existingOffer.negotiationHistory);
      } catch {
        history = [];
      }
    }

    history.push({
      actor: "buyer",
      status: existingOffer ? "NEGOTIATING" : "OFFER_MADE",
      offeredPrice,
      message,
      at: new Date().toISOString(),
    });

    const offer = await prisma.listingOffer.upsert({
      where: {
        listingId_buyerId: {
          listingId: id,
          buyerId: session.user.id,
        },
      },
      create: {
        listingId: id,
        buyerId: session.user.id,
        status: "OFFER_MADE",
        originalPrice: listing.price,
        offeredPrice,
        message,
        lastMessageAt: new Date(),
        negotiationHistory: JSON.stringify(history),
      },
      update: {
        status: "NEGOTIATING",
        offeredPrice,
        message,
        lastMessageAt: new Date(),
        negotiationHistory: JSON.stringify(history),
      },
      include: {
        buyer: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
          },
        },
      },
    });

    ApiResponse.success(res, { offer }, "Bid placed successfully");
  }),
);

router.get(
  "/:id/offers/my",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const offer = await prisma.listingOffer.findUnique({
      where: {
        listingId_buyerId: {
          listingId: id,
          buyerId: session.user.id,
        },
      },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            price: true,
            sellerId: true,
          },
        },
      },
    });

    ApiResponse.success(res, { offer: offer || null });
  }),
);

router.get(
  "/:id/offers",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const listing = await prisma.marketplaceListing.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        sellerId: true,
      },
    });

    if (!listing) {
      return ApiResponse.notFound(
        res,
        "Listing not found",
        ErrorCode.LISTING_NOT_FOUND,
      );
    }

    const isSeller = listing.sellerId === session.user.id;
    const isAdmin = await isAdminOrCoAdmin(session.user.id);

    if (!isSeller && !isAdmin) {
      return ApiResponse.forbidden(
        res,
        "Only the seller can view all bids for this listing",
      );
    }

    const offers = await prisma.listingOffer.findMany({
      where: { listingId: id },
      include: {
        buyer: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
          },
        },
      },
      orderBy: [{ offeredPrice: "desc" }, { updatedAt: "desc" }],
    });

    ApiResponse.success(res, {
      listing,
      offers,
      summary: {
        totalOffers: offers.length,
        highestOffer: offers.length > 0 ? offers[0].offeredPrice : null,
      },
    });
  }),
);

router.patch(
  "/:id/offers/:offerId",
  validateParams(offerIdParamSchema),
  validateBody(updateListingOfferSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id, offerId } = req.params;
    const { status, offeredPrice, message } = req.body;

    const offer = await prisma.listingOffer.findUnique({
      where: { id: offerId },
      include: {
        listing: {
          select: {
            id: true,
            sellerId: true,
            status: true,
          },
        },
      },
    });

    if (!offer || offer.listingId !== id) {
      return ApiResponse.notFound(res, "Offer not found", ErrorCode.NOT_FOUND);
    }

    const isSeller = offer.listing.sellerId === session.user.id;
    const isBuyer = offer.buyerId === session.user.id;
    const isAdmin = await isAdminOrCoAdmin(session.user.id);

    if (!isSeller && !isBuyer && !isAdmin) {
      return ApiResponse.forbidden(
        res,
        "You do not have permission to update this offer",
      );
    }

    const buyerOnlyStatuses = new Set(["WITHDRAWN"]);
    const sellerStatuses = new Set([
      "NEGOTIATING",
      "ACCEPTED",
      "DEAL_DONE",
      "REJECTED",
      "EXPIRED",
    ]);

    if (buyerOnlyStatuses.has(status) && !isBuyer) {
      return ApiResponse.forbidden(res, "Only the buyer can withdraw an offer");
    }

    if (sellerStatuses.has(status) && !isSeller && !isAdmin) {
      return ApiResponse.forbidden(
        res,
        "Only the seller can update offer status to this value",
      );
    }

    let history: Array<Record<string, unknown>> = [];
    if (offer.negotiationHistory) {
      try {
        history = JSON.parse(offer.negotiationHistory);
      } catch {
        history = [];
      }
    }

    history.push({
      actor: isSeller || isAdmin ? "seller" : "buyer",
      status,
      offeredPrice,
      message,
      at: new Date().toISOString(),
    });

    const updatedOffer = await prisma.listingOffer.update({
      where: { id: offerId },
      data: {
        status,
        ...(offeredPrice !== undefined && { offeredPrice }),
        ...(message !== undefined && { message }),
        lastMessageAt: new Date(),
        negotiationHistory: JSON.stringify(history),
      },
      include: {
        buyer: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
          },
        },
      },
    });

    if (status === "DEAL_DONE" || status === "ACCEPTED") {
      await prisma.marketplaceListing.update({
        where: { id },
        data: {
          status: status === "DEAL_DONE" ? "SOLD" : offer.listing.status,
        },
      });
    }

    ApiResponse.success(
      res,
      { offer: updatedOffer },
      "Offer updated successfully",
    );
  }),
);

export default router;
