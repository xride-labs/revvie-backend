import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { validateParams, asyncHandler } from "../../middlewares/validation.js";
import { idParamSchema } from "../../validators/schemas.js";

const router = Router();

/**
 * @swagger
 * /api/users/{id}/public:
 *   get:
 *     summary: Get public user profile
 *     description: Get limited public information about a user for profile viewing
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: Public user profile
 *       404:
 *         description: User not found or profile is private
 */
router.get(
  "/:id/public",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const session = (req as any).session;
    const currentUserId = session?.user?.id;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        coverImage: true,
        bio: true,
        location: true,
        level: true,
        levelTitle: true,
        reputationScore: true,
        activityLevel: true,
        createdAt: true,
        preferences: {
          select: {
            profileVisibility: true,
            showLocation: true,
            showBikes: true,
            showStats: true,
          },
        },
        rideStats: {
          select: {
            totalRides: true,
            totalDistanceKm: true,
          },
        },
        bikes: {
          where: {
            // Only show bikes if user allows it
          },
          select: {
            id: true,
            make: true,
            model: true,
            year: true,
            type: true,
            isPrimary: true,
          },
          orderBy: [
            { isPrimary: "desc" },
            { createdAt: "desc" },
          ],
          take: 5,
        },
        badges: {
          select: {
            earnedAt: true,
            badge: {
              select: {
                id: true,
                title: true,
                icon: true,
                category: true,
              },
            },
          },
          orderBy: { earnedAt: "desc" },
          take: 6,
        },
        _count: {
          select: {
            clubMemberships: true,
          },
        },
      },
    });

    if (!user) {
      return ApiResponse.notFound(
        res,
        "User not found",
        ErrorCode.USER_NOT_FOUND,
      );
    }

    // Check privacy settings - but allow viewing own profile
    const isOwnProfile = currentUserId === id;
    const isPrivate = user.preferences?.profileVisibility === "private";
    if (isPrivate && !isOwnProfile) {
      return ApiResponse.notFound(
        res,
        "Profile is private",
        ErrorCode.USER_NOT_FOUND,
      );
    }

    // Get recent rides (public ones only)
    const recentRides = await prisma.ride.findMany({
      where: {
        OR: [
          { creatorId: id },
          {
            participants: {
              some: {
                userId: id,
                status: "ACCEPTED",
              },
            },
          },
        ],
        status: "COMPLETED",
      },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        distance: true,
        _count: {
          select: {
            participants: true,
          },
        },
      },
      orderBy: { scheduledAt: "desc" },
      take: 5,
    });

    // Check if current user is friends with this user
    let friendshipStatus = null;
    if (currentUserId && !isOwnProfile) {
      const friendship = await prisma.friendship.findFirst({
        where: {
          OR: [
            { senderId: currentUserId, receiverId: id },
            { senderId: id, receiverId: currentUserId },
          ],
        },
        select: { id: true, status: true, senderId: true },
      });

      if (friendship) {
        friendshipStatus = {
          id: friendship.id,
          status: friendship.status,
          isInitiator: friendship.senderId === currentUserId,
        };
      }
    }

    // Follow relationship — separate from friendship above (one-directional,
    // no approval needed). followerId/followingId are queried directly
    // rather than via the User.followers/following relation fields, whose
    // names are swapped relative to what they actually hold.
    const [followerCount, followingCount, isFollowing] = await Promise.all([
      prisma.follow.count({ where: { followingId: id } }),
      prisma.follow.count({ where: { followerId: id } }),
      currentUserId && !isOwnProfile
        ? prisma.follow
            .findUnique({
              where: {
                followerId_followingId: { followerId: currentUserId, followingId: id },
              },
              select: { id: true },
            })
            .then((f) => !!f)
        : Promise.resolve(false),
    ]);

    // Build response with privacy-aware data
    const publicProfile = {
      id: user.id,
      name: user.name,
      username: user.username,
      avatar: user.avatar,
      coverImage: user.coverImage,
      bio: user.bio,
      location: user.preferences?.showLocation ? user.location : null,
      level: user.level,
      levelTitle: user.levelTitle,
      reputationScore: user.reputationScore || 0,
      activityLevel: user.activityLevel,
      joinedAt: user.createdAt.toISOString(),
      isOwnProfile,
      friendshipStatus,
      followerCount,
      followingCount,
      isFollowing,
      stats: user.preferences?.showStats
        ? {
            totalRides: user.rideStats?.totalRides || 0,
            totalDistance: user.rideStats?.totalDistanceKm || 0,
            clubsJoined: user._count.clubMemberships,
            badgesEarned: user.badges.length,
          }
        : {
            totalRides: 0,
            totalDistance: 0,
            clubsJoined: 0,
            badgesEarned: 0,
          },
      badges: user.badges.map((ub) => ({
        id: ub.badge.id,
        title: ub.badge.title,
        icon: ub.badge.icon,
        category: ub.badge.category,
      })),
      bikes: user.preferences?.showBikes ? user.bikes : [],
      recentRides: recentRides.map((ride) => ({
        id: ride.id,
        title: ride.title,
        date: ride.scheduledAt?.toISOString() || "",
        distance: ride.distance || 0,
        participants: ride._count.participants,
      })),
    };

    ApiResponse.success(res, publicProfile);
  }),
);

export default router;