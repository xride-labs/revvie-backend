import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma.js";
import { requireAuth } from "../../config/auth.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import {
  validateBody,
  validateParams,
  asyncHandler,
} from "../../middlewares/validation.js";
import {
  createReportSchema,
  idParamSchema,
  feedQuerySchema,
} from "../../validators/schemas.js";
import { z } from "zod";
import { validateQuery } from "../../middlewares/validation.js";
import { awardXp } from "../../lib/xp.js";
import { isStaff } from "../../lib/utils/permissions.js";
import { ensureAnnouncementsGroup } from "../../services/clubGroupChat.service.js";
import { ChatService } from "../../services/chat.service.js";
import { MessageType } from "../../models/chat.model.js";
import { fanoutNewMessage } from "../../lib/socket.js";

const router = Router();

// All feed routes require authentication
router.use(requireAuth);

// Validation schemas
const createPostSchema = z.object({
  content: z.string().min(1).max(2000),
  type: z
    .enum(["ride", "content", "listing", "club-activity", "announcement"])
    .optional()
    .default("content"),
  images: z.array(z.string().url()).optional().default([]),
  clubId: z.string().optional().nullable(),
  isAnnouncement: z.boolean().optional().default(false),
  isPinned: z.boolean().optional().default(false),
  expiresAt: z.string().datetime().optional().nullable(),
});

const createCommentSchema = z.object({
  content: z.string().min(1).max(500),
});

async function resolveReportTarget(type: string, id: string) {
  switch (type) {
    case "post": {
      const post = await prisma.post.findUnique({
        where: { id },
        select: { id: true, content: true },
      });
      if (!post) return null;
      return {
        id: post.id,
        name: post.content?.slice(0, 80) || "Post",
        type: "post",
      };
    }
    case "comment": {
      const comment = await prisma.comment.findUnique({
        where: { id },
        select: { id: true, content: true },
      });
      if (!comment) return null;
      return {
        id: comment.id,
        name: comment.content.slice(0, 80),
        type: "comment",
      };
    }
    case "ride": {
      const ride = await prisma.ride.findUnique({
        where: { id },
        select: { id: true, title: true },
      });
      if (!ride) return null;
      return { id: ride.id, name: ride.title, type: "ride" };
    }
    case "club": {
      const club = await prisma.club.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!club) return null;
      return { id: club.id, name: club.name, type: "club" };
    }
    case "listing": {
      const listing = await prisma.marketplaceListing.findUnique({
        where: { id },
        select: { id: true, title: true },
      });
      if (!listing) return null;
      return { id: listing.id, name: listing.title, type: "listing" };
    }
    case "user": {
      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, name: true, username: true },
      });
      if (!user) return null;
      return {
        id: user.id,
        name: user.name || user.username || "User",
        type: "user",
      };
    }
    case "message":
      return { id, name: "Chat message", type: "message" };
    default:
      return null;
  }
}

/**
 * @swagger
 * /api/feed:
 *   get:
 *     summary: Get feed posts
 *     description: Get paginated feed posts from followed users and clubs
 *     tags: [Feed]
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
 *         description: Search by post content
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [ride, content, listing, club-activity]
 *         description: Filter by post type
 *       - in: query
 *         name: authorId
 *         schema:
 *           type: string
 *         description: Filter by author ID
 *     responses:
 *       200:
 *         description: List of feed posts
 */
router.get(
  "/",
  validateQuery(feedQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { page, limit, search, type, authorId } = req.query as any;
    const clubId = req.query.clubId as string | undefined;
    const skip = (page - 1) * limit;

    // Always filter out expired posts
    const now = new Date();
    const where: any = {
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };

    if (clubId) {
      // Club-scoped feed: show all posts tagged to this club
      where.clubId = clubId;
    } else {
      // Global feed: posts from users the current user follows + own posts
      const following = await prisma.follow.findMany({
        where: { followerId: session.user.id },
        select: { followingId: true },
      });
      const followingIds = following.map((f: any) => f.followingId);
      const userIds = authorId ? [authorId] : [session.user.id, ...followingIds];
      where.authorId = { in: userIds };
    }

    if (search) {
      where.content = { contains: search, mode: "insensitive" };
    }
    if (type) {
      where.type = type;
    }

    const posts = await prisma.post.findMany({
      where,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
          },
        },
        _count: {
          select: { likes: true, comments: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit + 1,
    });

    const hasMore = posts.length > limit;
    const resultPosts = hasMore ? posts.slice(0, limit) : posts;

    // Get like status for current user
    const postIds = resultPosts.map((p) => p.id);
    const userLikes = await prisma.like.findMany({
      where: {
        postId: { in: postIds },
        userId: session.user.id,
      },
      select: { postId: true },
    });
    const likedPostIds = new Set(userLikes.map((l) => l.postId));

    const enrichedPosts = resultPosts.map((post) => ({
      id: post.id,
      type: post.type,
      author: {
        id: post.author.id,
        name: post.author.name,
        username: post.author.username,
        avatar: post.author.avatar,
        clubs: [],
      },
      content: post.content,
      images: post.images,
      clubId: (post as any).clubId ?? null,
      isAnnouncement: (post as any).isAnnouncement ?? false,
      isPinned: (post as any).isPinned ?? false,
      expiresAt: (post as any).expiresAt ? (post as any).expiresAt.toISOString() : null,
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
      isLiked: likedPostIds.has(post.id),
      isSaved: false,
      createdAt: post.createdAt.toISOString(),
    }));

    ApiResponse.success(res, { posts: enrichedPosts, hasMore });
  }),
);

/**
 * @swagger
 * /api/posts:
 *   post:
 *     summary: Create a new post
 *     tags: [Feed]
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
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *               type:
 *                 type: string
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Post created
 */
router.post(
  "/",
  validateBody(createPostSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { content, type, images, clubId, isAnnouncement, isPinned, expiresAt } = req.body;

    // If posting as announcement, verify user is club admin/owner
    if (isAnnouncement && clubId) {
      const member = await prisma.clubMember.findUnique({
        where: { clubId_userId: { clubId, userId: session.user.id } },
        select: { role: true },
      });
      const club = await prisma.club.findUnique({ where: { id: clubId }, select: { ownerId: true } });
      const isClubAdmin = club?.ownerId === session.user.id ||
        (member && ["ADMIN", "OFFICER", "FOUNDER"].includes(member.role));
      if (!isClubAdmin) {
        return ApiResponse.forbidden(res, "Only club admins can post announcements");
      }
    }

    const post = await prisma.post.create({
      data: {
        content,
        type,
        images,
        authorId: session.user.id,
        clubId: clubId ?? null,
        isAnnouncement: isAnnouncement ?? false,
        isPinned: isPinned ?? false,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
          },
        },
      },
    });

    await awardXp(session.user.id, "POST_CREATED", `post ${post.id}`);

    // Bridge: mirror a club announcement into that club's Announcements channel
    // so members see it in chat too (WhatsApp-Community style). Gated by the
    // SAME admin check above. Best-effort + fire-and-forget — a chat hiccup must
    // never fail the post, and the response shouldn't wait on the mirror.
    if (isAnnouncement && clubId) {
      void (async () => {
        try {
          const { conversationId } = await ensureAnnouncementsGroup(clubId);
          const senderName = post.author?.name || "Club";
          const message = await ChatService.sendMessage({
            conversationId,
            senderId: session.user.id,
            senderName,
            text: content,
            messageType: MessageType.TEXT,
          });
          await fanoutNewMessage({
            conversationId,
            senderId: session.user.id,
            senderName,
            message,
            text: content,
            messageType: "text",
          });
        } catch (err) {
          console.error("[feed] announcement→chat bridge failed:", err);
        }
      })();
    }

    ApiResponse.created(res, post);
  }),
);

router.post(
  "/reports",
  validateBody(createReportSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const {
      type,
      title,
      description,
      priority,
      reportedItemId,
      reportedItemType,
    } = req.body;

    const target = await resolveReportTarget(type, reportedItemId);
    if (!target) {
      return ApiResponse.notFound(
        res,
        "Reported content not found",
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const duplicate = await prisma.report.findFirst({
      where: {
        reporterId: session.user.id,
        reportedItemId,
        status: { in: ["pending", "investigating"] },
      },
      select: { id: true },
    });

    if (duplicate) {
      return ApiResponse.conflict(
        res,
        "You already submitted a pending report for this content",
        ErrorCode.DUPLICATE_ENTRY,
      );
    }

    const report = await prisma.report.create({
      data: {
        type,
        title,
        description,
        priority: priority ?? "medium",
        reportedItemId: target.id,
        reportedItemName: target.name,
        reportedItemType: reportedItemType ?? target.type,
        status: "pending",
        reporterId: session.user.id,
      },
      select: {
        id: true,
        type: true,
        title: true,
        priority: true,
        status: true,
        createdAt: true,
      },
    });

    ApiResponse.created(res, report, "Report submitted successfully");
  }),
);

/**
 * @swagger
 * /api/posts/{id}:
 *   get:
 *     summary: Get a single post
 *     tags: [Feed]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 */
router.get(
  "/:id",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
          },
        },
        _count: {
          select: { likes: true, comments: true },
        },
      },
    });

    if (!post) {
      return ApiResponse.notFound(res, "Post not found");
    }

    // Check if user liked this post
    const userLike = await prisma.like.findUnique({
      where: { postId_userId: { userId: session.user.id, postId: id } },
    });

    const enrichedPost = {
      ...post,
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
      isLiked: !!userLike,
      isSaved: false,
    };

    ApiResponse.success(res, enrichedPost);
  }),
);

/**
 * @swagger
 * /api/posts/{id}:
 *   patch:
 *     summary: Update a post
 *     tags: [Feed]
 */
router.patch(
  "/:id",
  validateParams(idParamSchema),
  validateBody(createPostSchema.partial()),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;
    const { content, images } = req.body;

    const post = await prisma.post.findUnique({
      where: { id },
      select: { authorId: true },
    });

    if (!post) {
      return ApiResponse.notFound(res, "Post not found");
    }

    if (post.authorId !== session.user.id && !isStaff(session.user.roles)) {
      return ApiResponse.forbidden(res, "You can only edit your own posts");
    }

    const updated = await prisma.post.update({
      where: { id },
      data: { content, images },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
          },
        },
      },
    });

    ApiResponse.success(res, updated);
  }),
);

/**
 * @swagger
 * /api/posts/{id}:
 *   delete:
 *     summary: Delete a post
 *     tags: [Feed]
 */
router.delete(
  "/:id",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const post = await prisma.post.findUnique({
      where: { id },
      select: { authorId: true },
    });

    if (!post) {
      return ApiResponse.notFound(res, "Post not found");
    }

    if (post.authorId !== session.user.id && !isStaff(session.user.roles)) {
      return ApiResponse.forbidden(res, "You can only delete your own posts");
    }

    await prisma.post.delete({ where: { id } });

    ApiResponse.success(res, null, "Post deleted");
  }),
);

/**
 * @swagger
 * /api/posts/{id}/like:
 *   post:
 *     summary: Like a post
 *     tags: [Feed]
 */
router.post(
  "/:id/like",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) {
      return ApiResponse.notFound(res, "Post not found");
    }

    await prisma.like.upsert({
      where: { postId_userId: { userId: session.user.id, postId: id } },
      create: { userId: session.user.id, postId: id },
      update: {},
    });

    ApiResponse.success(res, null, "Post liked");
  }),
);

/**
 * @swagger
 * /api/posts/{id}/like:
 *   delete:
 *     summary: Unlike a post
 *     tags: [Feed]
 */
router.delete(
  "/:id/like",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    await prisma.like.deleteMany({
      where: { userId: session.user.id, postId: id },
    });

    ApiResponse.success(res, null, "Post unliked");
  }),
);

/**
 * @swagger
 * /api/posts/{id}/comments:
 *   get:
 *     summary: Get comments on a post
 *     tags: [Feed]
 */
router.get(
  "/:id/comments",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;

    const comments = await prisma.comment.findMany({
      where: { postId: id },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit + 1,
    });

    const hasMore = comments.length > limit;
    const resultComments = hasMore ? comments.slice(0, limit) : comments;

    ApiResponse.success(res, {
      comments: resultComments.map((c) => ({
        id: c.id,
        content: c.content,
        author: c.author,
        createdAt: c.createdAt.toISOString(),
      })),
      hasMore,
    });
  }),
);

/**
 * @swagger
 * /api/posts/{id}/comments:
 *   post:
 *     summary: Add a comment to a post
 *     tags: [Feed]
 */
router.post(
  "/:id/comments",
  validateParams(idParamSchema),
  validateBody(createCommentSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;
    const { content } = req.body;

    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) {
      return ApiResponse.notFound(res, "Post not found");
    }

    const comment = await prisma.comment.create({
      data: {
        content,
        postId: id,
        authorId: session.user.id,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
          },
        },
      },
    });

    ApiResponse.created(res, {
      id: comment.id,
      content: comment.content,
      author: comment.author,
      createdAt: comment.createdAt.toISOString(),
    });
  }),
);

/**
 * @swagger
 * /api/posts/{id}/comments/{commentId}:
 *   delete:
 *     summary: Delete a comment
 *     tags: [Feed]
 */
router.delete(
  "/:id/comments/:commentId",
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { commentId } = req.params;

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { authorId: true },
    });

    if (!comment) {
      return ApiResponse.notFound(res, "Comment not found");
    }

    if (comment.authorId !== session.user.id && !isStaff(session.user.roles)) {
      return ApiResponse.forbidden(
        res,
        "You can only delete your own comments",
      );
    }

    await prisma.comment.delete({ where: { id: commentId } });

    ApiResponse.success(res, null, "Comment deleted");
  }),
);

export default router;
