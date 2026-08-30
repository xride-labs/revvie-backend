import { Router, Request, Response } from "express";
import prisma from "../../lib/prisma.js";
import { requireAuth } from "../../config/auth.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import {
  validateBody,
  validateQuery,
  validateParams,
  asyncHandler,
} from "../../middlewares/validation.js";
import { requireAdmin } from "../../middlewares/rbac.js";
import publicUserRoutes from "./public.routes.js";
import {
  userQuerySchema,
  idParamSchema,
  updateUserSchema,
  updateUserRoleSchema,
  userRidesQuerySchema,
  userClubsQuerySchema,
  createBikeSchema,
  updateBikeSchema,
  matchContactsSchema,
} from "../../validators/schemas.js";
import { z } from "zod";

const router = Router();

function buildUserProfileResponse(user: any) {
  const roles = user.userRoles?.map((r: { role: string }) => r.role) ?? [];
  const xpPoints = user.xpPoints ?? 0;
  const nextLevelXp = (user.level + 1) * 250;
  const progressPercent = nextLevelXp
    ? Math.min(100, Math.round((xpPoints / nextLevelXp) * 100))
    : 0;

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    dob: user.dob,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    phone: user.phone,
    coverImage: user.coverImage,
    avatar: user.avatar,
    bio: user.bio,
    location: user.location,
    bloodType: user.bloodType,
    ridesCompleted: user.rideStats?.totalRides ?? 0,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    role: roles,
    experience: {
      xpPoints,
      level: user.level,
      levelTitle: user.levelTitle,
      nextLevelXp,
      progressPercent,
      reputationScore: user.reputationScore ?? 0,
      activityLevel: user.activityLevel,
    },
    bikes:
      user.bikes?.map((bike: any) => ({
        id: bike.id,
        make: bike.make,
        model: bike.model,
        year: bike.year,
        type: bike.type,
        engineCc: bike.engineCc,
        color: bike.color,
        odo: bike.odo,
        ownerSince: bike.ownerSince,
        modifications: bike.modifications,
        isPrimary: bike.isPrimary,
        image: bike.image,
        licensePlate: bike.licensePlate,
      })) ?? [],
    clubs:
      user.clubMemberships?.map((membership: any) => ({
        id: membership.club.id,
        name: membership.club.name,
        role: membership.role,
        joinedAt: membership.joinedAt,
        memberCount: membership.club.memberCount,
        logo: membership.club.image,
      })) ?? [],
    rideStats: user.rideStats
      ? {
          totalDistanceKm: user.rideStats.totalDistanceKm,
          longestRideKm: user.rideStats.longestRideKm,
          nightRides: user.rideStats.nightRides,
          weekendRides: user.rideStats.weekendRides,
        }
      : null,
    badges:
      user.badges?.map((userBadge: any) => ({
        id: userBadge.badge.id,
        title: userBadge.badge.title,
        auraPoints: userBadge.badge.auraPoints,
        icon: userBadge.badge.icon,
        earnedAt: userBadge.earnedAt,
      })) ?? [],
    social: {
      followers: user._count?.followers ?? 0,
      following: user._count?.following ?? 0,
      friends: user.friendsCount ?? 0,
    },
    safety: {
      emergencyContacts: {
        count: user.emergencyContacts?.length ?? 0,
        items: user.emergencyContacts ?? [],
      },
      helmetVerified: user.helmetVerified,
      lastSafetyCheck: user.lastSafetyCheck,
    },
    preferences: user.preferences,
  };
}

function normalizeEmail(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function getPhoneVariants(value?: string | null): string[] {
  if (!value) return [];
  const cleaned = value.trim();
  if (!cleaned) return [];

  const digitsOnly = cleaned.replace(/\D/g, "");
  const variants = new Set<string>([cleaned]);

  if (digitsOnly) {
    variants.add(digitsOnly);
    variants.add(`+${digitsOnly}`);
  }

  return Array.from(variants);
}

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
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
      100,
    );
    const scope =
      String(req.query.scope ?? "global").toLowerCase() === "city"
        ? "city"
        : "global";
    const city =
      typeof req.query.city === "string" && req.query.city.trim()
        ? req.query.city.trim()
        : null;

    // City scope is best-effort: User.location is free-text, so we
    // case-insensitively contains-match. With scope=city but no city
    // supplied, fall back to global.
    const where =
      scope === "city" && city
        ? { location: { contains: city, mode: "insensitive" as const } }
        : {};

    const users = await prisma.user.findMany({
      where,
      orderBy: [{ xpPoints: "desc" }, { level: "desc" }, { createdAt: "asc" }],
      take: limit,
      select: {
        id: true,
        username: true,
        name: true,
        avatar: true,
        location: true,
        xpPoints: true,
        level: true,
        levelTitle: true,
        subscriptionTier: true,
      },
    });

    const ranked = users.map((u, idx) => ({
      rank: idx + 1,
      ...u,
      xpPoints: u.xpPoints ?? 0,
    }));

    ApiResponse.success(res, { scope, city, leaderboard: ranked });
  }),
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
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, role, search } = req.query as any;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (role) {
      where.userRoles = { some: { role } };
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { username: { contains: search, mode: "insensitive" } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: limit,
        where,
        select: {
          id: true,
          email: true,
          username: true,
          name: true,
          avatar: true,
          bio: true,
          location: true,
          bloodType: true,
          phone: true,
          emailVerified: true,
          phoneVerified: true,
          xpPoints: true,
          level: true,
          levelTitle: true,
          activityLevel: true,
          reputationScore: true,
          userRoles: { select: { role: true } },
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where }),
    ]);

    const usersWithRoles = users.map(({ userRoles, ...u }) => ({
      ...u,
      roles: userRoles.map((r) => r.role),
    }));

    ApiResponse.paginated(res, usersWithRoles, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

router.post(
  "/contacts/match",
  validateBody(matchContactsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { contacts } = req.body as {
      contacts: Array<{ name?: string; phone?: string; email?: string }>;
    };

    const emailToContactName = new Map<string, string | undefined>();
    const phoneVariantToContactName = new Map<string, string | undefined>();
    const emailConditions: Array<Record<string, unknown>> = [];
    const phoneVariants = new Set<string>();

    for (const contact of contacts) {
      const normalizedEmail = normalizeEmail(contact.email);
      if (normalizedEmail) {
        emailToContactName.set(normalizedEmail, contact.name);
      }

      const variants = getPhoneVariants(contact.phone);
      variants.forEach((variant) => {
        phoneVariants.add(variant);
        if (!phoneVariantToContactName.has(variant)) {
          phoneVariantToContactName.set(variant, contact.name);
        }
      });
    }

    for (const email of emailToContactName.keys()) {
      emailConditions.push({
        email: {
          equals: email,
          mode: "insensitive",
        },
      });
    }

    const phoneCondition = phoneVariants.size
      ? {
          phone: {
            in: Array.from(phoneVariants),
          },
        }
      : null;

    const whereOr = [
      ...emailConditions,
      ...(phoneCondition ? [phoneCondition] : []),
    ];

    if (whereOr.length === 0) {
      return ApiResponse.success(res, {
        matches: [],
        summary: {
          scannedContacts: contacts.length,
          matchedUsers: 0,
        },
      });
    }

    const users = await prisma.user.findMany({
      where: {
        id: { not: session.user.id },
        OR: whereOr as any,
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        email: true,
        phone: true,
        preferences: {
          select: {
            openToInvite: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const matches = users
      .filter((user) => user.preferences?.openToInvite !== false)
      .map((user) => {
        const matchedBy: Array<"email" | "phone"> = [];
        const contactNames: string[] = [];

        const normalizedEmail = normalizeEmail(user.email);
        if (normalizedEmail && emailToContactName.has(normalizedEmail)) {
          matchedBy.push("email");
          const name = emailToContactName.get(normalizedEmail);
          if (name) contactNames.push(name);
        }

        const userPhoneVariants = getPhoneVariants(user.phone);
        const phoneMatch = userPhoneVariants.find((variant) =>
          phoneVariantToContactName.has(variant),
        );
        if (phoneMatch) {
          matchedBy.push("phone");
          const name = phoneVariantToContactName.get(phoneMatch);
          if (name) contactNames.push(name);
        }

        return {
          user: {
            id: user.id,
            name: user.name,
            username: user.username,
            avatar: user.avatar,
          },
          contactName: contactNames[0] || null,
          matchedBy,
        };
      })
      .filter((match) => match.matchedBy.length > 0);

    ApiResponse.success(res, {
      matches,
      summary: {
        scannedContacts: contacts.length,
        matchedUsers: matches.length,
      },
    });
  }),
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
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        userRoles: { select: { role: true } },
        bikes: true,
        badges: { include: { badge: true } },
        emergencyContacts: true,
        preferences: true,
        rideStats: true,
        clubMemberships: { include: { club: true } },
        _count: {
          select: {
            createdRides: true,
            createdClubs: true,
            followers: true,
            following: true,
            friendsInitiated: true,
            friendsReceived: true,
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

    const friendsCount =
      (user._count?.friendsInitiated ?? 0) +
      (user._count?.friendsReceived ?? 0);
    const userWithFriends = { ...user, friendsCount };
    ApiResponse.success(res, {
      user: buildUserProfileResponse(userWithFriends),
    });
  }),
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
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const isSelf = session.user.id === id;
    if (!isSelf) {
      // Check if requester has admin role
      const adminRole = await prisma.userRoleAssignment.findFirst({
        where: {
          userId: session.user.id,
          role: { in: ["ADMIN"] },
        },
      });

      if (!adminRole) {
        return ApiResponse.forbidden(
          res,
          "You don't have permission to update this user",
        );
      }
    }

    const {
      email,
      username,
      name,
      bio,
      location,
      bloodType,
      avatar,
      coverImage,
      dob,
      phone,
    } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(email !== undefined && { email }),
        ...(username !== undefined && { username }),
        ...(name !== undefined && { name }),
        ...(bio !== undefined && { bio }),
        ...(location !== undefined && { location }),
        ...(bloodType !== undefined && { bloodType }),
        ...(avatar !== undefined && { avatar }),
        ...(coverImage !== undefined && { coverImage }),
        ...(dob !== undefined && { dob: new Date(dob) }),
        ...(phone !== undefined && { phone }),
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        avatar: true,
        coverImage: true,
        bio: true,
        location: true,
        bloodType: true,
        dob: true,
        phone: true,
        userRoles: { select: { role: true } },
        updatedAt: true,
      },
    });

    const { userRoles: updatedRoles, ...userData } = user;
    ApiResponse.success(
      res,
      { user: { ...userData, roles: updatedRoles.map((r) => r.role) } },
      "User updated successfully",
    );
  }),
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
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        userRoles: {
          select: {
            role: true,
            assignedAt: true,
          },
          orderBy: { assignedAt: "desc" },
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

    ApiResponse.success(res, {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.userRoles,
      },
    });
  }),
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
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { role } = req.body;

    const validRoles = [
      "ADMIN", "CO_ADMIN", "MODERATOR", 
      "CLUB_OWNER", "CLUB_ADMIN", "CLUB_MODERATOR",
      "BRAND_OWNER", "BRAND_ADMIN", "BRAND_MODERATOR",
      "RIDER", "SELLER"
    ];
    
    if (!validRoles.includes(role)) {
      return ApiResponse.validationError(res, {
        role: [`Invalid role. Must be one of: ${validRoles.join(", ")}`],
      });
    }

    // Check if role already exists
    const existingRole = await prisma.userRoleAssignment.findUnique({
      where: { userId_role: { userId: id, role } },
    });

    if (existingRole) {
      return ApiResponse.error(
        res,
        "User already has this role",
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    // Add the role
    await prisma.userRoleAssignment.create({
      data: { userId: id, role },
    });

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        userRoles: { select: { role: true, assignedAt: true } },
      },
    });

    ApiResponse.success(
      res,
      { 
        user: {
          id: user?.id,
          email: user?.email,
          name: user?.name,
          roles: user?.userRoles || [],
        },
      },
      "Role added successfully",
    );
  }),
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
  asyncHandler(async (req: Request, res: Response) => {
    const { id, role } = req.params;

    const existingRole = await prisma.userRoleAssignment.findUnique({
      where: { userId_role: { userId: id, role: role as any } },
    });

    if (!existingRole) {
      return ApiResponse.notFound(res, "Role not found for this user");
    }

    await prisma.userRoleAssignment.delete({
      where: { userId_role: { userId: id, role: role as any } },
    });

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        userRoles: { select: { role: true, assignedAt: true } },
      },
    });

    ApiResponse.success(
      res,
      { 
        user: {
          id: user?.id,
          email: user?.email,
          name: user?.name,
          roles: user?.userRoles || [],
        },
      },
      "Role removed successfully",
    );
  }),
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
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const isSelf = session.user.id === id;
    if (!isSelf) {
      const adminRole = await prisma.userRoleAssignment.findFirst({
        where: {
          userId: session.user.id,
          role: { in: ["ADMIN"] },
        },
      });

      if (!adminRole) {
        return ApiResponse.forbidden(
          res,
          "You don't have permission to delete this user",
        );
      }
    }

    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existingUser) {
      return ApiResponse.notFound(
        res,
        "User not found",
        ErrorCode.USER_NOT_FOUND,
      );
    }

    await prisma.user.delete({ where: { id } });

    ApiResponse.success(res, null, "User deleted successfully");
  }),
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
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { page, limit, status, search } = req.query as any;
    const skip = (page - 1) * limit;

    const where: any = { creatorId: id };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [rides, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { participants: true } },
        },
      }),
      prisma.ride.count({ where }),
    ]);

    ApiResponse.paginated(res, rides, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
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
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { page, limit, search } = req.query as any;
    const skip = (page - 1) * limit;

    const where: any = { ownerId: id };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [clubs, total] = await Promise.all([
      prisma.club.findMany({
        where,
        include: {
          _count: { select: { members: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.club.count({ where }),
    ]);

    ApiResponse.paginated(res, clubs, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

// ========================================
// Bike Management (Current User)
// ========================================

router.get(
  "/me/bikes",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const bikes = await prisma.bike.findMany({
      where: { userId: session.user.id },
      include: {
        bikeModel: {
          include: { manufacturer: true },
        },
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
    });
    ApiResponse.success(res, bikes, "Bikes retrieved");
  }),
);

router.post(
  "/me/bikes",
  requireAuth,
  validateBody(createBikeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const bikeData = req.body;

    if (bikeData.isPrimary) {
      await prisma.bike.updateMany({
        where: { userId: session.user.id },
        data: { isPrimary: false },
      });
    }

    const bike = await prisma.bike.create({
      data: {
        ...bikeData,
        // Year is required at the DB level. Onboarding's quick-add only
        // collects make + model — fall back to the current year so the row
        // is valid; the user can fix it later from the bike detail screen.
        year: bikeData.year ?? new Date().getFullYear(),
        userId: session.user.id,
      },
    });

    ApiResponse.created(res, bike, "Bike added to garage");
  }),
);

router.patch(
  "/me/bikes/:bikeId",
  requireAuth,
  validateBody(updateBikeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { bikeId } = req.params;
    const bikeData = req.body;

    const existing = await prisma.bike.findFirst({
      where: { id: bikeId, userId: session.user.id },
    });

    if (!existing) {
      return ApiResponse.notFound(res, "Bike not found in your garage");
    }

    if (bikeData.isPrimary) {
      await prisma.bike.updateMany({
        where: { userId: session.user.id, id: { not: bikeId } },
        data: { isPrimary: false },
      });
    }

    const updated = await prisma.bike.update({
      where: { id: bikeId },
      data: bikeData,
    });

    ApiResponse.success(res, updated, "Bike updated");
  }),
);

router.delete(
  "/me/bikes/:bikeId",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { bikeId } = req.params;

    const existing = await prisma.bike.findFirst({
      where: { id: bikeId, userId: session.user.id },
    });

    if (!existing) {
      return ApiResponse.notFound(res, "Bike not found in your garage");
    }

    await prisma.bike.delete({
      where: { id: bikeId },
    });

    ApiResponse.success(res, null, "Bike removed from garage");
  }),
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
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const enabled = req.body?.enabled === true;
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        ghostModeEnabled: enabled,
        ghostModeSince: enabled ? new Date() : null,
      },
      select: {
        id: true,
        ghostModeEnabled: true,
        ghostModeSince: true,
      },
    });
    ApiResponse.success(
      res,
      {
        ghostModeEnabled: user.ghostModeEnabled,
        ghostModeSince: user.ghostModeSince,
      },
      enabled ? "Ghost mode enabled" : "Ghost mode disabled",
    );
  }),
);

export default router;
