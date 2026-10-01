import { type Request, type Response } from "express";
import crypto from "crypto";
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
      include: { place: true },
      orderBy: { createdAt: "desc" },
    });

    const mappedLocations = locations.map(l => ({
      ...l,
      name: l.customName || l.place?.name || "Unknown",
      address: l.place?.address || "",
      latitude: l.place?.latitude || 0,
      longitude: l.place?.longitude || 0,
      icon: l.icon || l.place?.icon || null,
      place: undefined,
      customName: undefined
    }));

    ApiResponse.success(res, { items: mappedLocations });
  }

  static async postLocations(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { name, address, latitude, longitude, type, icon, listId } = req.body;

    let place = await prisma.place.findFirst({
      where: {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        name: name
      }
    });

    if (!place) {
      place = await prisma.place.create({
        data: {
          name,
          address: address || "",
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          icon: icon || null
        }
      });
    }

    const location = await prisma.savedLocation.create({
      data: {
        userId,
        listId: listId || null,
        addedById: userId,
        placeId: place.id,
        customName: name,
        type: type || "FAVORITE",
        icon: icon || null,
      },
      include: { place: true }
    });

    const mapped = {
      ...location,
      name: location.customName || location.place?.name,
      address: location.place?.address,
      latitude: location.place?.latitude,
      longitude: location.place?.longitude,
      icon: location.icon || location.place?.icon,
      place: undefined,
      customName: undefined
    };

    ApiResponse.created(res, mapped, "Saved destination created");
  }

  static async patchLocationsById(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id } = req.params;

    const existing = await prisma.savedLocation.findFirst({
      where: { id, userId },
      include: { place: true },
    });

    if (!existing) {
      return ApiResponse.notFound(res, "Saved destination not found");
    }
    
    // For patch, map incoming name to customName
    const updateData: any = { ...req.body };
    if (updateData.name) {
      updateData.customName = updateData.name;
      delete updateData.name;
    }
    // Ignore latitude/longitude/address updates since they belong to Place
    delete updateData.latitude;
    delete updateData.longitude;
    delete updateData.address;

    const updated = await prisma.savedLocation.update({
      where: { id },
      data: updateData,
      include: { place: true }
    });
    
    const mapped = {
      ...updated,
      name: updated.customName || updated.place?.name,
      address: updated.place?.address,
      latitude: updated.place?.latitude,
      longitude: updated.place?.longitude,
      icon: updated.icon || updated.place?.icon,
      place: undefined,
      customName: undefined
    };

    ApiResponse.success(res, mapped, "Saved destination updated");
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
  // Saved Lists / Collections & Collaborative Playlists
  // ─────────────────────────────────────────────────────────────

  static generateShareCode(prefix = "RV"): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let random = "";
    for (let i = 0; i < 6; i++) {
      random += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${prefix}-${random.slice(0, 3)}-${random.slice(3)}`;
  }

  static async ensureDefaultLists(userId: string) {
    const defaultTemplates = [
      { title: "Want to go", icon: "flag", color: "#F59E0B", description: "Places you want to visit and explore" },
      { title: "Travel plans", icon: "briefcase", color: "#3B82F6", description: "Itineraries, stops, and road trip milestones" },
      { title: "Favorites", icon: "heart", color: "#EF4444", description: "Your all-time favorite riding spots and stops" },
      { title: "Starred places", icon: "star", color: "#EAB308", description: "Special destinations and viewpoints" },
      { title: "Saved places", icon: "bookmark", color: "#10B981", description: "Quick saved locations and pit stops" },
    ];

    try {
      const existing = await prisma.savedPlaceList.findMany({
        where: { userId },
        select: { title: true },
      });
      const titles = new Set(existing.map((l) => l.title.toLowerCase().trim()));

      for (const t of defaultTemplates) {
        if (!titles.has(t.title.toLowerCase().trim())) {
          await prisma.savedPlaceList.create({
            data: {
              userId,
              title: t.title,
              description: t.description,
              icon: t.icon,
              color: t.color,
              isPublic: false,
              isDefault: true,
              isCollaborative: false,
              shareCode: SavedController.generateShareCode("RV"),
              inviteToken: crypto.randomUUID(),
            },
          });
        }
      }
    } catch (e) {
      console.warn("[SAVED] Error ensuring default lists:", e);
    }
  }

  static async getLists(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    if (!userId) {
      return ApiResponse.unauthorized(res);
    }

    // Auto-create default 5 lists if missing for this user
    await SavedController.ensureDefaultLists(userId);

    const [ownedLists, memberRows] = await Promise.all([
      prisma.savedPlaceList.findMany({
        where: { userId },
        include: {
          _count: { select: { locations: true, members: true } },
          locations: {
            take: 5,
            select: {
              id: true,
              type: true,
              icon: true,
              customName: true,
              place: {
                select: {
                  name: true,
                  latitude: true,
                  longitude: true,
                  address: true,
                  icon: true
                }
              }
            },
          },
          members: {
            take: 4,
            include: {
              user: {
                select: { id: true, name: true, username: true, avatar: true },
              },
            },
          },
          user: {
            select: { id: true, name: true, username: true, avatar: true },
          },
        },
        orderBy: [
          { isDefault: "desc" },
          { updatedAt: "desc" },
        ],
      }),
      prisma.savedPlaceListMember.findMany({
        where: { userId },
        include: {
          list: {
            include: {
              _count: { select: { locations: true, members: true } },
              locations: {
                take: 5,
                select: {
                  id: true,
                  type: true,
                  icon: true,
                  customName: true,
                  place: {
                    select: {
                      name: true,
                      latitude: true,
                      longitude: true,
                      address: true,
                      icon: true
                    }
                  }
                },
              },
              members: {
                take: 4,
                include: {
                  user: {
                    select: { id: true, name: true, username: true, avatar: true },
                  },
                },
              },
              user: {
                select: { id: true, name: true, username: true, avatar: true },
              },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    const mapListLocations = (l: any) => ({
      ...l,
      locations: l.locations.map((loc: any) => ({
        ...loc,
        name: loc.customName || loc.place?.name || "Unknown",
        latitude: loc.place?.latitude || 0,
        longitude: loc.place?.longitude || 0,
        address: loc.place?.address || "",
        icon: loc.icon || loc.place?.icon || null,
        place: undefined,
        customName: undefined
      }))
    });

    const myLists = ownedLists.map((l) => ({ ...mapListLocations(l), role: "OWNER" as const }));
    const joinedLists = memberRows
      .filter((mr) => mr.list && mr.list.userId !== userId)
      .map((mr) => ({ ...mapListLocations(mr.list), role: mr.role }));

    const allItems = [...myLists, ...joinedLists];

    ApiResponse.success(res, {
      items: allItems,
      myLists,
      joinedLists,
    });
  }

  static async postLists(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { title, description, icon, color, isPublic, isCollaborative } = req.body;

    const list = await prisma.savedPlaceList.create({
      data: {
        userId,
        title,
        description: description || null,
        icon: icon || "map-pin",
        color: color || "#8B5CF6",
        isPublic: Boolean(isPublic),
        isDefault: false,
        isCollaborative: Boolean(isCollaborative),
        shareCode: SavedController.generateShareCode("RV"),
        inviteToken: crypto.randomUUID(),
      },
      include: {
        _count: { select: { locations: true, members: true } },
        user: { select: { id: true, name: true, username: true, avatar: true } },
      },
    });

    ApiResponse.created(res, { ...list, role: "OWNER" }, "Saved list created");
  }

  static async getListById(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id } = req.params;

    const list = await prisma.savedPlaceList.findFirst({
      where: {
        id,
        OR: [
          { userId },
          { isPublic: true },
          { members: { some: { userId } } },
        ],
      },
      include: {
        locations: {
          orderBy: { createdAt: "asc" },
          include: {
            place: true,
            addedBy: {
              select: { id: true, name: true, username: true, avatar: true },
            },
          },
        },
        members: {
          include: {
            user: {
              select: { id: true, name: true, username: true, avatar: true },
            },
          },
        },
        user: {
          select: { id: true, name: true, username: true, avatar: true },
        },
        _count: { select: { locations: true, members: true } },
      },
    });

    if (!list) {
      return ApiResponse.notFound(res, "Saved list not found");
    }

    const isOwner = list.userId === userId;
    const member = list.members.find((m) => m.user.id === userId);
    const role = isOwner ? "OWNER" : member?.role || (list.isPublic ? "VIEWER" : "NONE");

    const mappedLocations = list.locations.map((loc: any) => ({
      ...loc,
      name: loc.customName || loc.place?.name || "Unknown",
      address: loc.place?.address || "",
      latitude: loc.place?.latitude || 0,
      longitude: loc.place?.longitude || 0,
      icon: loc.icon || loc.place?.icon || null,
      place: undefined,
      customName: undefined
    }));

    ApiResponse.success(res, {
      ...list,
      locations: mappedLocations,
      userRole: role,
      isOwner,
    });
  }

  static async patchListById(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id } = req.params;

    const existing = await prisma.savedPlaceList.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return ApiResponse.notFound(res, "Saved list not found or unauthorized");
    }

    const updated = await prisma.savedPlaceList.update({
      where: { id },
      data: req.body,
      include: {
        _count: { select: { locations: true, members: true } },
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

    if (existing.isDefault) {
      return ApiResponse.badRequest(res, "Default lists cannot be deleted");
    }

    await prisma.savedPlaceList.delete({ where: { id } });

    ApiResponse.success(res, { deleted: true }, "Saved list deleted");
  }

  static async postPlaceToList(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id: listId } = req.params;

    // Allowed if user is owner or list is collaborative and user is a contributor
    const list = await prisma.savedPlaceList.findFirst({
      where: {
        id: listId,
        OR: [
          { userId },
          {
            isCollaborative: true,
            members: {
              some: {
                userId,
                role: { in: ["OWNER", "CONTRIBUTOR"] },
              },
            },
          },
        ],
      },
    });

    if (!list) {
      return ApiResponse.forbidden(res, "You do not have permission to add places to this list");
    }

    const { name, address, latitude, longitude, type, icon } = req.body;
    
    let place = await prisma.place.findFirst({
      where: {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        name: name
      }
    });

    if (!place) {
      place = await prisma.place.create({
        data: {
          name,
          address: address || "",
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          icon: icon || null
        }
      });
    }

    const location = await prisma.savedLocation.create({
      data: {
        userId,
        addedById: userId,
        listId,
        placeId: place.id,
        customName: name,
        type: type || "FAVORITE",
        icon: icon || null,
      },
      include: {
        place: true,
        addedBy: {
          select: { id: true, name: true, username: true, avatar: true },
        },
      },
    });

    // Touch list updatedAt
    await prisma.savedPlaceList.update({
      where: { id: listId },
      data: { updatedAt: new Date() },
    });

    const mapped = {
      ...location,
      name: location.customName || location.place?.name,
      address: location.place?.address,
      latitude: location.place?.latitude,
      longitude: location.place?.longitude,
      icon: location.icon || location.place?.icon,
      place: undefined,
      customName: undefined
    };

    ApiResponse.created(res, mapped, "Place added to list");
  }

  static async deletePlaceFromList(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id: listId, placeId } = req.params;

    const place = await prisma.savedLocation.findFirst({
      where: { id: placeId, listId },
      include: { list: true },
    });

    if (!place) {
      return ApiResponse.notFound(res, "Place not found in this list");
    }

    const isCreator = place.userId === userId || place.addedById === userId;
    const isOwner = place.list?.userId === userId;

    if (!isCreator && !isOwner) {
      return ApiResponse.forbidden(res, "You do not have permission to remove this place");
    }

    await prisma.savedLocation.delete({ where: { id: placeId } });

    // Touch list updatedAt
    await prisma.savedPlaceList.update({
      where: { id: listId },
      data: { updatedAt: new Date() },
    });

    ApiResponse.success(res, { deleted: true }, "Place removed from list");
  }

  static async postJoinList(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { shareCode, inviteToken } = req.body;

    if (!shareCode && !inviteToken) {
      return ApiResponse.badRequest(res, "Share code or invite token is required");
    }

    const list = await prisma.savedPlaceList.findFirst({
      where: shareCode
        ? { shareCode: String(shareCode).trim().toUpperCase() }
        : { inviteToken: String(inviteToken).trim() },
      include: {
        user: { select: { id: true, name: true, username: true, avatar: true } },
        _count: { select: { locations: true, members: true } },
      },
    });

    if (!list) {
      return ApiResponse.notFound(res, "List not found. Please verify the code or link.");
    }

    if (list.userId === userId) {
      return ApiResponse.success(res, { ...list, role: "OWNER", isOwner: true }, "You are the owner of this list");
    }

    // Add user as contributor
    const member = await prisma.savedPlaceListMember.upsert({
      where: {
        listId_userId: {
          listId: list.id,
          userId,
        },
      },
      update: { role: "CONTRIBUTOR" },
      create: {
        listId: list.id,
        userId,
        role: "CONTRIBUTOR",
      },
      include: {
        user: { select: { id: true, name: true, username: true, avatar: true } },
      },
    });

    ApiResponse.success(res, { ...list, role: member.role, isOwner: false }, "Successfully joined list!");
  }

  static async postInviteFriends(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id: listId } = req.params;
    const { userIds } = req.body as { userIds: string[] };

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return ApiResponse.badRequest(res, "At least one user ID is required");
    }

    const list = await prisma.savedPlaceList.findFirst({
      where: { id: listId, userId },
    });

    if (!list) {
      return ApiResponse.forbidden(res, "Only the list owner can invite friends directly");
    }

    // Ensure list is collaborative
    if (!list.isCollaborative) {
      await prisma.savedPlaceList.update({
        where: { id: listId },
        data: { isCollaborative: true },
      });
    }

    const created = await Promise.all(
      userIds.map((invitedId) =>
        prisma.savedPlaceListMember.upsert({
          where: {
            listId_userId: {
              listId,
              userId: invitedId,
            },
          },
          update: { role: "CONTRIBUTOR" },
          create: {
            listId,
            userId: invitedId,
            role: "CONTRIBUTOR",
          },
        })
      )
    );

    ApiResponse.success(res, { invitedCount: created.length }, "Friends added as contributors");
  }

  static async deleteMember(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id: listId, memberId } = req.params;

    const list = await prisma.savedPlaceList.findUnique({
      where: { id: listId },
    });

    if (!list) {
      return ApiResponse.notFound(res, "List not found");
    }

    const isOwner = list.userId === userId;
    const isSelf = memberId === userId;

    if (!isOwner && !isSelf) {
      return ApiResponse.forbidden(res, "You do not have permission to remove this member");
    }

    await prisma.savedPlaceListMember.deleteMany({
      where: {
        listId,
        userId: memberId,
      },
    });

    ApiResponse.success(res, { removed: true }, "Member removed from list");
  }

  static async toggleCollab(req: Request, res: Response) {
    const userId = (req as any).session?.user?.id;
    const { id } = req.params;
    const { isCollaborative } = req.body;

    const list = await prisma.savedPlaceList.findFirst({
      where: { id, userId },
    });

    if (!list) {
      return ApiResponse.notFound(res, "Saved list not found");
    }

    const nextCollab = isCollaborative !== undefined ? Boolean(isCollaborative) : !list.isCollaborative;

    const updated = await prisma.savedPlaceList.update({
      where: { id },
      data: {
        isCollaborative: nextCollab,
        shareCode: list.shareCode || SavedController.generateShareCode("RV"),
        inviteToken: list.inviteToken || crypto.randomUUID(),
      },
      include: {
        _count: { select: { locations: true, members: true } },
      },
    });

    ApiResponse.success(res, updated, "Collaboration setting updated");
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
