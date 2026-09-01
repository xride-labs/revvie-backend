import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../config/auth.js";
import { UserController } from "../../controllers/user.controller.js";
import { requireAdmin } from "../../middlewares/rbac.js";
import {
    asyncHandler,
    validateBody,
    validateParams,
    validateQuery,
} from "../../middlewares/validation.js";
import {
    createBikeSchema,
    idParamSchema,
    matchContactsSchema,
    updateBikeSchema,
    updateUserRoleSchema,
    updateUserSchema,
    userClubsQuerySchema,
    userQuerySchema,
    userRidesQuerySchema,
} from "../../validators/schemas.js";
import publicUserRoutes from "./public.routes.js";

const router = Router();
// All user routes require authentication
router.use(requireAuth);

// GET /:id/public — another rider's profile. The handler lives in
// public.routes.ts but was never mounted on any router, so the endpoint 404'd
// and the app's profile screen could not load anyone else. Mounted after
// requireAuth so the handler still sees a session (it needs the viewer id for
// isOwnProfile and friendshipStatus).
router.use(publicUserRoutes);

/**
 * Leaderboard — top XP users globally or filtered by city.
 *
 * Query: ?scope=global|city, &city=Bangalore, &limit=50 (max 100)
 *
 * Mounted before "/" and ":id" so the literal "/leaderboard" path doesn't
 * get swallowed by the user-id param route.
 */
router.get(
  "/leaderboard",
  asyncHandler(UserController.getLeaderboard)
);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users
 *     description: Retrieve a paginated list of all users
 *     tags: [Users]
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
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
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
  validateQuery(userQuerySchema),
  asyncHandler(UserController.getRoot)
);

router.post(
  "/contacts/match",
  validateBody(matchContactsSchema),
  asyncHandler(UserController.postContactsMatch)
);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     description: Retrieve a single user by their unique identifier
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
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
  asyncHandler(UserController.getById)
);

/**
 * @swagger
 * /api/users/{id}:
 *   patch:
 *     summary: Update a user
 *     description: Update user details. Can update own profile or admin can update any user. Profile images (avatar/cover) should be uploaded via /api/media/upload/profile endpoints and will be served via Cloudinary.
 *     tags: [Users]
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
 *               name:
 *                 type: string
 *               bio:
 *                 type: string
 *               location:
 *                 type: string
 *               bloodType:
 *                 type: string
 *                 enum: [A+, A-, B+, B-, AB+, AB-, O+, O-]
 *               avatar:
 *                 type: string
 *                 format: uri
 *                 description: Avatar URL (Cloudinary)
 *               coverImage:
 *                 type: string
 *                 format: uri
 *                 description: Cover image URL (Cloudinary)
 *               dob:
 *                 type: string
 *                 format: date-time
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not authorized to update this user
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch(
  "/:id",
  validateParams(idParamSchema),
  validateBody(updateUserSchema),
  asyncHandler(UserController.patchById)
);

/**
 * @swagger
 * /api/users/{id}/roles:
 *   get:
 *     summary: Get user roles
 *     description: Get all roles assigned to a user. Requires ADMIN role.
 *     tags: [Users]
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
 *         description: User roles retrieved successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 */
router.get(
  "/:id/roles",
  validateParams(idParamSchema),
  requireAdmin,
  asyncHandler(UserController.getByIdRoles)
);

/**
 * @swagger
 * /api/users/{id}/roles:
 *   post:
 *     summary: Add role to user
 *     description: Add a new role to a user. Requires ADMIN role.
 *     tags: [Users]
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
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [ADMIN, CO_ADMIN, MODERATOR, CLUB_OWNER, CLUB_ADMIN, CLUB_MODERATOR, BRAND_OWNER, BRAND_ADMIN, BRAND_MODERATOR, RIDER, SELLER]
 *     responses:
 *       200:
 *         description: Role added successfully
 *       400:
 *         description: Invalid role or role already exists
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 */
router.post(
  "/:id/roles",
  validateParams(idParamSchema),
  validateBody(updateUserRoleSchema),
  requireAdmin,
  asyncHandler(UserController.postByIdRoles)
);

/**
 * @swagger
 * /api/users/{id}/roles/{role}:
 *   delete:
 *     summary: Remove role from user
 *     description: Remove a role from a user. Requires ADMIN role.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: role
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Role removed successfully
 *       404:
 *         description: Role not found
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 */
router.delete(
  "/:id/roles/:role",
  validateParams(idParamSchema.extend({ role: z.string() })),
  requireAdmin,
  asyncHandler(UserController.deleteByIdRolesByRole)
);

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete a user
 *     description: Delete a user account. Can delete own account or admin can delete any user.
 *     tags: [Users]
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
 *         description: User deleted successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not authorized to delete this user
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  "/:id",
  validateParams(idParamSchema),
  asyncHandler(UserController.deleteById)
);

/**
 * @swagger
 * /api/users/{id}/rides:
 *   get:
 *     summary: Get user's rides
 *     description: Get paginated list of rides created by a user.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PLANNED, IN_PROGRESS, COMPLETED, CANCELLED]
 *         description: Filter by ride status
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by ride title or description
 *     responses:
 *       200:
 *         description: Paginated list of user's rides
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  "/:id/rides",
  validateParams(idParamSchema),
  validateQuery(userRidesQuerySchema),
  asyncHandler(UserController.getByIdRides)
);

/**
 * @swagger
 * /api/users/{id}/clubs:
 *   get:
 *     summary: Get user's clubs
 *     description: Get paginated list of clubs owned by a user.
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *         description: Search by club name or description
 *     responses:
 *       200:
 *         description: Paginated list of user's clubs
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  "/:id/clubs",
  validateParams(idParamSchema),
  validateQuery(userClubsQuerySchema),
  asyncHandler(UserController.getByIdClubs)
);

// ========================================
// Bike Management (Current User)
// ========================================

router.get(
  "/me/bikes",
  requireAuth,
  asyncHandler(UserController.getMeBikes)
);

router.post(
  "/me/bikes",
  requireAuth,
  validateBody(createBikeSchema),
  asyncHandler(UserController.postMeBikes)
);

router.patch(
  "/me/bikes/:bikeId",
  requireAuth,
  validateBody(updateBikeSchema),
  asyncHandler(UserController.patchMeBikesByBikeId)
);

router.delete(
  "/me/bikes/:bikeId",
  requireAuth,
  asyncHandler(UserController.deleteMeBikesByBikeId)
);

/**
 * @swagger
 * /api/users/me/ghost-mode:
 *   patch:
 *     summary: Toggle Ghost Mode for the current user
 *     description: |
 *       When enabled, the user is omitted from public feeds, presence
 *       broadcasts, and discoverability lists. Active-ride participants and
 *       emergency contacts still see live location — safety always wins
 *       over privacy. Returns the new enabled state and the timestamp
 *       ghost mode was activated (or null).
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 */
router.patch(
  "/me/ghost-mode",
  asyncHandler(UserController.patchMeGhostMode)
);

export default router;
