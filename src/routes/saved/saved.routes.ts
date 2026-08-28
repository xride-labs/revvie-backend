import { Router, type Request, type Response } from "express";
import prisma from "../../lib/prisma.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { asyncHandler, validateBody } from "../../middlewares/validation.js";
import { requireAuth } from "../../config/auth.js";
import { z } from "zod";

const router = Router();
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────
// Saved Locations (Destinations, Viewpoints, Meetup Spots)
// ─────────────────────────────────────────────────────────────

const savedLocationTypeEnum = z.enum([
  "HOME",
  "WORK",
  "VIEWPOINT",
  "MEETUP",
  "GAS_STATION",
  "FAVORITE",
  "OTHER",
]);

const createSavedLocationSchema = z.object({
  name: z.string().min(1, "Location name is required").max(100),
  address: z.string().min(1, "Address is required"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  type: savedLocationTypeEnum.optional().default("FAVORITE"),
  icon: z.string().max(50).optional().nullable(),
});

const updateSavedLocationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  address: z.string().min(1).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  type: savedLocationTypeEnum.optional(),
  icon: z.string().max(50).optional().nullable(),
});

/**
 * GET /api/saved/locations
 * List saved destinations for current user
 */
router.get(
  "/locations",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const { type } = req.query;

    const where: any = { userId };
    if (type && typeof type === "string") {
      where.type = type.toUpperCase();
    }

    const locations = await prisma.savedLocation.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    ApiResponse.success(res, { items: locations });
  }),
);

/**
 * POST /api/saved/locations
 * Create a new saved destination
 */
router.post(
  "/locations",
  validateBody(createSavedLocationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const { name, address, latitude, longitude, type, icon } = req.body;

    const location = await prisma.savedLocation.create({
      data: {
        userId,
        name,
        address,
        latitude,
        longitude,
        type: type || "FAVORITE",
        icon: icon || null,
      },
    });

    ApiResponse.created(res, location, "Saved destination created");
  }),
);

/**
 * PATCH /api/saved/locations/:id
 * Update a saved destination
 */
router.patch(
  "/locations/:id",
  validateBody(updateSavedLocationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const { id } = req.params;

    const existing = await prisma.savedLocation.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return ApiResponse.notFound(res, "Saved destination not found");
    }

    const updated = await prisma.savedLocation.update({
      where: { id },
      data: req.body,
    });

    ApiResponse.success(res, updated, "Saved destination updated");
  }),
);

/**
 * DELETE /api/saved/locations/:id
 * Delete a saved destination
 */
router.delete(
  "/locations/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const { id } = req.params;

    const existing = await prisma.savedLocation.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return ApiResponse.notFound(res, "Saved destination not found");
    }

    await prisma.savedLocation.delete({ where: { id } });

    ApiResponse.success(res, { deleted: true }, "Saved destination removed");
  }),
);

// ─────────────────────────────────────────────────────────────
// Saved Routes (Bookmarks, Favorite Community Routes)
// ─────────────────────────────────────────────────────────────

const createSavedRouteSchema = z.object({
  rideId: z.string().optional().nullable(),
  title: z.string().max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  startLocation: z.string().optional(),
  startLat: z.number().min(-90).max(90).optional(),
  startLng: z.number().min(-180).max(180).optional(),
  endLocation: z.string().optional().nullable(),
  endLat: z.number().min(-90).max(90).optional().nullable(),
  endLng: z.number().min(-180).max(180).optional().nullable(),
  waypoints: z
    .array(
      z.object({
        latitude: z.number(),
        longitude: z.number(),
        name: z.string().optional(),
        address: z.string().optional(),
      }),
    )
    .optional()
    .nullable(),
  routeData: z.string().optional().nullable(),
  distance: z.number().optional().nullable(),
  duration: z.number().optional().nullable(),
});

/**
 * GET /api/saved/routes
 * List saved routes for current user with pagination and optional search
 */
router.get(
  "/routes",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;

    const where: any = { userId };
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { startLocation: { contains: search, mode: "insensitive" } },
        { endLocation: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.savedRoute.count({ where }),
      prisma.savedRoute.findMany({
        where,
        include: {
          ride: {
            select: {
              id: true,
              title: true,
              status: true,
              images: true,
              creator: {
                select: { id: true, name: true, avatar: true },
              },
              summary: {
                select: {
                  totalDistanceKm: true,
                  totalDurationSec: true,
                  score: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    ApiResponse.paginated(
      res,
      items,
      {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      "Saved routes retrieved successfully",
    );
  }),
);

/**
 * POST /api/saved/routes
 * Save a route either from an existing ride or manually
 */
router.post(
  "/routes",
  validateBody(createSavedRouteSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const { rideId } = req.body;

    if (rideId) {
      const existing = await prisma.savedRoute.findUnique({
        where: { userId_rideId: { userId, rideId } },
      });

      if (existing) {
        return ApiResponse.success(res, existing, "Route is already saved in favorites");
      }

      const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        include: { summary: true },
      });

      if (!ride) {
        return ApiResponse.notFound(res, "Referenced ride not found", ErrorCode.RIDE_NOT_FOUND);
      }

      const saved = await prisma.savedRoute.create({
        data: {
          userId,
          rideId,
          title: req.body.title || ride.title,
          description: req.body.description || ride.description || null,
          startLocation: ride.startLocation || "Starting point",
          startLat: ride.startLat || 0,
          startLng: ride.startLng || 0,
          endLocation: ride.endLocation || null,
          endLat: ride.endLat || null,
          endLng: ride.endLng || null,
          waypoints: ride.waypoints as any,
          routeData: ride.routeData || null,
          distance: ride.summary?.totalDistanceKm || ride.distance || null,
          duration: ride.summary?.totalDurationSec || ride.duration || null,
          isFavorite: true,
        },
      });

      return ApiResponse.created(res, saved, "Route saved to favorites");
    }

    // Manual route creation
    const {
      title,
      description,
      startLocation,
      startLat,
      startLng,
      endLocation,
      endLat,
      endLng,
      waypoints,
      routeData,
      distance,
      duration,
    } = req.body;

    if (!title || !startLocation || startLat == null || startLng == null) {
      return ApiResponse.error(
        res,
        "Title, startLocation, startLat, and startLng are required when not saving from an existing ride",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    const saved = await prisma.savedRoute.create({
      data: {
        userId,
        title,
        description,
        startLocation,
        startLat,
        startLng,
        endLocation,
        endLat,
        endLng,
        waypoints: waypoints || null,
        routeData: routeData || null,
        distance: distance || null,
        duration: duration || null,
        isFavorite: true,
      },
    });

    ApiResponse.created(res, saved, "Route saved to favorites");
  }),
);

/**
 * DELETE /api/saved/routes/:id
 * Remove a route from saved routes
 */
router.delete(
  "/routes/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const { id } = req.params;

    const existing = await prisma.savedRoute.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existing) {
      return ApiResponse.notFound(res, "Saved route not found");
    }

    await prisma.savedRoute.delete({ where: { id } });

    ApiResponse.success(res, { deleted: true }, "Route removed from saved favorites");
  }),
);

/**
 * POST /api/saved/routes/toggle-ride/:id
 * 1-tap bookmark toggle for a ride
 */
router.post(
  "/routes/toggle-ride/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const { id: rideId } = req.params;

    const existing = await prisma.savedRoute.findUnique({
      where: { userId_rideId: { userId, rideId } },
    });

    if (existing) {
      await prisma.savedRoute.delete({ where: { id: existing.id } });
      return ApiResponse.success(
        res,
        { isFavorite: false, savedRoute: null },
        "Removed from favorite routes",
      );
    }

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: { summary: true },
    });

    if (!ride) {
      return ApiResponse.notFound(res, "Ride not found", ErrorCode.RIDE_NOT_FOUND);
    }

    const saved = await prisma.savedRoute.create({
      data: {
        userId,
        rideId,
        title: ride.title,
        description: ride.description || null,
        startLocation: ride.startLocation || "Starting point",
        startLat: ride.startLat || 0,
        startLng: ride.startLng || 0,
        endLocation: ride.endLocation || null,
        endLat: ride.endLat || null,
        endLng: ride.endLng || null,
        waypoints: ride.waypoints as any,
        routeData: ride.routeData || null,
        distance: ride.summary?.totalDistanceKm || ride.distance || null,
        duration: ride.summary?.totalDurationSec || ride.duration || null,
        isFavorite: true,
      },
    });

    ApiResponse.created(
      res,
      { isFavorite: true, savedRoute: saved },
      "Saved to favorite routes",
    );
  }),
);

export default router;
