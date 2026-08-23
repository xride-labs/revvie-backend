import { Router, Request, Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma.js";
import bcrypt from "bcryptjs";
import { requireAuth } from "../../config/auth.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import {
  validateBody,
  validateQuery,
  validateParams,
  asyncHandler,
} from "../../middlewares/validation.js";
import {
  requireAdmin,
  requireSuperAdmin,
  requireWebAccess,
  UserRole,
} from "../../middlewares/rbac.js";
import {
  adminUsersQuerySchema,
  createAdminUserSchema,
  idParamSchema,
  updateAdminUserSchema,
  updateUserRoleSchema,
  updateReportSchema,
  weeklyActivityQuerySchema,
  adminSettingsUpdateSchema,
  adminNotificationsQuerySchema,
} from "../../validators/schemas.js";
import { runJobManually } from "../../jobs/scheduler.js";
import { buildDailyRanges } from "../../lib/admin/activity.js";
import {
  getAdminSettings,
  updateAdminSettings,
} from "../../lib/adminSettings.js";
import adminCommerceRouter from "./admin.commerce.routes.js";

const router = Router();

// Admin CRUD for Phase 5/6/7 entities (businesses, ad campaigns, discounts).
// Mounted before the existing handlers so the requireAdmin gate inside that
// sub-router applies cleanly without depending on this file's route order.
router.use("/", adminCommerceRouter);

const PRIVILEGED_ADMIN_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.CO_ADMIN,
  UserRole.MODERATOR,
];

function getRequesterRoles(req: Request): UserRole[] {
  return (((req as any).userRoles ?? []) as UserRole[]).filter(Boolean);
}

function isRequesterSuperAdmin(req: Request): boolean {
  return getRequesterRoles(req).includes(UserRole.ADMIN);
}

function includesPrivilegedAdminRole(roles: readonly string[]): boolean {
  return roles.some((role) =>
    PRIVILEGED_ADMIN_ROLES.includes(role as UserRole),
  );
}

async function userHasPrivilegedAdminRole(userId: string): Promise<boolean> {
  const privilegedRole = await prisma.userRoleAssignment.findFirst({
    where: {
      userId,
      role: { in: PRIVILEGED_ADMIN_ROLES },
    },
    select: { id: true },
  });

  return Boolean(privilegedRole);
}

function toAdminUserRecord(user: {
  id: string;
  email: string | null;
  name: string | null;
  username: string | null;
  avatar: string | null;
  phone: string | null;
  bio: string | null;
  location: string | null;
  activityLevel: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  userRoles: Array<{ role: string }>;
  rideStats: { totalRides: number } | null;
  _count: { createdRides: number; createdClubs: number };
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.username,
    image: user.avatar,
    phone: user.phone,
    bio: user.bio,
    location: user.location,
    activityLevel: user.activityLevel,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    status: user.emailVerified ? "active" : "pending",
    lastActive: user.updatedAt.toISOString(),
    roles: user.userRoles.map((r) => r.role),
    ridesCompleted: user.rideStats?.totalRides ?? 0,
    createdAt: user.createdAt.toISOString(),
    _count: user._count,
  };
}

function toAdminUserDetail(user: {
  id: string;
  email: string | null;
  name: string | null;
  username: string | null;
  avatar: string | null;
  coverImage: string | null;
  phone: string | null;
  bio: string | null;
  location: string | null;
  activityLevel: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  dob: Date | null;
  bloodType: string | null;
  interests: string[];
  onboardingCompleted: boolean;
  xpPoints: number | null;
  level: number;
  levelTitle: string;
  reputationScore: number | null;
  helmetVerified: boolean;
  lastSafetyCheck: Date | null;
  subscriptionTier: string | null;
  createdAt: Date;
  updatedAt: Date;
  userRoles: Array<{ role: string }>;
  rideStats: {
    totalDistanceKm: number;
    longestRideKm: number;
    totalRides: number;
    nightRides: number;
    weekendRides: number;
    soloRides: number;
    groupRides: number;
    avgRideDistanceKm: number;
    totalRideTimeMin: number;
  } | null;
  preferences: {
    rideReminders: boolean;
    serviceReminderKm: number;
    darkMode: boolean;
    units: string;
    openToInvite: boolean;
    pushNotifications: boolean;
    emailNotifications: boolean;
    smsNotifications: boolean;
    profileVisibility: string;
    showLocation: boolean;
    showBikes: boolean;
    lowDataMode: boolean;
    showStats: boolean;
  } | null;
  emergencyContacts: Array<{
    id: string;
    name: string;
    phone: string;
    relationship: string | null;
    isPrimary: boolean;
  }>;
  badges: Array<{
    earnedAt: Date;
    badge: {
      id: string;
      title: string;
      icon: string | null;
      category: string | null;
      requirement: string | null;
      auraPoints: number;
    };
  }>;
  _count: {
    createdRides: number;
    createdClubs: number;
    posts: number;
    comments: number;
    followers: number;
    following: number;
    marketplaceListings: number;
    clubMemberships: number;
    rideParticipations: number;
    eventParticipations: number;
    notifications: number;
  };
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.username,
    image: user.avatar,
    coverImage: user.coverImage,
    phone: user.phone,
    bio: user.bio,
    location: user.location,
    activityLevel: user.activityLevel,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    status: user.emailVerified ? "active" : "pending",
    lastActive: user.updatedAt.toISOString(),
    roles: user.userRoles.map((r) => r.role),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    dob: user.dob?.toISOString() ?? null,
    bloodType: user.bloodType,
    interests: user.interests,
    onboardingCompleted: user.onboardingCompleted,
    xpPoints: user.xpPoints,
    level: user.level,
    levelTitle: user.levelTitle,
    reputationScore: user.reputationScore,
    helmetVerified: user.helmetVerified,
    lastSafetyCheck: user.lastSafetyCheck?.toISOString() ?? null,
    subscriptionTier: user.subscriptionTier,
    rideStats: user.rideStats,
    preferences: user.preferences,
    emergencyContacts: user.emergencyContacts,
    badges: user.badges.map((b) => ({
      earnedAt: b.earnedAt.toISOString(),
      badge: b.badge,
    })),
    counts: user._count,
  };
}

// All admin routes require authentication and web access
router.use(requireAuth);
router.use(requireWebAccess);

/**
 * @swagger
 * /api/admin/stats:
 *   get:
 *     summary: Get platform statistics
 *     description: Get platform-wide statistics including user counts, ride stats, and activity metrics. Requires SUPER_ADMIN role.
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Platform statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     overview:
 *                       type: object
 *                       properties:
 *                         totalUsers:
 *                           type: integer
 *                         totalRides:
 *                           type: integer
 *                         totalClubs:
 *                           type: integer
 *                         totalListings:
 *                           type: integer
 *                         activeRides:
 *                           type: integer
 *                         completedRides:
 *                           type: integer
 *                         verifiedClubs:
 *                           type: integer
 *                     recent:
 *                       type: object
 *                       properties:
 *                         newUsersLast7Days:
 *                           type: integer
 *                         newRidesLast7Days:
 *                           type: integer
 *                     breakdown:
 *                       type: object
 *                       properties:
 *                         usersByRole:
 *                           type: object
 *                         ridesByStatus:
 *                           type: object
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires SUPER_ADMIN role
 */
router.get(
  "/stats",
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const [
      totalUsers,
      totalRides,
      totalClubs,
      totalListings,
      activeRides,
      completedRides,
      verifiedClubs,
      pendingReports,
      highPriorityReports,
      reportsLast7Days,
      recentUsers,
      recentRides,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.ride.count(),
      prisma.club.count(),
      prisma.marketplaceListing.count(),
      prisma.ride.count({ where: { status: "IN_PROGRESS" } }),
      prisma.ride.count({ where: { status: "COMPLETED" } }),
      prisma.club.count({ where: { verified: true } }),
      prisma.report.count({ where: { status: "pending" } }),
      prisma.report.count({
        where: {
          status: { in: ["pending", "investigating"] },
          priority: { in: ["high", "critical"] },
        },
      }),
      prisma.report.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.user.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.ride.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    // Get user role breakdown from role assignments
    const usersByRole = await prisma.userRoleAssignment.groupBy({
      by: ["role"],
      _count: { role: true },
    });

    // Get rides by status
    const ridesByStatus = await prisma.ride.groupBy({
      by: ["status"],
      _count: { status: true },
    });

    ApiResponse.success(res, {
      overview: {
        totalUsers,
        totalRides,
        totalClubs,
        totalListings,
        activeRides,
        completedRides,
        verifiedClubs,
        pendingReports,
        highPriorityReports,
      },
      recent: {
        newUsersLast7Days: recentUsers,
        newRidesLast7Days: recentRides,
        reportsLast7Days,
      },
      breakdown: {
        usersByRole: (() => {
          const result: Record<string, number> = {};
          for (const item of usersByRole) {
            result[item.role] = item._count.role;
          }
          return result;
        })(),
        ridesByStatus: (() => {
          const result: Record<string, number> = {};
          for (const item of ridesByStatus) {
            result[item.status] = item._count.status;
          }
          return result;
        })(),
      },
    });
  }),
);

// Admin Settings (single global record)
router.get(
  "/settings",
  requireSuperAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    const settings = await getAdminSettings();
    ApiResponse.success(res, settings);
  }),
);

router.patch(
  "/settings",
  requireSuperAdmin,
  validateBody(adminSettingsUpdateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const settings = await updateAdminSettings(req.body ?? {});
    ApiResponse.success(res, settings, "Settings updated");
  }),
);

router.get(
  "/activity/weekly",
  requireAdmin,
  validateQuery(weeklyActivityQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { days } = req.query as { days: string };
    const ranges = buildDailyRanges(Number(days) || 7);

    const activity = await Promise.all(
      ranges.map(async (range) => {
        const [
          usersRegistered,
          ridesCreated,
          clubsCreated,
          listingsCreated,
          reportsCreated,
        ] = await Promise.all([
          prisma.user.count({
            where: { createdAt: { gte: range.start, lt: range.end } },
          }),
          prisma.ride.count({
            where: { createdAt: { gte: range.start, lt: range.end } },
          }),
          prisma.club.count({
            where: { createdAt: { gte: range.start, lt: range.end } },
          }),
          prisma.marketplaceListing.count({
            where: { createdAt: { gte: range.start, lt: range.end } },
          }),
          prisma.report.count({
            where: { createdAt: { gte: range.start, lt: range.end } },
          }),
        ]);

        return {
          label: range.label,
          date: range.dateKey,
          usersRegistered,
          ridesCreated,
          clubsCreated,
          listingsCreated,
          reportsCreated,
        };
      }),
    );

    ApiResponse.success(res, {
      days: ranges.length,
      activity,
    });
  }),
);

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get all users (admin)
 *     description: Get paginated list of all users with optional filters. Requires ADMIN role.
 *     tags: [Admin]
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
 *         name: role
 *         schema:
 *           type: string
 *           enum: [ADMIN, CO_ADMIN, CLUB_OWNER, RIDER, SELLER]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name or email
 *     responses:
 *       200:
 *         description: Paginated list of users
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 */
router.get(
  "/users",
  requireAdmin,
  validateQuery(adminUsersQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { page = 1, limit = 20, role, status, search } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (role) {
      where.userRoles = { some: { role } };
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { username: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }
    if (status === "active") {
      where.emailVerified = true;
    }
    if (status === "pending") {
      where.emailVerified = false;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: Number(limit),
        select: {
          id: true,
          email: true,
          name: true,
          username: true,
          avatar: true,
          phone: true,
          bio: true,
          location: true,
          activityLevel: true,
          emailVerified: true,
          phoneVerified: true,
          userRoles: { select: { role: true } },
          rideStats: { select: { totalRides: true } },
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { createdRides: true, createdClubs: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where }),
    ]);

    const usersWithRoles = users.map((user) => toAdminUserRecord(user));

    ApiResponse.paginated(res, usersWithRoles, {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    });
  }),
);

router.get(
  "/users/:id",
  validateParams(idParamSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const [user, unreadNotifications] = await Promise.all([
      prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          username: true,
          avatar: true,
          coverImage: true,
          phone: true,
          bio: true,
          location: true,
          activityLevel: true,
          emailVerified: true,
          phoneVerified: true,
          dob: true,
          bloodType: true,
          interests: true,
          onboardingCompleted: true,
          xpPoints: true,
          level: true,
          levelTitle: true,
          reputationScore: true,
          helmetVerified: true,
          lastSafetyCheck: true,
          subscriptionTier: true,
          userRoles: { select: { role: true } },
          rideStats: {
            select: {
              totalDistanceKm: true,
              longestRideKm: true,
              totalRides: true,
              nightRides: true,
              weekendRides: true,
              soloRides: true,
              groupRides: true,
              avgRideDistanceKm: true,
              totalRideTimeMin: true,
            },
          },
          preferences: {
            select: {
              rideReminders: true,
              serviceReminderKm: true,
              darkMode: true,
              units: true,
              openToInvite: true,
              pushNotifications: true,
              emailNotifications: true,
              smsNotifications: true,
              profileVisibility: true,
              showLocation: true,
              showBikes: true,
              lowDataMode: true,
              showStats: true,
            },
          },
          emergencyContacts: {
            select: {
              id: true,
              name: true,
              phone: true,
              relationship: true,
              isPrimary: true,
            },
            orderBy: { isPrimary: "desc" },
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
                  requirement: true,
                  auraPoints: true,
                },
              },
            },
            orderBy: { earnedAt: "desc" },
          },
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              createdRides: true,
              createdClubs: true,
              posts: true,
              comments: true,
              followers: true,
              following: true,
              marketplaceListings: true,
              clubMemberships: true,
              rideParticipations: true,
              eventParticipations: true,
              notifications: true,
            },
          },
        },
      }),
      prisma.notification.count({
        where: {
          userId: id,
          isRead: false,
        },
      }),
    ]);

    if (!user) {
      return ApiResponse.notFound(
        res,
        "User not found",
        ErrorCode.USER_NOT_FOUND,
      );
    }

    ApiResponse.success(res, {
      ...toAdminUserDetail(user),
      unreadNotifications,
    });
  }),
);

router.post(
  "/users",
  validateBody(createAdminUserSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const {
      email,
      password,
      name,
      username,
      phone,
      bio,
      location,
      activityLevel,
      emailVerified,
      phoneVerified,
      roles,
    } = req.body;

    if (
      !isRequesterSuperAdmin(req) &&
      Array.isArray(roles) &&
      includesPrivilegedAdminRole(roles)
    ) {
      return ApiResponse.forbidden(
        res,
        "Only super admins can assign ADMIN or CO_ADMIN roles",
        ErrorCode.INSUFFICIENT_PERMISSIONS,
      );
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email }, ...(username ? [{ username }] : [])],
      },
      select: { id: true },
    });

    if (existing) {
      return ApiResponse.conflict(
        res,
        "A user with this email or username already exists",
        ErrorCode.ALREADY_EXISTS,
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        username,
        phone,
        bio,
        location,
        activityLevel,
        emailVerified: emailVerified ?? false,
        phoneVerified: phoneVerified ?? false,
        userRoles: {
          create:
            roles && roles.length > 0
              ? roles.map((role: UserRole) => ({ role }))
              : [{ role: UserRole.RIDER }],
        },
        accounts: {
          create: {
            providerId: "credential",
            accountId: email,
            password: hashedPassword,
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        avatar: true,
        phone: true,
        bio: true,
        location: true,
        activityLevel: true,
        emailVerified: true,
        phoneVerified: true,
        userRoles: { select: { role: true } },
        rideStats: { select: { totalRides: true } },
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { createdRides: true, createdClubs: true },
        },
      },
    });

    ApiResponse.created(
      res,
      toAdminUserRecord(user),
      "User created successfully",
    );
  }),
);

router.patch(
  "/users/:id",
  validateParams(idParamSchema),
  validateBody(updateAdminUserSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
      roles,
      email,
      name,
      username,
      phone,
      bio,
      location,
      activityLevel,
      emailVerified,
      phoneVerified,
    } = req.body;

    if (!isRequesterSuperAdmin(req)) {
      const targetHasPrivilegedRole = await userHasPrivilegedAdminRole(id);
      if (targetHasPrivilegedRole) {
        return ApiResponse.forbidden(
          res,
          "Only super admins can modify admin or co-admin users",
          ErrorCode.INSUFFICIENT_PERMISSIONS,
        );
      }

      if (Array.isArray(roles) && includesPrivilegedAdminRole(roles)) {
        return ApiResponse.forbidden(
          res,
          "Only super admins can assign ADMIN or CO_ADMIN roles",
          ErrorCode.INSUFFICIENT_PERMISSIONS,
        );
      }
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          email,
          name,
          username,
          phone,
          bio,
          location,
          activityLevel,
          emailVerified,
          phoneVerified,
        },
        select: {
          id: true,
          email: true,
          name: true,
          username: true,
          avatar: true,
          phone: true,
          bio: true,
          location: true,
          activityLevel: true,
          emailVerified: true,
          phoneVerified: true,
          userRoles: { select: { role: true } },
          rideStats: { select: { totalRides: true } },
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { createdRides: true, createdClubs: true },
          },
        },
      });

      if (Array.isArray(roles)) {
        await tx.userRoleAssignment.deleteMany({ where: { userId: id } });
        await tx.userRoleAssignment.createMany({
          data: roles.map((role: UserRole) => ({ userId: id, role })),
          skipDuplicates: true,
        });
      }

      const refreshed = await tx.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          username: true,
          avatar: true,
          phone: true,
          bio: true,
          location: true,
          activityLevel: true,
          emailVerified: true,
          phoneVerified: true,
          userRoles: { select: { role: true } },
          rideStats: { select: { totalRides: true } },
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { createdRides: true, createdClubs: true },
          },
        },
      });

      return refreshed ?? user;
    });

    ApiResponse.success(
      res,
      toAdminUserRecord(updatedUser),
      "User updated successfully",
    );
  }),
);

/**
 * @swagger
 * /api/admin/users/{id}/role:
 *   patch:
 *     summary: Update user role
 *     description: Add a role to a user. Requires SUPER_ADMIN role.
 *     tags: [Admin]
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
 *                 enum: [ADMIN, CO_ADMIN, CLUB_OWNER, RIDER, SELLER]
 *     responses:
 *       200:
 *         description: Role updated successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires SUPER_ADMIN role
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch(
  "/users/:id/role",
  validateParams(idParamSchema),
  validateBody(updateUserRoleSchema),
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { role } = req.body;

    // Upsert the role assignment (add if missing, no-op if exists)
    await prisma.userRoleAssignment.upsert({
      where: { userId_role: { userId: id, role } },
      create: { userId: id, role },
      update: {},
    });

    // Return user with all current roles
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        userRoles: { select: { role: true } },
      },
    });

    const roles = user?.userRoles.map((r) => r.role) ?? [];
    ApiResponse.success(
      res,
      { user: { id: user?.id, email: user?.email, name: user?.name, roles } },
      "User role updated successfully",
    );
  }),
);

router.patch(
  "/users/:id/status",
  validateParams(idParamSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body as { status?: string };

    if (!status || !["active", "pending"].includes(status)) {
      return ApiResponse.validationError(
        res,
        { status: ["status must be one of: active, pending"] },
        "Invalid status value",
      );
    }

    if (!isRequesterSuperAdmin(req)) {
      const targetHasPrivilegedRole = await userHasPrivilegedAdminRole(id);
      if (targetHasPrivilegedRole) {
        return ApiResponse.forbidden(
          res,
          "Only super admins can update admin or co-admin status",
          ErrorCode.INSUFFICIENT_PERMISSIONS,
        );
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        emailVerified: status === "active",
      },
      select: { id: true, emailVerified: true },
    });

    ApiResponse.success(
      res,
      { id: user.id, status: user.emailVerified ? "active" : "pending" },
      "User status updated successfully",
    );
  }),
);

/**
 * @swagger
 * /api/admin/users/{id}:
 *   delete:
 *     summary: Delete a user
 *     description: Permanently delete a user account. Requires SUPER_ADMIN role. Cannot delete own account.
 *     tags: [Admin]
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
 *         description: User deleted successfully
 *       400:
 *         description: Cannot delete own account
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires SUPER_ADMIN role
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  "/users/:id",
  validateParams(idParamSchema),
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const session = (req as any).session;

    if (id === session.user.id) {
      return ApiResponse.error(
        res,
        "You cannot delete your own account",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    await prisma.user.delete({
      where: { id },
    });

    ApiResponse.success(res, null, "User deleted successfully");
  }),
);

/**
 * @swagger
 * /api/admin/rides:
 *   get:
 *     summary: Get all rides (admin)
 *     description: Get paginated list of all rides with filters. Requires ADMIN role.
 *     tags: [Admin]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PLANNED, IN_PROGRESS, COMPLETED, CANCELLED]
 *       - in: query
 *         name: creatorId
 *         schema:
 *           type: string
 *         description: Filter by creator ID
 *     responses:
 *       200:
 *         description: Paginated list of rides
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 */
router.get(
  "/rides",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const {
      page = 1,
      limit = 20,
      status,
      creatorId,
      search,
    } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (status) where.status = status;
    if (creatorId) where.creatorId = creatorId;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { startLocation: { contains: search, mode: "insensitive" } },
      ];
    }

    const [rides, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          creator: {
            select: { id: true, name: true, avatar: true },
          },
          _count: { select: { participants: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.ride.count({ where }),
    ]);

    ApiResponse.paginated(res, rides, {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    });
  }),
);

/**
 * @swagger
 * /api/admin/clubs:
 *   get:
 *     summary: Get all clubs (admin)
 *     description: Get paginated list of all clubs with filters. Requires ADMIN role.
 *     tags: [Admin]
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
 *         name: verified
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: ownerId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated list of clubs
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 */
router.get(
  "/clubs",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const {
      page = 1,
      limit = 20,
      verified,
      ownerId,
      search,
    } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (verified !== undefined) where.verified = verified === "true";
    if (ownerId) where.ownerId = ownerId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ];
    }

    const [clubs, total] = await Promise.all([
      prisma.club.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          owner: {
            select: { id: true, name: true, avatar: true },
          },
          _count: { select: { members: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.club.count({ where }),
    ]);

    ApiResponse.paginated(res, clubs, {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    });
  }),
);

/**
 * @swagger
 * /api/admin/clubs/{id}/verify:
 *   patch:
 *     summary: Verify or unverify a club
 *     description: Update club verification status. Requires ADMIN role.
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Club ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               verified:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Club verification status updated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch(
  "/clubs/:id/verify",
  validateParams(idParamSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { verified } = req.body;

    const club = await prisma.club.update({
      where: { id },
      data: { verified: verified ?? true },
      select: {
        id: true,
        name: true,
        verified: true,
      },
    });

    ApiResponse.success(
      res,
      { club },
      `Club ${club.verified ? "verified" : "unverified"} successfully`,
    );
  }),
);

/**
 * @swagger
 * /api/admin/jobs/{jobName}/run:
 *   post:
 *     summary: Run background job manually
 *     description: Trigger a background job to run immediately. Requires SUPER_ADMIN role.
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: Job name to run
 *     responses:
 *       200:
 *         description: Job executed successfully
 *       400:
 *         description: Invalid job name
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires SUPER_ADMIN role
 */
router.post(
  "/jobs/:jobName/run",
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { jobName } = req.params;

    try {
      const result = await runJobManually(jobName);
      ApiResponse.success(
        res,
        { result },
        `Job '${jobName}' executed successfully`,
      );
    } catch (error) {
      return ApiResponse.error(
        res,
        (error as Error).message,
        400,
        ErrorCode.INVALID_INPUT,
      );
    }
  }),
);

/**
 * @swagger
 * /api/admin/reports:
 *   get:
 *     summary: Get all reports (admin)
 *     description: Get paginated list of user/content reports. Requires ADMIN role.
 *     tags: [Admin]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, REVIEWING, RESOLVED, DISMISSED]
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *     responses:
 *       200:
 *         description: Paginated list of reports
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 */
router.get(
  "/reports",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { page = 1, limit = 20, status, priority } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;

    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          reporter: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.report.count({ where }),
    ]);

    const formattedReports = reports.map((report) => ({
      id: report.id,
      type: report.type,
      title: report.title,
      description: report.description ?? undefined,
      reportedItem: {
        id: report.reportedItemId ?? "",
        name: report.reportedItemName ?? "",
        type: report.reportedItemType ?? report.type,
      },
      reporter: {
        id: report.reporter?.id ?? "",
        name: report.reporter?.name ?? "Unknown",
      },
      status: report.status,
      priority: report.priority,
      createdAt: report.createdAt.toISOString(),
    }));

    ApiResponse.paginated(res, formattedReports, {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    });
  }),
);

/**
 * @swagger
 * /api/admin/reports/{id}:
 *   patch:
 *     summary: Update report status
 *     description: Update report status and resolution. Requires ADMIN role.
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Report ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PENDING, REVIEWING, RESOLVED, DISMISSED]
 *               resolution:
 *                 type: string
 *     responses:
 *       200:
 *         description: Report updated successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch(
  "/reports/:id",
  validateParams(idParamSchema),
  validateBody(updateReportSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, resolution } = req.body;

    const report = await prisma.report.update({
      where: { id },
      data: { status, resolution },
      include: {
        reporter: {
          select: { id: true, name: true },
        },
      },
    });

    ApiResponse.success(res, {
      report: {
        id: report.id,
        status: report.status,
        resolution: report.resolution,
        reporter: {
          id: report.reporter?.id ?? "",
          name: report.reporter?.name ?? "Unknown",
        },
      },
    });
  }),
);

/**
 * @swagger
 * /api/admin/notifications:
 *   get:
 *     summary: Get notifications (admin)
 *     description: Get paginated list of user notifications with filters. Requires ADMIN role.
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 */
router.get(
  "/notifications",
  requireAdmin,
  validateQuery(adminNotificationsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const {
      page = 1,
      limit = 25,
      userId,
      unreadOnly,
      type,
      search,
    } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (userId) where.userId = userId;
    if (unreadOnly === true) where.isRead = false;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { message: { contains: search, mode: "insensitive" } },
        { user: { is: { name: { contains: search, mode: "insensitive" } } } },
        { user: { is: { email: { contains: search, mode: "insensitive" } } } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true, email: true, avatar: true } },
        },
      }),
      prisma.notification.count({ where }),
    ]);

    const mapped = items.map((notification) => ({
      id: notification.id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      relatedType: notification.relatedType,
      relatedId: notification.relatedId,
      isRead: notification.isRead,
      readAt: notification.readAt?.toISOString() ?? null,
      sentViaEmail: notification.sentViaEmail,
      sentViaPush: notification.sentViaPush,
      createdAt: notification.createdAt.toISOString(),
      user: notification.user,
    }));

    ApiResponse.paginated(res, mapped, {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    });
  }),
);

/**
 * @swagger
 * /api/admin/marketplace:
 *   get:
 *     summary: Get all marketplace listings (admin)
 *     description: Get paginated list of all marketplace listings. Requires ADMIN role.
 *     tags: [Admin]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, SOLD, INACTIVE]
 *       - in: query
 *         name: sellerId
 *         schema:
 *           type: string
 *         description: Filter by seller ID
 *     responses:
 *       200:
 *         description: Paginated list of listings
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 */
router.get(
  "/marketplace",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { page = 1, limit = 20, status, sellerId, search } = req.query as any;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (status) where.status = status;
    if (sellerId) where.sellerId = sellerId;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [listings, total] = await Promise.all([
      prisma.marketplaceListing.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          seller: {
            select: { id: true, name: true, avatar: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.marketplaceListing.count({ where }),
    ]);

    ApiResponse.paginated(res, listings, {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    });
  }),
);

/**
 * @swagger
 * /api/admin/rides/{id}/status:
 *   patch:
 *     summary: Update ride status (admin)
 *     tags: [Admin]
 */
router.patch(
  "/rides/:id/status",
  validateParams(idParamSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status)
      return ApiResponse.error(
        res,
        "status is required",
        400,
        ErrorCode.VALIDATION_ERROR,
      );

    const ride = await prisma.ride.update({
      where: { id },
      data: { status },
      select: { id: true, title: true, status: true },
    });

    ApiResponse.success(res, { ride }, "Ride status updated");
  }),
);

/**
 * @swagger
 * /api/admin/rides/{id}:
 *   delete:
 *     summary: Delete a ride (admin)
 *     tags: [Admin]
 */
router.delete(
  "/rides/:id",
  validateParams(idParamSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    await prisma.ride.delete({ where: { id } });
    ApiResponse.success(res, null, "Ride deleted");
  }),
);

/**
 * @swagger
 * /api/admin/clubs/{id}:
 *   delete:
 *     summary: Delete a club (admin)
 *     tags: [Admin]
 */
router.delete(
  "/clubs/:id",
  validateParams(idParamSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    await prisma.club.delete({ where: { id } });
    ApiResponse.success(res, null, "Club deleted");
  }),
);

/**
 * @swagger
 * /api/admin/marketplace/{id}/status:
 *   patch:
 *     summary: Update listing status (admin)
 *     tags: [Admin]
 */
router.patch(
  "/marketplace/:id/status",
  validateParams(idParamSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status)
      return ApiResponse.error(
        res,
        "status is required",
        400,
        ErrorCode.VALIDATION_ERROR,
      );

    const listing = await prisma.marketplaceListing.update({
      where: { id },
      data: { status },
      select: { id: true, title: true, status: true },
    });

    ApiResponse.success(res, { listing }, "Listing status updated");
  }),
);

/**
 * @swagger
 * /api/admin/marketplace/{id}:
 *   delete:
 *     summary: Delete a listing (admin)
 *     tags: [Admin]
 */
router.delete(
  "/marketplace/:id",
  validateParams(idParamSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    await prisma.marketplaceListing.delete({ where: { id } });
    ApiResponse.success(res, null, "Listing deleted");
  }),
);

// Toggle Ride Featured Status
router.patch(
  "/rides/:id/featured",
  validateParams(idParamSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { isFeatured } = req.body;
    const ride = await prisma.ride.update({
      where: { id },
      data: { isFeatured: Boolean(isFeatured) },
    });
    ApiResponse.success(
      res,
      ride,
      `Ride featured status updated to ${isFeatured}`,
    );
  }),
);

// Toggle Event Featured Status
router.patch(
  "/events/:id/featured",
  validateParams(idParamSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { isFeatured } = req.body;
    const eventRecord = await prisma.event.update({
      where: { id },
      data: { isFeatured: Boolean(isFeatured) },
    });
    ApiResponse.success(
      res,
      eventRecord,
      `Event featured status updated to ${isFeatured}`,
    );
  }),
);

// Toggle Club Featured Status
router.patch(
  "/clubs/:id/featured",
  validateParams(idParamSchema),
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { isFeatured } = req.body;
    const club = await prisma.club.update({
      where: { id },
      data: { isFeatured: Boolean(isFeatured) },
    });
    ApiResponse.success(
      res,
      club,
      `Club featured status updated to ${isFeatured}`,
    );
  }),
);

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/admin/approvals:
 *   get:
 *     summary: Get all items awaiting admin action
 *     description: Returns unverified clubs, pending club join requests, and pending ride participant requests in a single call. Requires ADMIN role.
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending items grouped by type
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 */
router.get(
  "/approvals",
  requireAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    const [pendingClubs, pendingClubRequests, pendingRideRequests] =
      await Promise.all([
        prisma.club.findMany({
          where: { verified: false },
          take: 100,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            description: true,
            verified: true,
            createdAt: true,
            owner: { select: { id: true, name: true } },
            _count: { select: { members: true } },
          },
        }),
        prisma.clubJoinRequest.findMany({
          where: { status: "PENDING" },
          take: 100,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            createdAt: true,
            club: { select: { id: true, name: true } },
            user: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        }),
        prisma.rideParticipant.findMany({
          where: { status: "REQUESTED" },
          take: 100,
          orderBy: { joinedAt: "desc" },
          select: {
            id: true,
            status: true,
            joinedAt: true,
            ride: { select: { id: true, title: true, status: true } },
            user: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        }),
      ]);

    ApiResponse.success(res, {
      pendingClubs,
      pendingClubRequests,
      pendingRideRequests,
    });
  }),
);

/**
 * @swagger
 * /api/admin/club-join-requests/{requestId}/approve:
 *   post:
 *     summary: Approve a club join request
 *     description: Sets ClubJoinRequest status to APPROVED and creates a ClubMember record if one does not already exist. Requires ADMIN role.
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Request approved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post(
  "/club-join-requests/:requestId/approve",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { requestId } = req.params;

    const joinRequest = await prisma.clubJoinRequest.findUnique({
      where: { id: requestId },
      select: { id: true, clubId: true, userId: true, status: true },
    });

    if (!joinRequest) {
      return ApiResponse.notFound(
        res,
        "Club join request not found",
        ErrorCode.NOT_FOUND,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.clubJoinRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED" },
      });

      await tx.clubMember.upsert({
        where: {
          clubId_userId: {
            clubId: joinRequest.clubId,
            userId: joinRequest.userId,
          },
        },
        create: {
          clubId: joinRequest.clubId,
          userId: joinRequest.userId,
          role: "MEMBER",
        },
        update: {},
      });
    });

    ApiResponse.success(
      res,
      { requestId, status: "APPROVED" },
      "Club join request approved",
    );
  }),
);

/**
 * @swagger
 * /api/admin/club-join-requests/{requestId}/reject:
 *   post:
 *     summary: Reject a club join request
 *     description: Sets ClubJoinRequest status to REJECTED. Requires ADMIN role.
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Request rejected
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post(
  "/club-join-requests/:requestId/reject",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { requestId } = req.params;

    const joinRequest = await prisma.clubJoinRequest.findUnique({
      where: { id: requestId },
      select: { id: true },
    });

    if (!joinRequest) {
      return ApiResponse.notFound(
        res,
        "Club join request not found",
        ErrorCode.NOT_FOUND,
      );
    }

    await prisma.clubJoinRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED" },
    });

    ApiResponse.success(
      res,
      { requestId, status: "REJECTED" },
      "Club join request rejected",
    );
  }),
);

/**
 * @swagger
 * /api/admin/ride-participants/{participantId}/accept:
 *   post:
 *     summary: Accept a ride participant request
 *     description: Sets RideParticipant status to ACCEPTED. Requires ADMIN role.
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: participantId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Participant accepted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post(
  "/ride-participants/:participantId/accept",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { participantId } = req.params;

    const participant = await prisma.rideParticipant.findUnique({
      where: { id: participantId },
      select: { id: true },
    });

    if (!participant) {
      return ApiResponse.notFound(
        res,
        "Ride participant not found",
        ErrorCode.NOT_FOUND,
      );
    }

    await prisma.rideParticipant.update({
      where: { id: participantId },
      data: { status: "ACCEPTED" },
    });

    ApiResponse.success(
      res,
      { participantId, status: "ACCEPTED" },
      "Ride participant accepted",
    );
  }),
);

/**
 * @swagger
 * /api/admin/ride-participants/{participantId}/decline:
 *   post:
 *     summary: Decline a ride participant request
 *     description: Sets RideParticipant status to DECLINED. Requires ADMIN role.
 *     tags: [Admin]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: participantId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Participant declined
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires ADMIN role
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post(
  "/ride-participants/:participantId/decline",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { participantId } = req.params;

    const participant = await prisma.rideParticipant.findUnique({
      where: { id: participantId },
      select: { id: true },
    });

    if (!participant) {
      return ApiResponse.notFound(
        res,
        "Ride participant not found",
        ErrorCode.NOT_FOUND,
      );
    }

    await prisma.rideParticipant.update({
      where: { id: participantId },
      data: { status: "DECLINED" },
    });

    ApiResponse.success(
      res,
      { participantId, status: "DECLINED" },
      "Ride participant declined",
    );
  }),
);

// ─── Bulk Approval Routes ─────────────────────────────────────────────────────
// Single request handles N approvals — avoids N round trips from the UI.

import { BulkActionSchema, processBulkAction } from "../../lib/bulkActions.js";

const bulkIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

// Unified bulk action endpoint
router.post(
  "/bulk/action",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = BulkActionSchema.safeParse(req.body);
    if (!parsed.success) return ApiResponse.validationError(res, parsed.error);
    
    const session = (req as any).session;
    const result = await processBulkAction(parsed.data, {
      userId: session?.user?.id,
      userRoles: session?.userRoles,
    });
    
    ApiResponse.success(res, result, `Bulk action completed: ${result.processed} items processed`);
  }),
);

router.post(
  "/bulk/clubs/verify",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = bulkIdsSchema.safeParse(req.body);
    if (!parsed.success) return ApiResponse.validationError(res, parsed.error);
    const { ids } = parsed.data;
    const result = await prisma.club.updateMany({
      where: { id: { in: ids } },
      data: { verified: true },
    });
    ApiResponse.success(res, { updated: result.count }, `${result.count} clubs verified`);
  }),
);

router.post(
  "/bulk/club-join-requests/approve",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = bulkIdsSchema.safeParse(req.body);
    if (!parsed.success) return ApiResponse.validationError(res, parsed.error);
    const { ids } = parsed.data;

    const requests = await prisma.clubJoinRequest.findMany({
      where: { id: { in: ids }, status: "PENDING" },
      select: { id: true, clubId: true, userId: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.clubJoinRequest.updateMany({
        where: { id: { in: requests.map((r) => r.id) } },
        data: { status: "APPROVED" },
      });
      for (const r of requests) {
        await tx.clubMember.upsert({
          where: { clubId_userId: { clubId: r.clubId, userId: r.userId } },
          create: { userId: r.userId, clubId: r.clubId, role: "MEMBER" },
          update: {},
        });
      }
    });

    ApiResponse.success(res, { updated: requests.length }, `${requests.length} club join requests approved`);
  }),
);

router.post(
  "/bulk/ride-participants/accept",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = bulkIdsSchema.safeParse(req.body);
    if (!parsed.success) return ApiResponse.validationError(res, parsed.error);
    const { ids } = parsed.data;
    const result = await prisma.rideParticipant.updateMany({
      where: { id: { in: ids }, status: "REQUESTED" },
      data: { status: "ACCEPTED" },
    });
    ApiResponse.success(res, { updated: result.count }, `${result.count} ride participants accepted`);
  }),
);

router.post(
  "/bulk/businesses/approve",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = bulkIdsSchema.safeParse(req.body);
    if (!parsed.success) return ApiResponse.validationError(res, parsed.error);
    const { ids } = parsed.data;
    const result = await prisma.businessProfile.updateMany({
      where: { id: { in: ids }, verification: "SUBMITTED" },
      data: { verification: "APPROVED" },
    });
    ApiResponse.success(res, { updated: result.count }, `${result.count} businesses approved`);
  }),
);

router.post(
  "/bulk/ad-campaigns/approve",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = bulkIdsSchema.safeParse(req.body);
    if (!parsed.success) return ApiResponse.validationError(res, parsed.error);
    const { ids } = parsed.data;
    const result = await prisma.adCampaign.updateMany({
      where: { id: { in: ids }, status: "PENDING_APPROVAL" },
      data: { status: "ACTIVE" },
    });
    ApiResponse.success(res, { updated: result.count }, `${result.count} ad campaigns approved`);
  }),
);

export default router;

