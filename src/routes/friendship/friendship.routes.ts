import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma.js";
import { requireAuth } from "../../config/auth.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { asyncHandler, validateQuery } from "../../middlewares/validation.js";
import { friendRequestsQuerySchema } from "../../validators/schemas.js";
import { createNotification } from "../../lib/notifications.js";
import friendGroupRoutes from "../friend-group/friend-group.routes.js";

const router = Router();

router.use(requireAuth);
router.use("/groups", friendGroupRoutes);

/**
 * @swagger
 * /api/friends:
 *   get:
 *     summary: List current user's friends
 *     tags: [Friends]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Filter by name / username
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, ACCEPTED, DECLINED, BLOCKED]
 *         description: Filter by friendship status (default ACCEPTED)
 */
router.get(
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

    const search = (req.query.search as string) || "";
    const status = ((req.query.status as string) || "ACCEPTED").toUpperCase();
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    // Build user-search filter (applied to the "other" user)
    const userFilter = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { username: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [sent, received, sentCount, receivedCount] = await Promise.all([
      prisma.friendship.findMany({
        where: {
          senderId: userId,
          status: status as any,
          receiver: userFilter,
        },
        include: {
          receiver: {
            select: { id: true, name: true, username: true, avatar: true },
          },
        },
        skip,
        take: limit,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.friendship.findMany({
        where: {
          receiverId: userId,
          status: status as any,
          sender: userFilter,
        },
        include: {
          sender: {
            select: { id: true, name: true, username: true, avatar: true },
          },
        },
        skip,
        take: limit,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.friendship.count({
        where: {
          senderId: userId,
          status: status as any,
          receiver: userFilter,
        },
      }),
      prisma.friendship.count({
        where: {
          receiverId: userId,
          status: status as any,
          sender: userFilter,
        },
      }),
    ]);

    const friends = [
      ...sent.map((f) => ({
        id: f.id,
        user: f.receiver,
        status: f.status,
        since: f.updatedAt,
      })),
      ...received.map((f) => ({
        id: f.id,
        user: f.sender,
        status: f.status,
        since: f.updatedAt,
      })),
    ];

    const total = sentCount + receivedCount;

    ApiResponse.paginated(res, friends, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

/**
 * @swagger
 * /api/friends/requests:
 *   get:
 *     summary: List pending friend requests received by the current user
 *     tags: [Friends]
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
 *     responses:
 *       200:
 *         description: Paginated list of pending friend requests
 */
router.get(
  "/requests",
  validateQuery(friendRequestsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    if (!userId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    const { page, limit } = req.query as any;
    const skip = (page - 1) * limit;

    const where = { receiverId: userId, status: "PENDING" as const };

    const [requests, total] = await Promise.all([
      prisma.friendship.findMany({
        where,
        include: {
          sender: {
            select: { id: true, name: true, username: true, avatar: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.friendship.count({ where }),
    ]);

    ApiResponse.paginated(
      res,
      requests.map((r) => ({
        id: r.id,
        user: r.sender,
        createdAt: r.createdAt,
      })),
      { page, limit, total, totalPages: Math.ceil(total / limit) },
    );
  }),
);

/**
 * @swagger
 * /api/friends/request:
 *   post:
 *     summary: Send a friend request
 *     tags: [Friends]
 */
router.post(
  "/request",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    if (!userId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    const { receiverId } = req.body;
    if (!receiverId)
      return ApiResponse.error(
        res,
        "receiverId is required",
        400,
        ErrorCode.VALIDATION_ERROR,
      );

    if (receiverId === userId)
      return ApiResponse.error(
        res,
        "Cannot friend yourself",
        400,
        ErrorCode.VALIDATION_ERROR,
      );

    // Check if receiver allows friend requests
    const receiverPrefs = await prisma.userPreferences.findUnique({
      where: { userId: receiverId },
      select: { allowFriendRequestsFrom: true },
    });

    if (receiverPrefs?.allowFriendRequestsFrom === "none") {
      return ApiResponse.error(
        res,
        "This user does not accept friend requests",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    // Check if friendship already exists in either direction
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId },
          { senderId: receiverId, receiverId: userId },
        ],
      },
    });

    if (existing) {
      if (existing.status === "ACCEPTED")
        return ApiResponse.conflict(res, "Already friends");
      if (existing.status === "PENDING")
        return ApiResponse.conflict(res, "Friend request already pending");
      if (existing.status === "BLOCKED")
        return ApiResponse.error(
          res,
          "Cannot send request",
          400,
          ErrorCode.FORBIDDEN,
        );
    }

    const friendship = await prisma.friendship.create({
      data: { senderId: userId, receiverId, status: "PENDING" },
      include: {
        receiver: { select: { id: true, name: true, avatar: true } },
        sender: { select: { id: true, name: true, username: true, avatar: true } },
      },
    });

    // Resolve a real name. Session.user.name can be null (OAuth users who
    // haven't completed onboarding), so fall back to the freshly-included
    // sender record before reaching for the "Someone" placeholder.
    const senderName =
      (req as any).session?.user?.name ||
      friendship.sender?.name ||
      friendship.sender?.username ||
      "A rider";

    // Use createNotification so the receiver also gets a push + socket event,
    // not just a row in their inbox.
    await createNotification({
      userId: receiverId,
      type: "FRIEND_REQUEST",
      title: `${senderName} wants to be friends`,
      message: "Tap to accept or decline.",
      relatedType: "friendship",
      relatedId: friendship.id,
    });

    return ApiResponse.created(res, { friendship }, "Friend request sent");
  }),
);

/**
 * @swagger
 * /api/friends/{id}/accept:
 *   patch:
 *     summary: Accept a friend request
 *     tags: [Friends]
 */
router.patch(
  "/:id/accept",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    if (!userId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    const friendship = await prisma.friendship.findUnique({
      where: { id: req.params.id },
    });
    if (!friendship)
      return ApiResponse.notFound(res, "Friend request not found");
    if (friendship.receiverId !== userId)
      return ApiResponse.forbidden(res, "Not authorized");
    if (friendship.status !== "PENDING")
      return ApiResponse.error(
        res,
        "Request is no longer pending",
        400,
        ErrorCode.INVALID_INPUT,
      );

    const updated = await prisma.friendship.update({
      where: { id: req.params.id },
      data: { status: "ACCEPTED" },
      include: {
        receiver: { select: { id: true, name: true, username: true } },
      },
    });

    // Notify the original requester that their friend request was accepted.
    // Uses FRIEND_REQUEST type since the schema doesn't have a separate
    // accepted enum value — title disambiguates.
    const accepterName =
      updated.receiver?.name || updated.receiver?.username || "Someone";
    createNotification({
      userId: updated.senderId,
      type: "FRIEND_REQUEST",
      title: `${accepterName} accepted your friend request`,
      message: "You're now friends. Say hi!",
      relatedType: "user",
      relatedId: userId,
    }).catch((err) => console.error("[friendship] accept notify failed:", err));

    return ApiResponse.success(
      res,
      { friendship: updated },
      "Friend request accepted",
    );
  }),
);

/**
 * @swagger
 * /api/friends/{id}/decline:
 *   patch:
 *     summary: Decline a friend request
 *     tags: [Friends]
 */
router.patch(
  "/:id/decline",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    if (!userId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    const friendship = await prisma.friendship.findUnique({
      where: { id: req.params.id },
    });
    if (!friendship)
      return ApiResponse.notFound(res, "Friend request not found");
    if (friendship.receiverId !== userId)
      return ApiResponse.forbidden(res, "Not authorized");

    const updated = await prisma.friendship.update({
      where: { id: req.params.id },
      data: { status: "DECLINED" },
    });

    return ApiResponse.success(
      res,
      { friendship: updated },
      "Friend request declined",
    );
  }),
);

/**
 * @swagger
 * /api/friends/{id}:
 *   delete:
 *     summary: Remove a friend (unfriend)
 *     tags: [Friends]
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

    const friendship = await prisma.friendship.findUnique({
      where: { id: req.params.id },
    });
    if (!friendship) return ApiResponse.notFound(res, "Friendship not found");
    if (friendship.senderId !== userId && friendship.receiverId !== userId)
      return ApiResponse.forbidden(res, "Not authorized");

    await prisma.friendship.delete({ where: { id: req.params.id } });
    return ApiResponse.success(res, null, "Friend removed");
  }),
);

/**
 * @swagger
 * /api/friends/{id}/block:
 *   patch:
 *     summary: Block a user
 *     tags: [Friends]
 */
router.patch(
  "/:id/block",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    if (!userId)
      return ApiResponse.error(
        res,
        "Unauthorized",
        401,
        ErrorCode.UNAUTHORIZED,
      );

    const friendship = await prisma.friendship.findUnique({
      where: { id: req.params.id },
    });

    if (!friendship) return ApiResponse.notFound(res, "Friendship not found");
    if (friendship.senderId !== userId && friendship.receiverId !== userId)
      return ApiResponse.forbidden(res, "Not authorized");

    await prisma.friendship.update({
      where: { id: req.params.id },
      data: { status: "BLOCKED" },
    });

    return ApiResponse.success(res, null, "User blocked");
  }),
);

export default router;
