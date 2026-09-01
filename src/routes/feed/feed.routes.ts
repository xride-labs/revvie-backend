import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../config/auth.js";
import { FeedController } from "../../controllers/feed.controller.js";
import {
    asyncHandler,
    validateBody,
    validateParams,
    validateQuery,
} from "../../middlewares/validation.js";
import {
    createReportSchema,
    feedQuerySchema,
    idParamSchema,
} from "../../validators/schemas.js";

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
  asyncHandler(FeedController.getRoot)
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
  asyncHandler(FeedController.postRoot)
);

router.post(
  "/reports",
  validateBody(createReportSchema),
  asyncHandler(FeedController.postReports)
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
  asyncHandler(FeedController.getById)
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
  asyncHandler(FeedController.patchById)
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
  asyncHandler(FeedController.deleteById)
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
  asyncHandler(FeedController.postByIdLike)
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
  asyncHandler(FeedController.deleteByIdLike)
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
  asyncHandler(FeedController.getByIdComments)
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
  asyncHandler(FeedController.postByIdComments)
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
  asyncHandler(FeedController.deleteByIdCommentsByCommentId)
);

export default router;
