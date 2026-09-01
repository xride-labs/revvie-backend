import { Request, Response } from "express";
import prisma from "../lib/prisma.js";
import { ApiResponse, ErrorCode } from "../lib/utils/apiResponse.js";
import { awardXp } from "../lib/xp.js";
import { isStaff } from "../lib/utils/permissions.js";
import { ensureAnnouncementsGroup } from "../services/club/groupChat.service.js";
import { ChatService } from "../services/chat.service.js";
import { MessageType } from "../models/chat.model.js";
import { fanoutNewMessage } from "../lib/socket.js";

async function resolveReportTarget(type: string, reportedItemId: string): Promise<{ id: string, name?: string | null, type: string } | null> {
  if (!reportedItemId || !type) return null;
  return { id: reportedItemId, name: `Reported ${type}`, type };
}

export class FeedController {
  static async getRoot(req: Request, res: Response) {

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
  
  }

  static async postRoot(req: Request, res: Response) {

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
  
  }

  static async postReports(req: Request, res: Response) {

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
  
  }

  static async getById(req: Request, res: Response) {

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
  
  }

  static async patchById(req: Request, res: Response) {

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
  
  }

  static async deleteById(req: Request, res: Response) {

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
  
  }

  static async postByIdLike(req: Request, res: Response) {

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
  
  }

  static async deleteByIdLike(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;

    await prisma.like.deleteMany({
      where: { userId: session.user.id, postId: id },
    });

    ApiResponse.success(res, null, "Post unliked");
  
  }

  static async getByIdComments(req: Request, res: Response) {

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
  
  }

  static async postByIdComments(req: Request, res: Response) {

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
  
  }

  static async deleteByIdCommentsByCommentId(req: Request, res: Response) {

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
  
  }

}
