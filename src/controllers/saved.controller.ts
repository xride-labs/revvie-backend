import { type Request, type Response } from "express";
import prisma from "../lib/prisma.js";
import { ApiResponse, ErrorCode } from "../lib/utils/apiResponse.js";
export class SavedController {
  static async getLocations(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { type, listId } = req.query;

    const where: any = { userId };
    if (type && typeof type === "string") {
      where.type = type.toUpperCase();
    }
    if (listId !== undefined) {
      where.listId = listId === "null" || listId === "" ? null : String(listId);
    }

    const locations = await prisma.savedLocation.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    ApiResponse.success(res, { items: locations });
  }

  static async postLocations(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { name, address, latitude, longitude, type, icon, listId } = req.body;

    const location = await prisma.savedLocation.create({
      data: {
        userId,
        listId: listId || null,
        name,
        address,
        latitude,
        longitude,
        type: type || "FAVORITE",
        icon: icon || null,
      },
    });

    ApiResponse.created(res, location, "Saved destination created");
  }

  static async patchLocationsById(req: Request, res: Response) {
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
  }

  static async deleteLocationsById(req: Request, res: Response) {
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
  }

  // ─────────────────────────────────────────────────────────────
  // Saved Lists / Collections
  // ─────────────────────────────────────────────────────────────

  static async getLists(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;

    const lists = await prisma.savedPlaceList.findMany({
      where: { userId },
      include: {
        _count: { select: { locations: true } },
        locations: {
          take: 5,
          select: {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            type: true,
            icon: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    ApiResponse.success(res, { items: lists });
  }

  static async postLists(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { title, description, icon, color, isPublic } = req.body;

    const list = await prisma.savedPlaceList.create({
      data: {
        userId,
        title,
        description: description || null,
        icon: icon || "map-pin",
        color: color || "#8B5CF6",
        isPublic: Boolean(isPublic),
      },
      include: {
        _count: { select: { locations: true } },
      },
    });

    ApiResponse.created(res, list, "Saved list created");
  }

  static async getListById(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id } = req.params;

    const list = await prisma.savedPlaceList.findFirst({
      where: {
        id,
        OR: [{ userId }, { isPublic: true }],
      },
      include: {
        locations: {
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { locations: true } },
      },
    });

    if (!list) {
      return ApiResponse.notFound(res, "Saved list not found");
    }

    ApiResponse.success(res, list);
  }

  static async patchListById(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id } = req.params;

    const existing = await prisma.savedPlaceList.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return ApiResponse.notFound(res, "Saved list not found");
    }

    const updated = await prisma.savedPlaceList.update({
      where: { id },
      data: req.body,
      include: {
        _count: { select: { locations: true } },
      },
    });

    ApiResponse.success(res, updated, "Saved list updated");
  }

  static async deleteListById(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id } = req.params;

    const existing = await prisma.savedPlaceList.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return ApiResponse.notFound(res, "Saved list not found");
    }

    await prisma.savedPlaceList.delete({ where: { id } });

    ApiResponse.success(res, { deleted: true }, "Saved list deleted");
  }

  static async postPlaceToList(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id: listId } = req.params;

    const list = await prisma.savedPlaceList.findFirst({
      where: { id: listId, userId },
    });

    if (!list) {
      return ApiResponse.notFound(res, "Saved list not found");
    }

    const { name, address, latitude, longitude, type, icon } = req.body;
    const location = await prisma.savedLocation.create({
      data: {
        userId,
        listId,
        name,
        address: address || "",
        latitude,
        longitude,
        type: type || "FAVORITE",
        icon: icon || null,
      },
    });

    // Touch list updatedAt
    await prisma.savedPlaceList.update({
      where: { id: listId },
      data: { updatedAt: new Date() },
    });

    ApiResponse.created(res, location, "Place added to list");
  }

  static async deletePlaceFromList(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id: listId, placeId } = req.params;

    const existing = await prisma.savedLocation.findFirst({
      where: { id: placeId, listId, userId },
    });

    if (!existing) {
      return ApiResponse.notFound(res, "Place not found in this list");
    }

    await prisma.savedLocation.delete({ where: { id: placeId } });

    // Touch list updatedAt
    await prisma.savedPlaceList.update({
      where: { id: listId },
      data: { updatedAt: new Date() },
    });

    ApiResponse.success(res, { deleted: true }, "Place removed from list");
  }

  static async postImportList(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { title, description, icon, color, isPublic, places } = req.body;

    const createdList = await prisma.savedPlaceList.create({
      data: {
        userId,
        title,
        description: description || null,
        icon: icon || "map-pin",
        color: color || "#10B981",
        isPublic: Boolean(isPublic),
        locations: {
          create: (places || []).map((p: any) => ({
            userId,
            name: p.name,
            address: p.address || p.name,
            latitude: p.latitude,
            longitude: p.longitude,
            type: p.type || "VIEWPOINT",
            icon: p.icon || null,
          })),
        },
      },
      include: {
        locations: true,
        _count: { select: { locations: true } },
      },
    });

    ApiResponse.created(
      res,
      createdList,
      `Imported list with ${createdList.locations.length} places`
    );
  }

  static async getRoutes(req: Request, res: Response) {

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
  
  }

  static async postRoutes(req: Request, res: Response) {

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
  
  }

  static async deleteRoutesById(req: Request, res: Response) {

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
  
  }

  static async postRoutesToggleRideById(req: Request, res: Response) {

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
  
  }

}
