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
import {
  requireOwnershipOrAdmin,
  requireClubMembership,
} from "../../middlewares/rbac.js";
import { requireClubCreationEnabled } from "../../middlewares/appSettings.js";
import {
  createClubSchema,
  updateClubSchema,
  clubQuerySchema,
  clubDiscoverQuerySchema,
  myClubsQuerySchema,
  idParamSchema,
  updateMemberRoleSchema,
} from "../../validators/schemas.js";
import { sendClubJoinEmail } from "../../lib/mailer.js";
import { notifyUsers, createNotification } from "../../lib/notifications.js";
import { countUserOwnedClubs, isUserPro } from "../../lib/subscription.js";
import {
  ensureGroupConversation,
  addGroupParticipant,
  removeGroupParticipant,
  postGroupSystemMessage,
  syncGroupMetadata,
  archiveGroupConversation,
  ensureAnnouncementsGroup,
  addClubMemberToAnnouncements,
  removeClubMemberFromClubChats,
  getGroupChatSummaries,
} from "../../services/clubGroupChat.service.js";
import {
  applyModeration,
  effectiveStatus,
  type ModerationAction,
} from "../../services/clubModeration.service.js";
import { z } from "zod";

const router = Router();

// All club routes require authentication
router.use(requireAuth);

const clubGroupQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  search: z.string().max(120).optional(),
});

const moderationBodySchema = z.object({
  action: z.enum([
    "PROMOTE",
    "DEMOTE",
    "MUTE",
    "UNMUTE",
    "SUSPEND",
    "UNSUSPEND",
    "BAN",
    "UNBAN",
    "KICK",
  ]),
  // Timed mute/suspend/ban. Omit for permanent. Clamp to ≤ 1 year.
  expiresInMs: z.coerce
    .number()
    .int()
    .positive()
    .max(366 * 24 * 60 * 60 * 1000)
    .optional(),
  reason: z.string().max(500).optional(),
});

const createClubGroupSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  image: z.string().url().optional(),
  joinApprovalRequired: z.boolean().default(true),
  memberIds: z.array(z.string().cuid()).max(200).optional(),
});

const joinClubGroupSchema = z.object({
  message: z.string().max(500).optional(),
});

const clubGroupParamsSchema = idParamSchema.extend({
  groupId: idParamSchema.shape.id,
});

const clubGroupRequestParamsSchema = idParamSchema.extend({
  groupId: idParamSchema.shape.id,
  userId: idParamSchema.shape.id,
});

const clubRideQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  status: z
    .enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
    .optional(),
  search: z.string().max(120).optional(),
});

const createClubGroupRideSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(5000).optional(),
  startLocation: z.string().min(2).max(200),
  endLocation: z.string().max(200).optional(),
  scheduledAt: z.string().datetime().optional(),
  distance: z.number().positive().optional(),
  duration: z.number().int().positive().optional(),
  experienceLevel: z.string().max(100).optional(),
  pace: z.string().max(100).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

/**
 * @swagger
 * /api/clubs:
 *   get:
 *     summary: Get all clubs
 *     description: Retrieve a paginated list of public clubs
 *     tags: [Clubs]
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
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by club name or description
 *       - in: query
 *         name: verified
 *         schema:
 *           type: boolean
 *         description: Filter by verification status
 *       - in: query
 *         name: isPublic
 *         schema:
 *           type: boolean
 *         description: Filter by public/private status
 *     responses:
 *       200:
 *         description: List of clubs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 clubs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Club'
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
  validateQuery(clubQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, isPublic, requiresLicense, verified, search } =
      req.query as any;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (isPublic !== undefined) where.isPublic = isPublic;
    if (verified !== undefined) where.verified = verified;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [clubs, total] = await Promise.all([
      prisma.club.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          owner: {
            select: { id: true, name: true, avatar: true },
          },
          _count: { select: { members: true } },
        },
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

/**
 * @swagger
 * /api/clubs/my:
 *   get:
 *     summary: Get my clubs
 *     description: Get all clubs where the current user is a member or owner
 *     tags: [Clubs]
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
 *         description: Search by club name or description
 *     responses:
 *       200:
 *         description: List of user's clubs
 */
router.get(
  "/my",
  validateQuery(myClubsQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { page, limit, search } = req.query as any;
    const skip = (page - 1) * limit;

    const clubSearch = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const memberships = await prisma.clubMember.findMany({
      where: {
        userId: session.user.id,
        club: clubSearch,
      },
      include: {
        club: {
          include: {
            owner: {
              select: { id: true, name: true, avatar: true },
            },
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { joinedAt: "desc" },
    });

    // Also include clubs where user is the owner
    const ownedClubs = await prisma.club.findMany({
      where: {
        ownerId: session.user.id,
        ...clubSearch,
      },
      include: {
        owner: {
          select: { id: true, name: true, avatar: true },
        },
        _count: { select: { members: true } },
      },
    });

    const allClubs = [
      ...memberships.map((m) => ({
        ...m.club,
        role: m.role,
        memberCount: m.club._count.members,
      })),
      ...ownedClubs.map((c) => ({
        ...c,
        role: "FOUNDER",
        memberCount: c._count.members,
      })),
    ];

    // Deduplicate (owner might also be a member)
    const uniqueClubs = Array.from(
      new Map(allClubs.map((c) => [c.id, c])).values(),
    );

    const total = uniqueClubs.length;
    const paginatedClubs = uniqueClubs.slice(skip, skip + limit);

    ApiResponse.paginated(res, paginatedClubs, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

/**
 * @swagger
 * /api/clubs/discover:
 *   get:
 *     summary: Discover public clubs
 *     description: Get paginated list of public clubs for discovery (excludes clubs user is already in)
 *     tags: [Clubs]
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
 *         description: Search by club name or description
 *       - in: query
 *         name: clubType
 *         schema:
 *           type: string
 *         description: Filter by club type
 *       - in: query
 *         name: location
 *         schema:
 *           type: string
 *         description: Filter by location (partial match)
 *     responses:
 *       200:
 *         description: List of discoverable clubs
 */
router.get(
  "/discover",
  validateQuery(clubDiscoverQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { page, limit, search, clubType, location } = req.query as any;
    const skip = (page - 1) * limit;

    // Get clubs user is NOT a member of
    const userClubIds = await prisma.clubMember.findMany({
      where: { userId: session.user.id },
      select: { clubId: true },
    });

    const userOwnedClubs = await prisma.club.findMany({
      where: { ownerId: session.user.id },
      select: { id: true },
    });

    const excludeIds = [
      ...userClubIds.map((m) => m.clubId),
      ...userOwnedClubs.map((c) => c.id),
    ];

    const where: any = {
      isPublic: true,
      id: { notIn: excludeIds },
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }
    if (clubType) where.clubType = clubType;
    if (location) where.location = { contains: location, mode: "insensitive" };

    const clubs = await prisma.club.findMany({
      where,
      include: {
        owner: {
          select: { id: true, name: true, avatar: true },
        },
        _count: { select: { members: true } },
      },
      orderBy: { memberCount: "desc" },
      skip,
      take: limit + 1,
    });

    const hasMore = clubs.length > limit;
    const resultClubs = hasMore ? clubs.slice(0, limit) : clubs;

    ApiResponse.success(res, {
      clubs: resultClubs.map((c) => ({
        ...c,
        memberCount: c._count.members,
      })),
      hasMore,
    });
  }),
);

/**
 * @swagger
 * /api/clubs/{id}:
 *   get:
 *     summary: Get club by ID
 *     description: Retrieve a single club by its unique identifier
 *     tags: [Clubs]
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
 *     responses:
 *       200:
 *         description: Club details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 club:
 *                   $ref: '#/components/schemas/Club'
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
    const session = (req as any).session;

    const club = await prisma.club.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, name: true, avatar: true },
        },
        members: {
          include: {
            user: {
              select: { id: true, name: true, avatar: true },
            },
          },
          orderBy: { joinedAt: "desc" },
          take: 20,
        },
        _count: { select: { members: true, joinRequests: true } },
      },
    });

    if (!club) {
      return ApiResponse.notFound(
        res,
        "Club not found",
        ErrorCode.CLUB_NOT_FOUND,
      );
    }

    // Check if the current user has a pending join request
    let joinRequestStatus: string | null = null;
    if (session?.user?.id) {
      const joinRequest = await prisma.clubJoinRequest.findUnique({
        where: { clubId_userId: { clubId: id, userId: session.user.id } },
        select: { status: true },
      });
      joinRequestStatus = joinRequest?.status || null;
    }

    // Count pending requests (for admins)
    const pendingRequestCount = await prisma.clubJoinRequest.count({
      where: { clubId: id, status: "PENDING" },
    });

    ApiResponse.success(res, {
      club: { ...club, joinRequestStatus, pendingRequestCount },
    });
  }),
);

router.get(
  "/:id/rides",
  validateParams(idParamSchema),
  validateQuery(clubRideQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const session = (req as any).session;
    const { page, limit, status, search } = req.query as any;
    const skip = (page - 1) * limit;

    const club = await prisma.club.findUnique({
      where: { id },
      select: { id: true, isPublic: true, ownerId: true },
    });

    if (!club) {
      return ApiResponse.notFound(
        res,
        "Club not found",
        ErrorCode.CLUB_NOT_FOUND,
      );
    }

    if (!club.isPublic && club.ownerId !== session.user.id) {
      const membership = await prisma.clubMember.findUnique({
        where: {
          clubId_userId: {
            clubId: id,
            userId: session.user.id,
          },
        },
        select: { id: true },
      });

      if (!membership) {
        return ApiResponse.forbidden(
          res,
          "You are not a member of this private club",
        );
      }
    }

    const where: any = { clubId: id };
    if (status) where.status = status;
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
        take: limit,
        orderBy: { scheduledAt: "desc" },
        include: {
          creator: {
            select: { id: true, name: true, avatar: true },
          },
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
 * /api/clubs:
 *   post:
 *     summary: Create a new club
 *     description: Create a new club with the provided details
 *     tags: [Clubs]
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
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 example: Bay Area Riders
 *               description:
 *                 type: string
 *                 example: A community for cycling enthusiasts
 *               image:
 *                 type: string
 *                 format: uri
 *                 example: https://example.com/club-image.jpg
 *               isPublic:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Club created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Club created successfully
 *                 club:
 *                   $ref: '#/components/schemas/Club'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  "/",
  requireClubCreationEnabled,
  validateBody(createClubSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const hasPro = await isUserPro(session.user.id);

    if (!hasPro) {
      const ownedClubCount = await countUserOwnedClubs(session.user.id);
      if (ownedClubCount >= 1) {
        return ApiResponse.error(
          res,
          "Revvie Pro is required to create more clubs",
          403,
          ErrorCode.SUBSCRIPTION_REQUIRED,
        );
      }
    }

    const {
      name,
      description,
      location,
      clubType,
      isPublic,
      requiresLicense,
      image,
      coverImage,
    } = req.body;

    const club = await prisma.club.create({
      data: {
        name,
        description,
        location,
        clubType,
        image,
        coverImage,
        isPublic: isPublic ?? true,
        requiresLicense: requiresLicense ?? false,
        ownerId: session.user.id,
      },
      include: {
        owner: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Add owner as FOUNDER member
    await prisma.clubMember.create({
      data: {
        clubId: club.id,
        userId: session.user.id,
        role: "FOUNDER",
      },
    });

    // Ensure user has CLUB_OWNER role
    await prisma.userRoleAssignment.upsert({
      where: { userId_role: { userId: session.user.id, role: "CLUB_OWNER" } },
      create: { userId: session.user.id, role: "CLUB_OWNER" },
      update: {},
    });

    // WhatsApp-Community bootstrap: every club gets a default, admin-only
    // "Announcements" group + chat. Best-effort so chat infra hiccups never
    // block club creation.
    await ensureAnnouncementsGroup(club.id).catch((e) =>
      console.error("[clubs] announcements bootstrap failed:", e),
    );

    ApiResponse.created(res, { club }, "Club created successfully");
  }),
);

/**
 * @swagger
 * /api/clubs/{id}:
 *   patch:
 *     summary: Update a club
 *     description: Update club details. Must be club owner or admin. Club images (logo/cover) should be uploaded via /api/media/upload/club/{clubId} endpoint and will be served via Cloudinary.
 *     tags: [Clubs]
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
 *               description:
 *                 type: string
 *               location:
 *                 type: string
 *               clubType:
 *                 type: string
 *               isPublic:
 *                 type: boolean
 *               image:
 *                 type: string
 *                 format: uri
 *                 description: Club logo URL (Cloudinary)
 *               coverImage:
 *                 type: string
 *                 format: uri
 *                 description: Club cover URL (Cloudinary)
 *     responses:
 *       200:
 *         description: Club updated successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not club owner or admin
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch(
  "/:id",
  validateParams(idParamSchema),
  validateBody(updateClubSchema),
  requireOwnershipOrAdmin("club"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
      name,
      description,
      location,
      clubType,
      isPublic,
      requiresLicense,
      image,
      coverImage,
    } = req.body;

    const club = await prisma.club.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(location !== undefined && { location }),
        ...(clubType !== undefined && { clubType }),
        ...(image !== undefined && { image }),
        ...(coverImage !== undefined && { coverImage }),
        ...(isPublic !== undefined && { isPublic }),
        ...(requiresLicense !== undefined && { requiresLicense }),
      },
      include: {
        owner: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    ApiResponse.success(res, { club }, "Club updated successfully");
  }),
);

/**
 * @swagger
 * /api/clubs/{id}:
 *   delete:
 *     summary: Delete a club
 *     description: Delete a club and all its members. Must be club owner or admin.
 *     tags: [Clubs]
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
 *         description: Club deleted successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not club owner or admin
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  "/:id",
  validateParams(idParamSchema),
  requireOwnershipOrAdmin("club"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Delete members first
    await prisma.clubMember.deleteMany({
      where: { clubId: id },
    });

    await prisma.club.delete({
      where: { id },
    });

    ApiResponse.success(res, null, "Club deleted successfully");
  }),
);

/**
 * @swagger
 * /api/clubs/{id}/join:
 *   post:
 *     summary: Join a club
 *     description: Join a public club as a member.
 *     tags: [Clubs]
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
 *     responses:
 *       201:
 *         description: Joined club successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Club is private
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Already a member
 */
router.post(
  "/:id/join",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const club = await prisma.club.findUnique({
      where: { id },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!club) {
      return ApiResponse.notFound(
        res,
        "Club not found",
        ErrorCode.CLUB_NOT_FOUND,
      );
    }

    // Check if already a member
    const existing = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId: id, userId: session.user.id } },
    });

    if (existing) {
      if (effectiveStatus(existing) === "BANNED") {
        return ApiResponse.forbidden(
          res,
          "You are banned from this community",
        );
      }
      return ApiResponse.conflict(res, "You are already a member of this club");
    }

    // For private clubs, create a join request instead of directly adding
    if (!club.isPublic) {
      // Check for existing pending request
      const existingRequest = await prisma.clubJoinRequest.findUnique({
        where: { clubId_userId: { clubId: id, userId: session.user.id } },
      });

      if (existingRequest?.status === "PENDING") {
        return ApiResponse.conflict(
          res,
          "You already have a pending join request",
        );
      }

      // Create or upsert (handles re-requesting after rejection)
      const joinRequest = await prisma.clubJoinRequest.upsert({
        where: { clubId_userId: { clubId: id, userId: session.user.id } },
        create: {
          clubId: id,
          userId: session.user.id,
          message: req.body.message || null,
          status: "PENDING",
        },
        update: {
          status: "PENDING",
          message: req.body.message || null,
        },
      });

      const [clubAdmins, requester] = await Promise.all([
        prisma.clubMember.findMany({
          where: {
            clubId: id,
            role: { in: ["ADMIN", "FOUNDER"] },
          },
          select: { userId: true },
        }),
        prisma.user.findUnique({
          where: { id: session.user.id },
          select: { name: true },
        }),
      ]);

      const approverIds = Array.from(
        new Set([club.ownerId, ...clubAdmins.map((entry) => entry.userId)]),
      ).filter((userId) => userId !== session.user.id);

      await notifyUsers(approverIds, {
        type: "CLUB_REQUEST",
        title: `New request to join ${club.name}`,
        message: `${requester?.name || "A rider"} requested to join your club community.`,
        relatedType: "club",
        relatedId: id,
      });

      return ApiResponse.created(
        res,
        { joinRequest },
        "Join request sent — waiting for admin approval",
      );
    }

    // Public clubs — add directly
    const membership = await prisma.clubMember.create({
      data: {
        clubId: id,
        userId: session.user.id,
        role: "MEMBER",
      },
      include: {
        user: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Update member count
    await prisma.club.update({
      where: { id },
      data: { memberCount: { increment: 1 } },
    });

    // Auto-enroll into the club's Announcements channel.
    await addClubMemberToAnnouncements(id, session.user.id);

    // if (club.owner?.email && club.owner.id !== session.user.id) {
    //   const memberName = membership.user?.name || "A new member";
    //   try {
    //     await sendClubJoinEmail({
    //       to: club.owner.email,
    //       clubName: club.name,
    //       memberName,
    //     });
    //   } catch (error) {
    //     console.warn("[Email] Club join email failed:", error);
    //   }
    // }

    if (club.ownerId !== session.user.id) {
      const joinedBy = membership.user?.name || "A rider";
      await createNotification({
        userId: club.ownerId,
        type: "CLUB_INVITE",
        title: `${joinedBy} joined ${club.name}`,
        message: `${joinedBy} is now part of your club community.`,
        relatedType: "club",
        relatedId: id,
      });

      if (club.owner?.email) {
        await sendClubJoinEmail({
          to: club.owner.email,
          clubName: club.name,
          memberName: joinedBy,
        });
      }
    }

    ApiResponse.created(res, { membership }, "Joined club successfully");
  }),
);

/**
 * @swagger
 * /api/clubs/{id}/leave:
 *   delete:
 *     summary: Leave a club
 *     description: Leave a club you have joined. Founders cannot leave - they must transfer ownership or delete the club.
 *     tags: [Clubs]
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
 *     responses:
 *       200:
 *         description: Left club successfully
 *       400:
 *         description: Founders cannot leave
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Not a member of this club
 */
router.delete(
  "/:id/leave",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const membership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId: id, userId: session.user.id } },
    });

    if (!membership) {
      return ApiResponse.notFound(res, "You are not a member of this club");
    }

    if (membership.role === "FOUNDER") {
      return ApiResponse.error(
        res,
        "Club founders cannot leave. Transfer ownership or delete the club.",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    await prisma.clubMember.delete({
      where: { clubId_userId: { clubId: id, userId: session.user.id } },
    });

    // Drop them from every club group + chat (Announcements included).
    await removeClubMemberFromClubChats(id, session.user.id);

    // Update member count
    await prisma.club.update({
      where: { id },
      data: { memberCount: { decrement: 1 } },
    });

    ApiResponse.success(res, null, "Left club successfully");
  }),
);

/**
 * @swagger
 * /api/clubs/{id}/members:
 *   get:
 *     summary: Get club members
 *     description: Get paginated list of club members
 *     tags: [Clubs]
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
 *     responses:
 *       200:
 *         description: List of club members
 */
router.get(
  "/:id/members",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;

    const members = await prisma.clubMember.findMany({
      where: { clubId: id },
      include: {
        user: {
          select: { id: true, name: true, avatar: true, email: true },
        },
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
      skip,
      take: limit + 1,
    });

    const hasMore = members.length > limit;
    const resultMembers = hasMore ? members.slice(0, limit) : members;

    ApiResponse.success(res, {
      members: resultMembers.map((m) => ({
        userId: m.userId,
        user: m.user,
        role: m.role,
        joinedAt: m.joinedAt,
        status: effectiveStatus(m),
        lastInteractionAt: m.lastInteractionAt,
        lastMessageAt: m.lastMessageAt,
        messageCount: m.messageCount,
      })),
      hasMore,
    });
  }),
);

/**
 * @swagger
 * /api/clubs/{id}/requests:
 *   get:
 *     summary: Get pending join requests
 *     description: Get list of pending join requests for a club. Requires club ADMIN role.
 *     tags: [Clubs]
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
 *         description: List of pending requests
 */
router.get(
  "/:id/requests",
  validateParams(idParamSchema),
  requireClubMembership("ADMIN", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const requests = await prisma.clubJoinRequest.findMany({
      where: { clubId: id, status: "PENDING" },
      include: {
        user: {
          select: { id: true, name: true, avatar: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    ApiResponse.success(res, { requests });
  }),
);

/**
 * @swagger
 * /api/clubs/{id}/requests/{userId}/approve:
 *   post:
 *     summary: Approve join request
 *     description: Approve a pending join request. Requires club ADMIN role.
 *     tags: [Clubs]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Request approved
 */
router.post(
  "/:id/requests/:userId/approve",
  validateParams(idParamSchema.extend({ userId: idParamSchema.shape.id })),
  requireClubMembership("ADMIN", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, userId } = req.params;
    const approvedBy = (req as any).session?.user?.name || "Club admin";

    const club = await prisma.club.findUnique({
      where: { id },
      select: { name: true },
    });

    const joinRequest = await prisma.clubJoinRequest.findUnique({
      where: { clubId_userId: { clubId: id, userId } },
    });

    if (!joinRequest || joinRequest.status !== "PENDING") {
      return ApiResponse.notFound(res, "No pending join request found");
    }

    // Update request status
    await prisma.clubJoinRequest.update({
      where: { id: joinRequest.id },
      data: { status: "APPROVED" },
    });

    // Add user as a member
    await prisma.clubMember.create({
      data: {
        clubId: id,
        userId,
        role: "MEMBER",
      },
    });

    // Update member count
    await prisma.club.update({
      where: { id },
      data: { memberCount: { increment: 1 } },
    });

    // Auto-enroll into the club's Announcements channel.
    await addClubMemberToAnnouncements(id, userId);

    await createNotification({
      userId,
      type: "CLUB_INVITE",
      title: `Your request to join ${club?.name || "club"} was approved`,
      message: `${approvedBy} approved your request. Welcome to the community!`,
      relatedType: "club",
      relatedId: id,
    });

    ApiResponse.success(res, null, "Request approved — member added");
  }),
);

/**
 * @swagger
 * /api/clubs/{id}/requests/{userId}/reject:
 *   post:
 *     summary: Reject join request
 *     description: Reject a pending join request. Requires club ADMIN role.
 *     tags: [Clubs]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Request rejected
 */
router.post(
  "/:id/requests/:userId/reject",
  validateParams(idParamSchema.extend({ userId: idParamSchema.shape.id })),
  requireClubMembership("ADMIN", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, userId } = req.params;
    const rejectedBy = (req as any).session?.user?.name || "Club admin";

    const club = await prisma.club.findUnique({
      where: { id },
      select: { name: true },
    });

    const joinRequest = await prisma.clubJoinRequest.findUnique({
      where: { clubId_userId: { clubId: id, userId } },
    });

    if (!joinRequest || joinRequest.status !== "PENDING") {
      return ApiResponse.notFound(res, "No pending join request found");
    }

    await prisma.clubJoinRequest.update({
      where: { id: joinRequest.id },
      data: { status: "REJECTED" },
    });

    await createNotification({
      userId,
      type: "CLUB_REQUEST",
      title: `Your request to join ${club?.name || "club"} was declined`,
      message: `${rejectedBy} declined your join request. You can try again later.`,
      relatedType: "club",
      relatedId: id,
    });

    ApiResponse.success(res, null, "Request rejected");
  }),
);

/**
 * @swagger
 * /api/clubs/{id}/join:
 *   delete:
 *     summary: Cancel join request
 *     description: Cancel a pending join request
 *     tags: [Clubs]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Request cancelled
 */
router.delete(
  "/:id/join",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const joinRequest = await prisma.clubJoinRequest.findUnique({
      where: { clubId_userId: { clubId: id, userId: session.user.id } },
    });

    if (!joinRequest || joinRequest.status !== "PENDING") {
      return ApiResponse.notFound(res, "No pending join request found");
    }

    await prisma.clubJoinRequest.delete({
      where: { id: joinRequest.id },
    });

    ApiResponse.success(res, null, "Join request cancelled");
  }),
);

/**
 * @swagger
 * /api/clubs/{id}/members/{userId}:
 *   patch:
 *     summary: Update member role
 *     description: Update a club member's role. Requires club ADMIN role.
 *     tags: [Clubs]
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
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: Member user ID
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
 *                 enum: [MEMBER, OFFICER, ADMIN]
 *     responses:
 *       200:
 *         description: Member role updated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires club ADMIN role
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch(
  "/:id/members/:userId",
  validateParams(idParamSchema.extend({ userId: idParamSchema.shape.id })),
  validateBody(updateMemberRoleSchema),
  requireClubMembership("ADMIN", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, userId } = req.params;
    const { role } = req.body;

    const membership = await prisma.clubMember.update({
      where: { clubId_userId: { clubId: id, userId } },
      data: { role },
      include: {
        user: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    ApiResponse.success(res, { membership }, `Member role updated to ${role}`);
  }),
);

/**
 * @swagger
 * /api/clubs/{id}/members/{userId}:
 *   delete:
 *     summary: Remove a member from club
 *     description: Remove a member from the club. Requires club ADMIN role. Cannot remove founders.
 *     tags: [Clubs]
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
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: Member user ID
 *     responses:
 *       200:
 *         description: Member removed successfully
 *       400:
 *         description: Cannot remove yourself
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Requires club ADMIN role or cannot remove founder
 *       404:
 *         description: Member not found
 */
router.delete(
  "/:id/members/:userId",
  validateParams(idParamSchema.extend({ userId: idParamSchema.shape.id })),
  requireClubMembership("ADMIN", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id, userId } = req.params;

    if (userId === session.user.id) {
      return ApiResponse.error(
        res,
        "You cannot remove yourself. Use the leave endpoint instead.",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    const membership = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId: id, userId } },
    });

    if (!membership) {
      return ApiResponse.notFound(res, "Member not found");
    }

    if (membership.role === "FOUNDER") {
      return ApiResponse.forbidden(res, "Cannot remove the club founder");
    }

    await prisma.clubMember.delete({
      where: { clubId_userId: { clubId: id, userId } },
    });

    // Drop them from every club group + chat (Announcements included).
    await removeClubMemberFromClubChats(id, userId);

    // Update member count
    await prisma.club.update({
      where: { id },
      data: { memberCount: { decrement: 1 } },
    });

    ApiResponse.success(res, null, "Member removed successfully");
  }),
);

/**
 * Club moderation — make/remove admin, timed mute/suspend/ban, kick.
 * ADMIN/FOUNDER only. Enforced on the club's group chats + audit-logged.
 */
router.post(
  "/:id/members/:userId/moderation",
  validateParams(idParamSchema.extend({ userId: idParamSchema.shape.id })),
  validateBody(moderationBodySchema),
  requireClubMembership("ADMIN", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, userId } = req.params;
    const session = (req as any).session;
    const { action, expiresInMs, reason } = req.body as {
      action: ModerationAction;
      expiresInMs?: number;
      reason?: string;
    };

    try {
      const result = await applyModeration({
        clubId: id,
        actorId: session.user.id,
        actorName: session.user.name || "An admin",
        targetUserId: userId,
        action,
        expiresInMs,
        reason,
      });
      ApiResponse.success(res, result, "Moderation applied");
    } catch (e: any) {
      const msg = e?.message || "Moderation failed";
      const code =
        msg.includes("not found") ? 404 : msg.includes("founder") ? 403 : 400;
      ApiResponse.error(res, msg, code, ErrorCode.INVALID_INPUT);
    }
  }),
);

/** Moderation audit log (most recent first). ADMIN/FOUNDER only. */
router.get(
  "/:id/moderation",
  validateParams(idParamSchema),
  requireClubMembership("ADMIN", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const actions = await prisma.clubModerationAction.findMany({
      where: { clubId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const userIds = Array.from(
      new Set(actions.flatMap((a) => [a.targetUserId, a.actorId])),
    );
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, avatar: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    ApiResponse.success(res, {
      actions: actions.map((a) => ({
        ...a,
        target: byId.get(a.targetUserId) ?? null,
        actor: byId.get(a.actorId) ?? null,
      })),
    });
  }),
);

/**
 * Club-admin analytics: per-member activity (last interaction, last message,
 * message volume, moderation status) + community aggregates. ADMIN/FOUNDER
 * only — surfaced in the web club dashboard.
 */
router.get(
  "/:id/analytics",
  validateParams(idParamSchema),
  requireClubMembership("ADMIN", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const [members, groupCount, club] = await Promise.all([
      prisma.clubMember.findMany({
        where: { clubId: id },
        include: {
          user: {
            select: { id: true, name: true, avatar: true, email: true },
          },
        },
        orderBy: { lastInteractionAt: "desc" },
      }),
      prisma.friendGroup.count({ where: { clubId: id } }),
      prisma.club.findUnique({
        where: { id },
        select: { name: true, memberCount: true, createdAt: true },
      }),
    ]);

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const memberRows = members.map((m) => ({
      userId: m.userId,
      user: m.user,
      role: m.role,
      status: effectiveStatus(m),
      joinedAt: m.joinedAt,
      lastInteractionAt: m.lastInteractionAt,
      lastMessageAt: m.lastMessageAt,
      messageCount: m.messageCount,
    }));

    const activeWeek = memberRows.filter(
      (m) =>
        m.lastInteractionAt &&
        now - new Date(m.lastInteractionAt).getTime() < 7 * DAY,
    ).length;
    const activeToday = memberRows.filter(
      (m) =>
        m.lastInteractionAt &&
        now - new Date(m.lastInteractionAt).getTime() < DAY,
    ).length;
    const dormant = memberRows.filter(
      (m) =>
        !m.lastInteractionAt ||
        now - new Date(m.lastInteractionAt).getTime() > 30 * DAY,
    ).length;
    const totalMessages = memberRows.reduce(
      (a, m) => a + (m.messageCount || 0),
      0,
    );

    ApiResponse.success(res, {
      club: { name: club?.name, memberCount: club?.memberCount },
      summary: {
        totalMembers: memberRows.length,
        activeToday,
        activeWeek,
        dormant,
        totalMessages,
        groupCount,
        moderated: memberRows.filter((m) => m.status !== "ACTIVE").length,
      },
      members: memberRows,
    });
  }),
);

async function canManageClubGroup(
  clubId: string,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const [group, club] = await Promise.all([
    prisma.friendGroup.findFirst({
      where: { id: groupId, clubId },
      select: { creatorId: true },
    }),
    prisma.club.findUnique({
      where: { id: clubId },
      select: { ownerId: true },
    }),
  ]);

  if (!group) {
    return false;
  }

  if (group.creatorId === userId || club?.ownerId === userId) {
    return true;
  }

  const clubMembership = await prisma.clubMember.findUnique({
    where: {
      clubId_userId: {
        clubId,
        userId,
      },
    },
    select: { role: true },
  });

  return clubMembership?.role === "ADMIN" || clubMembership?.role === "FOUNDER";
}

router.get(
  "/:id/groups",
  validateParams(idParamSchema),
  requireClubMembership("MEMBER", "id"),
  validateQuery(clubGroupQuerySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const session = (req as any).session;
    const { page, limit, search } = req.query as any;
    const skip = (page - 1) * limit;

    // Lazy backfill: pre-existing clubs get their Announcements group on
    // first community open. Idempotent + best-effort.
    await ensureAnnouncementsGroup(id).catch((e) =>
      console.error("[clubs] announcements backfill failed:", e),
    );

    const where: any = { clubId: id };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [groups, total] = await Promise.all([
      prisma.friendGroup.findMany({
        where,
        include: {
          creator: {
            select: { id: true, name: true, avatar: true },
          },
          members: {
            include: {
              user: {
                select: { id: true, name: true, avatar: true },
              },
            },
            take: 8,
            orderBy: { joinedAt: "asc" },
          },
          joinRequests: {
            where: { userId: session.user.id },
            select: { status: true },
            take: 1,
          },
          _count: {
            select: {
              members: true,
              rides: true,
              joinRequests: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.friendGroup.count({ where }),
    ]);

    const chatSummaries = await getGroupChatSummaries(
      groups.map((g) => g.id),
      session.user.id,
    ).catch((e: unknown) => {
      console.error("[clubs] group chat summaries failed:", e);
      return {} as Record<string, any>;
    });

    const enriched = groups
      .map((group) => {
        const isMember = group.members.some(
          (member) => member.userId === session.user.id,
        );
        const requestStatus = group.joinRequests[0]?.status || null;
        const chat = chatSummaries[group.id] || null;

        return {
          ...group,
          isMember,
          requestStatus,
          conversationId: chat?.conversationId ?? group.conversationId ?? null,
          lastMessage: chat?.lastMessage ?? null,
          unreadCount: chat?.unreadCount ?? 0,
          isMuted: chat?.isMuted ?? false,
          disappearingPolicy: chat?.disappearingPolicy ?? "day_1",
        };
      })
      // Announcements always pins to the top of the community home.
      .sort((a, b) => {
        if (a.isAnnouncement && !b.isAnnouncement) return -1;
        if (!a.isAnnouncement && b.isAnnouncement) return 1;
        return 0;
      });

    ApiResponse.paginated(res, enriched, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

/**
 * Resolve (lazily creating + linking) the chat conversation for a club
 * group. This is what the mobile community home calls when a group is
 * tapped — it returns the Mongo conversationId to open straight into chat.
 */
router.get(
  "/:id/groups/:groupId/chat",
  validateParams(clubGroupParamsSchema),
  requireClubMembership("MEMBER", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, groupId } = req.params;
    const session = (req as any).session;

    const group = await prisma.friendGroup.findFirst({
      where: { id: groupId, clubId: id },
      select: { id: true, isAnnouncement: true },
    });
    if (!group) {
      return ApiResponse.notFound(res, "Club group not found");
    }

    const [membership, canManage] = await Promise.all([
      prisma.friendGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId: session.user.id } },
        select: { userId: true },
      }),
      canManageClubGroup(id, groupId, session.user.id),
    ]);

    if (!membership && !canManage) {
      return ApiResponse.forbidden(
        res,
        "Join this group to open its chat",
      );
    }

    const conversationId = await ensureGroupConversation(groupId);
    ApiResponse.success(res, { conversationId, groupId });
  }),
);

/** Group members list — any club member can view. */
router.get(
  "/:id/groups/:groupId/members",
  validateParams(clubGroupParamsSchema),
  requireClubMembership("MEMBER", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, groupId } = req.params;
    const session = (req as any).session;

    const group = await prisma.friendGroup.findFirst({
      where: { id: groupId, clubId: id },
      select: { id: true, creatorId: true },
    });
    if (!group) return ApiResponse.notFound(res, "Club group not found");

    const [members, canManage] = await Promise.all([
      prisma.friendGroupMember.findMany({
        where: { groupId },
        include: {
          user: { select: { id: true, name: true, avatar: true } },
        },
        orderBy: { joinedAt: "asc" },
      }),
      canManageClubGroup(id, groupId, session.user.id),
    ]);

    const enriched = members.map((m) => ({
      userId: m.userId,
      user: m.user,
      joinedAt: m.joinedAt,
      isCreator: m.userId === group.creatorId,
      role: m.userId === group.creatorId ? "OWNER" : "MEMBER",
    }));

    ApiResponse.success(res, { members: enriched, canManage });
  }),
);

/** Update a club group (admin / group creator). */
router.patch(
  "/:id/groups/:groupId",
  validateParams(clubGroupParamsSchema),
  requireClubMembership("MEMBER", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, groupId } = req.params;
    const session = (req as any).session;

    const canManage = await canManageClubGroup(id, groupId, session.user.id);
    if (!canManage) {
      return ApiResponse.forbidden(res, "Only group admins can edit this group");
    }

    const group = await prisma.friendGroup.findFirst({
      where: { id: groupId, clubId: id },
      select: { id: true, isAnnouncement: true },
    });
    if (!group) return ApiResponse.notFound(res, "Club group not found");

    const { name, description, image, joinApprovalRequired, postPolicy } =
      req.body as Record<string, unknown>;

    const updated = await prisma.friendGroup.update({
      where: { id: groupId },
      data: {
        ...(typeof name === "string" && name.trim() && { name: name.trim() }),
        ...(description !== undefined && {
          description: (description as string) || null,
        }),
        ...(image !== undefined && { image: (image as string) || null }),
        ...(joinApprovalRequired !== undefined && {
          joinApprovalRequired: !!joinApprovalRequired,
        }),
        // postPolicy is only meaningful for the announcements channel but is
        // safe to set on any group (defaults to ALL elsewhere).
        ...(typeof postPolicy === "string" &&
          ["ALL", "ADMINS_ONLY"].includes(postPolicy) && { postPolicy }),
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        _count: { select: { members: true, rides: true } },
      },
    });

    await syncGroupMetadata(groupId);
    ApiResponse.success(res, { group: updated }, "Group updated");
  }),
);

/** Delete a club group (admin / creator). Announcements can't be deleted. */
router.delete(
  "/:id/groups/:groupId",
  validateParams(clubGroupParamsSchema),
  requireClubMembership("MEMBER", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, groupId } = req.params;
    const session = (req as any).session;

    const canManage = await canManageClubGroup(id, groupId, session.user.id);
    if (!canManage) {
      return ApiResponse.forbidden(
        res,
        "Only group admins can delete this group",
      );
    }

    const group = await prisma.friendGroup.findFirst({
      where: { id: groupId, clubId: id },
      select: { id: true, isAnnouncement: true, conversationId: true },
    });
    if (!group) return ApiResponse.notFound(res, "Club group not found");
    if (group.isAnnouncement) {
      return ApiResponse.error(
        res,
        "The Announcements channel can't be deleted",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    await prisma.friendGroup.delete({ where: { id: groupId } });
    if (group.conversationId) {
      await archiveGroupConversation(group.conversationId).catch(() => {});
    }

    ApiResponse.success(res, null, "Group deleted");
  }),
);

/** Leave a club group (self). Can't leave the Announcements channel. */
router.delete(
  "/:id/groups/:groupId/members/me",
  validateParams(clubGroupParamsSchema),
  requireClubMembership("MEMBER", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, groupId } = req.params;
    const session = (req as any).session;

    const group = await prisma.friendGroup.findFirst({
      where: { id: groupId, clubId: id },
      select: { id: true, isAnnouncement: true, creatorId: true },
    });
    if (!group) return ApiResponse.notFound(res, "Club group not found");
    if (group.isAnnouncement) {
      return ApiResponse.error(
        res,
        "You can't leave the Announcements channel",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }
    if (group.creatorId === session.user.id) {
      return ApiResponse.error(
        res,
        "Group creators can't leave their own group — delete it instead",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    await prisma.friendGroupMember.deleteMany({
      where: { groupId, userId: session.user.id },
    });
    await removeGroupParticipant(groupId, session.user.id);
    await postGroupSystemMessage(
      groupId,
      `${session.user.name || "A rider"} left the group`,
    );

    ApiResponse.success(res, null, "Left group");
  }),
);

router.post(
  "/:id/groups",
  validateParams(idParamSchema),
  requireClubMembership("MEMBER", "id"),
  validateBody(createClubGroupSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const session = (req as any).session;
    const { name, description, image, joinApprovalRequired, memberIds } =
      req.body;

    const club = await prisma.club.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!club) {
      return ApiResponse.notFound(
        res,
        "Club not found",
        ErrorCode.CLUB_NOT_FOUND,
      );
    }

    const existingIds = new Set<string>([session.user.id]);
    for (const memberId of memberIds || []) {
      existingIds.add(memberId);
    }

    const normalizedMemberIds = Array.from(existingIds);

    const validClubMembers = await prisma.clubMember.findMany({
      where: {
        clubId: id,
        userId: { in: normalizedMemberIds },
      },
      select: { userId: true },
    });

    const validMemberIds = new Set(
      validClubMembers.map((entry) => entry.userId),
    );
    validMemberIds.add(session.user.id);

    const group = await prisma.friendGroup.create({
      data: {
        clubId: id,
        name,
        description,
        image,
        joinApprovalRequired,
        creatorId: session.user.id,
        members: {
          create: Array.from(validMemberIds).map((userId) => ({ userId })),
        },
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        members: {
          include: {
            user: { select: { id: true, name: true, avatar: true } },
          },
        },
        _count: { select: { members: true, rides: true } },
      },
    });

    // Mint + link this group's chat right away so the first tap opens
    // straight into a working conversation.
    let conversationId: string | null = null;
    try {
      conversationId = await ensureGroupConversation(group.id);
    } catch (e) {
      console.error("[clubs] group conversation bootstrap failed:", e);
    }

    const notifyTargets = group.members
      .map((member) => member.userId)
      .filter((userId) => userId !== session.user.id);

    await notifyUsers(notifyTargets, {
      type: "CLUB_INVITE",
      title: `New group in ${club.name}`,
      message: `${group.creator?.name || "A member"} created ${group.name}.`,
      relatedType: "club-group",
      relatedId: group.id,
    });

    ApiResponse.created(
      res,
      { group: { ...group, conversationId } },
      "Club group created successfully",
    );
  }),
);

router.post(
  "/:id/groups/:groupId/join",
  validateParams(clubGroupParamsSchema),
  requireClubMembership("MEMBER", "id"),
  validateBody(joinClubGroupSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, groupId } = req.params;
    const session = (req as any).session;

    const group = await prisma.friendGroup.findFirst({
      where: { id: groupId, clubId: id },
      select: {
        id: true,
        name: true,
        creatorId: true,
        joinApprovalRequired: true,
      },
    });

    if (!group) {
      return ApiResponse.notFound(res, "Club group not found");
    }

    const existingMembership = await prisma.friendGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId: session.user.id } },
    });

    if (existingMembership) {
      return ApiResponse.conflict(
        res,
        "You are already a member of this group",
      );
    }

    if (!group.joinApprovalRequired) {
      const membership = await prisma.friendGroupMember.create({
        data: {
          groupId,
          userId: session.user.id,
        },
      });

      await addGroupParticipant(groupId, session.user.id);
      await postGroupSystemMessage(
        groupId,
        `${session.user.name || "A rider"} joined the group`,
      );

      if (group.creatorId !== session.user.id) {
        await createNotification({
          userId: group.creatorId,
          type: "CLUB_INVITE",
          title: `New member in ${group.name}`,
          message: `${session.user.name || "A rider"} joined your group.`,
          relatedType: "club-group",
          relatedId: groupId,
        });
      }

      return ApiResponse.created(
        res,
        { membership },
        "Joined group successfully",
      );
    }

    const joinRequest = await prisma.friendGroupJoinRequest.upsert({
      where: { groupId_userId: { groupId, userId: session.user.id } },
      create: {
        groupId,
        userId: session.user.id,
        message: req.body.message || null,
        status: "PENDING",
      },
      update: {
        status: "PENDING",
        message: req.body.message || null,
      },
    });

    if (group.creatorId !== session.user.id) {
      await createNotification({
        userId: group.creatorId,
        type: "CLUB_REQUEST",
        title: `Join request for ${group.name}`,
        message: `${session.user.name || "A rider"} requested to join your group.`,
        relatedType: "club-group",
        relatedId: groupId,
      });
    }

    ApiResponse.created(
      res,
      { joinRequest },
      "Join request sent — waiting for group admin approval",
    );
  }),
);

router.delete(
  "/:id/groups/:groupId/join",
  validateParams(clubGroupParamsSchema),
  requireClubMembership("MEMBER", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { groupId } = req.params;
    const session = (req as any).session;

    const pending = await prisma.friendGroupJoinRequest.findUnique({
      where: { groupId_userId: { groupId, userId: session.user.id } },
      select: { id: true, status: true },
    });

    if (!pending || pending.status !== "PENDING") {
      return ApiResponse.notFound(res, "No pending join request found");
    }

    await prisma.friendGroupJoinRequest.delete({
      where: { id: pending.id },
    });

    ApiResponse.success(res, null, "Join request cancelled");
  }),
);

router.get(
  "/:id/groups/:groupId/requests",
  validateParams(clubGroupParamsSchema),
  requireClubMembership("MEMBER", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, groupId } = req.params;
    const session = (req as any).session;

    const canManage = await canManageClubGroup(id, groupId, session.user.id);
    if (!canManage) {
      return ApiResponse.forbidden(
        res,
        "Only group admins can view join requests",
      );
    }

    const requests = await prisma.friendGroupJoinRequest.findMany({
      where: {
        groupId,
        status: "PENDING",
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    ApiResponse.success(res, { requests });
  }),
);

router.post(
  "/:id/groups/:groupId/requests/:userId/approve",
  validateParams(clubGroupRequestParamsSchema),
  requireClubMembership("MEMBER", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, groupId, userId } = req.params;
    const session = (req as any).session;

    const canManage = await canManageClubGroup(id, groupId, session.user.id);
    if (!canManage) {
      return ApiResponse.forbidden(
        res,
        "Only group admins can approve requests",
      );
    }

    const request = await prisma.friendGroupJoinRequest.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (!request || request.status !== "PENDING") {
      return ApiResponse.notFound(res, "No pending join request found");
    }

    await prisma.friendGroupJoinRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED" },
    });

    await prisma.friendGroupMember.upsert({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
      create: {
        groupId,
        userId,
      },
      update: {},
    });

    await addGroupParticipant(groupId, userId);
    const approvedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    await postGroupSystemMessage(
      groupId,
      `${approvedUser?.name || "A rider"} joined the group`,
    );

    await createNotification({
      userId,
      type: "CLUB_INVITE",
      title: "Your group request was approved",
      message: `${session.user.name || "A group admin"} approved your request.`,
      relatedType: "club-group",
      relatedId: groupId,
    });

    ApiResponse.success(res, null, "Request approved");
  }),
);

router.post(
  "/:id/groups/:groupId/requests/:userId/reject",
  validateParams(clubGroupRequestParamsSchema),
  requireClubMembership("MEMBER", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, groupId, userId } = req.params;
    const session = (req as any).session;

    const canManage = await canManageClubGroup(id, groupId, session.user.id);
    if (!canManage) {
      return ApiResponse.forbidden(
        res,
        "Only group admins can reject requests",
      );
    }

    const request = await prisma.friendGroupJoinRequest.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId,
        },
      },
    });

    if (!request || request.status !== "PENDING") {
      return ApiResponse.notFound(res, "No pending join request found");
    }

    await prisma.friendGroupJoinRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED" },
    });

    await createNotification({
      userId,
      type: "CLUB_REQUEST",
      title: "Your group request was declined",
      message: `${session.user.name || "A group admin"} declined your request.`,
      relatedType: "club-group",
      relatedId: groupId,
    });

    ApiResponse.success(res, null, "Request rejected");
  }),
);

router.post(
  "/:id/groups/:groupId/rides",
  validateParams(clubGroupParamsSchema),
  requireClubMembership("MEMBER", "id"),
  validateBody(createClubGroupRideSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id, groupId } = req.params;
    const session = (req as any).session;

    const [group, membership] = await Promise.all([
      prisma.friendGroup.findFirst({
        where: { id: groupId, clubId: id },
        select: { id: true, name: true },
      }),
      prisma.friendGroupMember.findUnique({
        where: {
          groupId_userId: {
            groupId,
            userId: session.user.id,
          },
        },
        select: { id: true },
      }),
    ]);

    if (!group) {
      return ApiResponse.notFound(res, "Club group not found");
    }

    if (!membership) {
      return ApiResponse.forbidden(
        res,
        "You must join this group before creating rides",
      );
    }

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
      latitude,
      longitude,
    } = req.body;

    const ride = await prisma.ride.create({
      data: {
        title,
        description: description || null,
        startLocation,
        endLocation: endLocation || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        distance: distance ?? null,
        duration: duration ?? null,
        experienceLevel: experienceLevel || null,
        pace: pace || null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        creatorId: session.user.id,
        clubId: id,
        friendGroupId: groupId,
      },
      include: {
        creator: {
          select: { id: true, name: true, avatar: true },
        },
        _count: {
          select: { participants: true },
        },
      },
    });

    const groupMembers = await prisma.friendGroupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });

    if (groupMembers.length) {
      await prisma.rideParticipant.createMany({
        data: groupMembers.map((member) => ({
          rideId: ride.id,
          userId: member.userId,
          status: "ACCEPTED",
        })),
        skipDuplicates: true,
      });

      const notifyTargets = groupMembers
        .map((member) => member.userId)
        .filter((userId) => userId !== session.user.id);

      await notifyUsers(notifyTargets, {
        type: "RIDE_INVITE",
        title: `New ride in ${group.name}`,
        message: `${session.user.name || "A rider"} scheduled ${title}.`,
        relatedType: "ride",
        relatedId: ride.id,
      });
    }

    ApiResponse.created(res, { ride }, "Group ride created successfully");
  }),
);

/**
 * GET /clubs/:id/marketplace
 * Member-only: the club's own market — listings explicitly posted to this club
 * (both PUBLIC and CLUB_ONLY; members see everything), newest first.
 */
router.get(
  "/:id/marketplace",
  validateParams(idParamSchema),
  validateQuery(
    z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(50).default(20),
      category: z.string().optional(),
    }),
  ),
  requireClubMembership("MEMBER", "id"),
  asyncHandler(async (req: Request, res: Response) => {
    const { id: clubId } = req.params;
    const { page, limit, category } = req.query as any;
    const skip = (page - 1) * limit;

    // Listings posted INTO this club's market. visibility (PUBLIC | CLUB_ONLY)
    // only affects whether they ALSO appear in the global marketplace — members
    // of the club see both here.
    const where: any = { clubId, status: "ACTIVE" };
    if (category) where.category = category;

    const [listings, total] = await Promise.all([
      prisma.marketplaceListing.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
        include: { seller: { select: { id: true, name: true, avatar: true } } },
      }),
      prisma.marketplaceListing.count({ where }),
    ]);

    ApiResponse.paginated(res, listings, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  }),
);

export default router;
