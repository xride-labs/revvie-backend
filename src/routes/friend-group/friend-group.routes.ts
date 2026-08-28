import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma.js";
import { isStaff } from "../../lib/utils/permissions.js";
import { requireAuth } from "../../config/auth.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { asyncHandler, validateQuery } from "../../middlewares/validation.js";
import { friendGroupQuerySchema } from "../../validators/schemas.js";
import { createNotification, notifyUsers } from "../../lib/notifications.js";
import {
  normalizeExperienceLevel,
  normalizePace,
} from "../../lib/utils/rideEnums.js";

const router = Router();

// All friend group routes require authentication
router.use(requireAuth);

/**
 * @swagger
 * /api/friends/groups:
 *   get:
 *     summary: Get user's friend groups
 *     tags: [FriendGroups]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by group name or description
 *     responses:
 *       200:
 *         description: Paginated list of friend groups
 */
router.get(
  "/",
  validateQuery(friendGroupQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    if (!userId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    const { page, limit, search } = req.query as any;
    const skip = (page - 1) * limit;

    const where: any = {
      OR: [{ creatorId: userId }, { members: { some: { userId } } }],
    };
    if (search) {
      where.AND = [
        {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }

    const [groups, total] = await Promise.all([
      prisma.friendGroup.findMany({
        where,
        include: {
          creator: { select: { id: true, name: true, avatar: true } },
          members: {
            include: {
              user: { select: { id: true, name: true, avatar: true } },
            },
          },
          _count: { select: { members: true, rides: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.friendGroup.count({ where }),
    ]);

    ApiResponse.paginated(res, groups, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

/**
 * @swagger
 * /api/friends/groups/{id}:
 *   get:
 *     summary: Get friend group by ID
 *     tags: [FriendGroups]
 */
router.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    if (!userId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    const group = await prisma.friendGroup.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
        },
        rides: {
          include: {
            creator: { select: { id: true, name: true, avatar: true } },
            _count: { select: { participants: true } },
          },
          orderBy: { scheduledAt: "desc" },
          take: 10,
        },
        _count: { select: { members: true, rides: true } },
      },
    });

    if (!group)
      return ApiResponse.error(
        res,
        "Friend group not found",
        404,
        ErrorCode.NOT_FOUND,
      );

    // Check that user is creator or member
    const isMember =
      group.creatorId === userId ||
      group.members.some((m: { userId: string }) => m.userId === userId);
    if (!isMember)
      return ApiResponse.error(
        res,
        "Not a member of this group",
        403,
        ErrorCode.FORBIDDEN,
      );

    return ApiResponse.created(res, { group });
  }),
);

/**
 * @swagger
 * /api/friends/groups:
 *   post:
 *     summary: Create a friend group
 *     tags: [FriendGroups]
 */
router.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    if (!userId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    const { name, description, image, memberIds } = req.body;
    if (!name)
      return ApiResponse.error(
        res,
        "Name is required",
        400,
        ErrorCode.VALIDATION_ERROR,
      );

    const group = await prisma.friendGroup.create({
      data: {
        name,
        description: description || null,
        image: image || null,
        creatorId: userId,
        members: {
          create: [
            { userId }, // Creator is always a member
            ...(Array.isArray(memberIds)
              ? memberIds
                  .filter((id: string) => id !== userId)
                  .map((id: string) => ({ userId: id }))
              : []),
          ],
        },
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
        },
        _count: { select: { members: true, rides: true } },
      },
    });

    return ApiResponse.created(res, { group });
  }),
);

/**
 * @swagger
 * /api/friends/groups/{id}:
 *   patch:
 *     summary: Update a friend group (creator only)
 *     tags: [FriendGroups]
 */
router.patch(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    if (!userId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    const group = await prisma.friendGroup.findUnique({
      where: { id: req.params.id },
    });
    if (!group)
      return ApiResponse.error(
        res,
        "Friend group not found",
        404,
        ErrorCode.NOT_FOUND,
      );
    if (group.creatorId !== userId && !isStaff((req as any).session?.user?.roles))
      return ApiResponse.error(
        res,
        "Only the group creator can update it",
        403,
        ErrorCode.FORBIDDEN,
      );

    const { name, description, image } = req.body;
    const updated = await prisma.friendGroup.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(image !== undefined && { image }),
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        members: {
          include: { user: { select: { id: true, name: true, avatar: true } } },
        },
        _count: { select: { members: true, rides: true } },
      },
    });

    return ApiResponse.success(res, { group: updated });
  }),
);

/**
 * @swagger
 * /api/friends/groups/{id}:
 *   delete:
 *     summary: Delete a friend group (creator only)
 *     tags: [FriendGroups]
 */
router.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    if (!userId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    const group = await prisma.friendGroup.findUnique({
      where: { id: req.params.id },
    });
    if (!group)
      return ApiResponse.error(
        res,
        "Friend group not found",
        404,
        ErrorCode.NOT_FOUND,
      );
    if (group.creatorId !== userId && !isStaff((req as any).session?.user?.roles))
      return ApiResponse.error(
        res,
        "Only the group creator can delete it",
        403,
        ErrorCode.FORBIDDEN,
      );

    await prisma.friendGroup.delete({ where: { id: req.params.id } });
    return ApiResponse.success(res, { message: "Friend group deleted" });
  }),
);

/**
 * @swagger
 * /api/friends/groups/{id}/members:
 *   post:
 *     summary: Add a member to the group (creator only)
 *     tags: [FriendGroups]
 */
router.post(
  "/:id/members",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    if (!userId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    const group = await prisma.friendGroup.findUnique({
      where: { id: req.params.id },
    });
    if (!group)
      return ApiResponse.error(
        res,
        "Friend group not found",
        404,
        ErrorCode.NOT_FOUND,
      );
    if (group.creatorId !== userId && !isStaff((req as any).session?.user?.roles))
      return ApiResponse.error(
        res,
        "Only the group creator can add members",
        403,
        ErrorCode.FORBIDDEN,
      );

    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return ApiResponse.error(
        res,
        "userIds array is required",
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    // Skip users already in the group
    const existing = await prisma.friendGroupMember.findMany({
      where: { groupId: req.params.id, userId: { in: userIds } },
      select: { userId: true },
    });
    const existingIds = new Set(
      existing.map((m: { userId: string }) => m.userId),
    );
    const newIds = userIds.filter((id: string) => !existingIds.has(id));

    if (newIds.length > 0) {
      await prisma.friendGroupMember.createMany({
        data: newIds.map((uid: string) => ({
          groupId: req.params.id,
          userId: uid,
        })),
      });

      await notifyUsers(newIds, {
        type: "CLUB_INVITE",
        title: `You were added to ${group.name}`,
        message: "Open the squad to see members and upcoming rides.",
        relatedType: "friend-group",
        relatedId: req.params.id,
      });
    }

    return ApiResponse.success(res, { added: newIds.length });
  }),
);

/**
 * @swagger
 * /api/friends/groups/{id}/members/{userId}:
 *   delete:
 *     summary: Remove a member from the group (creator or self)
 *     tags: [FriendGroups]
 */
router.delete(
  "/:id/members/:userId",
  asyncHandler(async (req: Request, res: Response) => {
    const currentUserId = (req as any).session?.user?.id;
    if (!currentUserId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    const group = await prisma.friendGroup.findUnique({
      where: { id: req.params.id },
    });
    if (!group)
      return ApiResponse.error(
        res,
        "Friend group not found",
        404,
        ErrorCode.NOT_FOUND,
      );

    const targetUserId = req.params.userId;
    // Allow creator to remove anyone, or member to remove themselves
    if (group.creatorId !== currentUserId && currentUserId !== targetUserId) {
      return ApiResponse.error(
        res,
        "Not authorized to remove this member",
        403,
        ErrorCode.FORBIDDEN,
      );
    }
    // Don't allow removing the creator
    if (targetUserId === group.creatorId) {
      return ApiResponse.error(
        res,
        "Cannot remove the group creator",
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    await prisma.friendGroupMember.deleteMany({
      where: { groupId: req.params.id, userId: targetUserId },
    });

    return ApiResponse.success(res, { message: "Member removed" });
  }),
);

/**
 * @swagger
 * /api/friends/groups/{id}/rides:
 *   post:
 *     summary: Create a ride from this friend group
 *     tags: [FriendGroups]
 */
router.post(
  "/:id/rides",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    if (!userId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    // Must be a member
    const membership = await prisma.friendGroupMember.findUnique({
      where: { groupId_userId: { groupId: req.params.id, userId } },
    });
    if (!membership)
      return ApiResponse.error(
        res,
        "Not a member of this group",
        403,
        ErrorCode.FORBIDDEN,
      );

    const {
      title,
      description,
      startLocation,
      endLocation,
      scheduledAt,
      distance,
      duration,
      experienceLevel,
      pace,
      xpRequired,
      startLat,
      startLng,
      endLat,
      endLng,
      waypoints,
      routeData,
    } = req.body;

    if (!title || !startLocation) {
      return ApiResponse.error(
        res,
        "Title and start location are required",
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const serializedRouteData =
      typeof routeData === "string"
        ? routeData
        : routeData != null
          ? JSON.stringify(routeData)
          : null;

    const resolvedLat = startLat != null ? Number(startLat) : null;
    const resolvedLng = startLng != null ? Number(startLng) : null;

    // Create ride linked to friend group
    const ride = await prisma.ride.create({
      data: {
        title,
        description: description || null,
        startLocation,
        endLocation: endLocation || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        distance: distance ? Number(distance) : null,
        duration: duration ? Number(duration) : null,
        // Match the canonicalization done by the public ride POST so the
        // discovery filter and admin views see consistent enum casing.
        experienceLevel: normalizeExperienceLevel(experienceLevel) ?? null,
        pace: normalizePace(pace) ?? null,
        xpRequired: xpRequired != null ? Number(xpRequired) : null,
        latitude: resolvedLat,
        longitude: resolvedLng,
        startLat: resolvedLat,
        startLng: resolvedLng,
        endLat: endLat != null ? Number(endLat) : null,
        endLng: endLng != null ? Number(endLng) : null,
        waypoints: waypoints ?? undefined,
        routeData: serializedRouteData,
        creatorId: userId,
        friendGroupId: req.params.id,
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        _count: { select: { participants: true } },
      },
    });

    // Auto-add all group members as ride participants
    const groupMembers = await prisma.friendGroupMember.findMany({
      where: { groupId: req.params.id },
      select: { userId: true },
    });

    if (groupMembers.length > 0) {
      await prisma.rideParticipant.createMany({
        data: groupMembers.map((m: { userId: string }) => ({
          rideId: ride.id,
          userId: m.userId,
        })),
        skipDuplicates: true,
      });

      const notifyTargets = groupMembers
        .map((member: { userId: string }) => member.userId)
        .filter((memberId: string) => memberId !== userId);

      await notifyUsers(notifyTargets, {
        type: "RIDE_INVITE",
        title: `New squad ride: ${ride.title}`,
        message: `${(req as any).session?.user?.name || "A rider"} planned a new ride for your squad.`,
        relatedType: "ride",
        relatedId: ride.id,
      });

      await createNotification({
        userId,
        type: "RIDE_JOINED",
        title: "Ride created successfully",
        message: `${groupMembers.length} squad members were added to ${ride.title}.`,
        relatedType: "ride",
        relatedId: ride.id,
      });
    }

    return ApiResponse.created(res, { ride });
  }),
);

export default router;
