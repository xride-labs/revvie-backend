import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import prisma from "../../lib/prisma.js";
import { auth, requireAuth } from "../../config/auth.js";
import { fromNodeHeaders } from "better-auth/node";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { validateBody, asyncHandler } from "../../middlewares/validation.js";
import { getCurrentBillingSubscription } from "../../lib/subscription.js";
import {
  updateProfileSchema,
  updatePreferencesSchema,
  verifyEmailSchema,
} from "../../validators/schemas.js";
import { z } from "zod";
import { invalidatePushPrefCache } from "../../lib/notifications.js";

const router = Router();

// Suppress verbose auth logs in production (these contain emails and user IDs)
const devLog: typeof console.log =
  process.env.NODE_ENV === "production" ? () => {} : console.log;

// Change password schema (local to this file)
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

// Emergency contact schemas — used by GET/POST/PATCH/DELETE under
// /api/account/emergency-contacts. Phone is the only hard requirement so
// the SOS flow always has something to dial; everything else is optional.
const emergencyContactBodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().min(5, "Phone is required").max(30),
  relationship: z.string().trim().max(60).optional(),
  isPrimary: z.boolean().optional(),
});
const emergencyContactUpdateSchema = emergencyContactBodySchema.partial();

/**
 * Mobile OAuth callback — converts the web session cookie into a redirect with a bearer token.
 * Better Auth social login redirects here after success; we read the session from the cookie
 * and redirect to the mobile deep link with the token in the URL fragment.
 */
router.get(
  "/oauth/mobile-callback",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });

      if (!session?.session?.token) {
        return res.redirect("revvie://auth/callback?error=no_session");
      }

      // Ensure RIDER role exists for the user (may be a brand new Google signup)
      await prisma.userRoleAssignment.upsert({
        where: { userId_role: { userId: session.user.id, role: "RIDER" } },
        create: { userId: session.user.id, role: "RIDER" },
        update: {},
      });

      const token = session.session.token;
      const userName = encodeURIComponent(session.user.name || "");
      const userEmail = encodeURIComponent(session.user.email || "");
      const userId = session.user.id;

      return res.redirect(
        `revvie://auth/callback?token=${token}&userId=${userId}&name=${userName}&email=${userEmail}`,
      );
    } catch (error) {
      console.error("[AUTH] Mobile OAuth callback error:", error);
      return res.redirect("revvie://auth/callback?error=auth_failed");
    }
  }),
);

/**
 * @swagger
 * /api/account/verify-email:
 *   post:
 *     summary: Verify email address
 *     description: |
 *       Confirms email ownership using the verification token sent during registration.
 *       Use this before attempting sign-in if email verification is enabled.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - token
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               token:
 *                 type: string
 *                 example: 1a2b3c4d5e6f...
 *     responses:
 *       200:
 *         description: Email verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Email verified successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 */
router.post(
  "/verify-email",
  validateBody(verifyEmailSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, token } = req.body;
    devLog("[AUTH] POST /verify-email", { email });

    // Better Auth uses JWT tokens for email verification (signed with BETTER_AUTH_SECRET).
    // Decode and verify the JWT instead of looking up a DB record.
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      console.error("[AUTH] BETTER_AUTH_SECRET is not set");
      return ApiResponse.error(
        res,
        "Server configuration error",
        500,
        ErrorCode.INTERNAL_ERROR,
      );
    }

    let decoded: { email?: string };
    try {
      decoded = jwt.verify(token, secret) as { email?: string };
    } catch (err: any) {
      console.warn(
        "[AUTH] Verify-email - JWT verification failed:",
        err.message,
      );
      return ApiResponse.error(
        res,
        "Invalid or expired verification token",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    // Ensure the email in the JWT matches the email in the request body
    if (decoded.email !== email) {
      console.warn("[AUTH] Verify-email - Email mismatch", {
        tokenEmail: decoded.email,
        bodyEmail: email,
      });
      return ApiResponse.error(
        res,
        "Token does not match the provided email",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return ApiResponse.error(res, "User not found", 404, ErrorCode.NOT_FOUND);
    }

    if (user.emailVerified) {
      return ApiResponse.success(res, null, "Email is already verified");
    }

    await prisma.user.update({
      where: { email },
      data: { emailVerified: true },
    });
    devLog("[AUTH] Verify-email - User updated", { email });

    ApiResponse.success(res, null, "Email verified successfully");
  }),
);

/**
 * @swagger
 * /api/account/me:
 *   get:
 *     summary: Get current authenticated user
 *     description: Returns the authenticated user and role assignments.
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    devLog("[AUTH] GET /me", { userId: session.user.id });

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
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

    const roles = user.userRoles?.map((r) => r.role) ?? [];
    const subscription = await getCurrentBillingSubscription(user.id);
    const xpPoints = user.xpPoints ?? 0;
    const nextLevelXp = (user.level + 1) * 250;
    const progressPercent = nextLevelXp
      ? Math.min(100, Math.round((xpPoints / nextLevelXp) * 100))
      : 0;
    const friendsCount =
      (user._count?.friendsInitiated ?? 0) +
      (user._count?.friendsReceived ?? 0);

    const response = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      onboardingCompleted: user.onboardingCompleted,
      dob: user.dob,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      phone: user.phone,
      subscriptionTier: user.subscriptionTier,
      subscriptionStatus: subscription?.status || null,
      subscriptionPlan: subscription?.plan || null,
      subscriptionCurrentPeriodEnd: subscription?.currentPeriodEnd || null,
      subscriptionCancelAt: subscription?.cancelAt || null,
      dodoCustomerId: subscription?.providerCustomerId || null,
      subscriptionId: subscription?.providerSubscriptionId || null,
      coverImage: user.coverImage,
      avatar: user.avatar,
      bio: user.bio,
      location: user.location,
      bloodType: user.bloodType,
      ridesCompleted: user.rideStats?.totalRides ?? 0,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roles,
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
        user.bikes?.map((bike) => ({
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
        user.clubMemberships?.map((membership) => ({
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
        user.badges?.map((userBadge) => ({
          id: userBadge.badge.id,
          title: userBadge.badge.title,
          auraPoints: userBadge.badge.auraPoints,
          icon: userBadge.badge.icon,
          earnedAt: userBadge.earnedAt,
        })) ?? [],
      social: {
        followers: user._count?.followers ?? 0,
        following: user._count?.following ?? 0,
        friends: friendsCount,
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
    devLog("[AUTH] GET /me - Returning user", {
      userId: user.id,
      roles: response.roles,
    });

    ApiResponse.success(res, { user: response });
  }),
);

router.get(
  "/preferences",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;

    const preferences = await prisma.userPreferences.findUnique({
      where: { userId: session.user.id },
    });

    ApiResponse.success(res, {
      preferences:
        preferences ||
        ({
          rideReminders: true,
          serviceReminderKm: 3000,
          darkMode: false,
          units: "metric",
          openToInvite: true,
          pushNotifications: true,
          emailNotifications: true,
          smsNotifications: false,
          profileVisibility: "public",
          allowDMsFrom: "everyone",
          allowFriendRequestsFrom: "everyone",
          showLocation: true,
          showBikes: true,
          showStats: true,
          notifyRides: true,
          notifyClubs: true,
          notifyMarketplace: true,
          notifySocial: true,
        } as const),
    });
  }),
);

router.patch(
  "/preferences",
  requireAuth,
  validateBody(updatePreferencesSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;

    const preferences = await prisma.userPreferences.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        ...req.body,
      },
      update: {
        ...req.body,
      },
    });

    // If pushNotifications changed, drop the cached value immediately so the
    // next notification respects the new preference without waiting 60 s.
    if ("pushNotifications" in req.body) {
      invalidatePushPrefCache(session.user.id);
    }

    ApiResponse.success(
      res,
      { preferences },
      "Preferences updated successfully",
    );
  }),
);

/**
 * @swagger
 * /api/account/me:
 *   patch:
 *     summary: Update current user profile
 *     description: Updates profile fields for the authenticated user.
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
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
 *               bikeType:
 *                 type: string
 *               bikeOwned:
 *                 type: string
 *               experienceLevel:
 *                 type: string
 *               levelOfActivity:
 *                 type: string
 *               bloodType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.patch(
  "/me",
  requireAuth,
  validateBody(updateProfileSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    devLog("[AUTH] PATCH /me", {
      userId: session.user.id,
      fields: Object.keys(req.body),
    });
    const {
      name,
      username,
      bio,
      location,
      dob,
      bloodType,
      avatar,
      coverImage,
      interests,
      activityLevel,
      level,
      onboardingCompleted,
      ghostModeEnabled,
      socialLinks,
    } = req.body;

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        ...(name !== undefined && { name }),
        ...(username !== undefined && { username }),
        ...(bio !== undefined && { bio }),
        ...(location !== undefined && { location }),
        ...(dob !== undefined && { dob: new Date(dob) }),
        ...(bloodType !== undefined && { bloodType }),
        ...(avatar !== undefined && { avatar }),
        ...(coverImage !== undefined && { coverImage }),
        ...(interests !== undefined && { interests }),
        ...(activityLevel !== undefined && { activityLevel }),
        ...(level !== undefined && { level }),
        ...(onboardingCompleted !== undefined && { onboardingCompleted }),
        ...(ghostModeEnabled !== undefined && { ghostModeEnabled, ghostModeSince: ghostModeEnabled ? new Date() : null }),
        ...(socialLinks !== undefined && { socialLinks }),
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        onboardingCompleted: true,
        avatar: true,
        coverImage: true,
        phone: true,
        bio: true,
        location: true,
        bloodType: true,
        dob: true,
        updatedAt: true,
      },
    });
    devLog("[AUTH] PATCH /me - Profile updated", { userId: user.id });

    ApiResponse.success(res, { user }, "Profile updated successfully");
  }),
);

/**
 * @swagger
 * /api/account/change-password:
 *   post:
 *     summary: Change user password
 *     description: Updates the password for the authenticated user.
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *               newPassword:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post(
  "/change-password",
  requireAuth,
  validateBody(changePasswordSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { currentPassword, newPassword } = req.body;
    devLog("[AUTH] POST /change-password", { userId: session.user.id });

    try {
      // Use Better Auth's built-in changePassword API
      // It verifies the current password and hashes the new one correctly
      await auth.api.changePassword({
        headers: fromNodeHeaders(req.headers),
        body: {
          currentPassword,
          newPassword,
          revokeOtherSessions: false,
        },
      });

      devLog("[AUTH] POST /change-password - Password updated", {
        userId: session.user.id,
      });

      ApiResponse.success(res, null, "Password changed successfully");
    } catch (error: any) {
      console.warn("[AUTH] POST /change-password - Failed", {
        userId: session.user.id,
        error: error.message,
      });
      return ApiResponse.error(
        res,
        error.body?.message || "Current password is incorrect",
        400,
        ErrorCode.INVALID_CREDENTIALS,
      );
    }
  }),
);

// Returns the current session enriched with DB-sourced roles.
// Used by the Next.js web app for SSR role checks.
router.get(
  "/session",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.success(res, (req as any).session);
  }),
);

// ─── Emergency Contacts ─────────────────────────────────────────────────────
// CRUD endpoints for the EmergencyContact model. Surfaced under /api/account
// (the model is per-user) so the mobile safety screen can manage them
// without going through admin routes.

router.get(
  "/emergency-contacts",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const items = await prisma.emergencyContact.findMany({
      where: { userId: session.user.id },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    ApiResponse.success(res, { items });
  }),
);

router.post(
  "/emergency-contacts",
  requireAuth,
  validateBody(emergencyContactBodySchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { name, phone, relationship, isPrimary } = req.body;

    // Only one primary contact per user — clear the flag on existing rows
    // before flipping a new one so the UI never shows two "primary" badges.
    if (isPrimary) {
      await prisma.emergencyContact.updateMany({
        where: { userId: session.user.id },
        data: { isPrimary: false },
      });
    }

    // If this is the user's first contact, default it to primary so the
    // SOS screen has a meaningful "call" target on day one.
    const existingCount = await prisma.emergencyContact.count({
      where: { userId: session.user.id },
    });
    const shouldBePrimary = isPrimary ?? existingCount === 0;

    const contact = await prisma.emergencyContact.create({
      data: {
        userId: session.user.id,
        name,
        phone,
        relationship: relationship || null,
        isPrimary: shouldBePrimary,
      },
    });
    ApiResponse.created(res, { contact }, "Emergency contact added");
  }),
);

router.patch(
  "/emergency-contacts/:id",
  requireAuth,
  validateBody(emergencyContactUpdateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;
    const { name, phone, relationship, isPrimary } = req.body;

    const existing = await prisma.emergencyContact.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!existing) {
      return ApiResponse.notFound(res, "Emergency contact not found");
    }

    if (isPrimary) {
      await prisma.emergencyContact.updateMany({
        where: { userId: session.user.id, id: { not: id } },
        data: { isPrimary: false },
      });
    }

    const contact = await prisma.emergencyContact.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(relationship !== undefined && { relationship: relationship || null }),
        ...(isPrimary !== undefined && { isPrimary }),
      },
    });
    ApiResponse.success(res, { contact }, "Emergency contact updated");
  }),
);

router.delete(
  "/emergency-contacts/:id",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { id } = req.params;

    const existing = await prisma.emergencyContact.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!existing) {
      return ApiResponse.notFound(res, "Emergency contact not found");
    }

    await prisma.emergencyContact.delete({ where: { id } });

    // If we just deleted the primary contact, promote the oldest remaining
    // one so SOS still has a target.
    if (existing.isPrimary) {
      const next = await prisma.emergencyContact.findFirst({
        where: { userId: session.user.id },
        orderBy: { createdAt: "asc" },
      });
      if (next) {
        await prisma.emergencyContact.update({
          where: { id: next.id },
          data: { isPrimary: true },
        });
      }
    }

    ApiResponse.success(res, null, "Emergency contact removed");
  }),
);

/**
 * Self-service account deletion — DPDP / GDPR right to erasure.
 *
 * Permanently removes the authenticated user. The schema's cascade rules
 * drop the user's owned records (sessions, accounts, rides they created,
 * clubs they own, listings, posts, etc.). This is irreversible; the client
 * gates it behind a typed "DELETE" confirmation.
 */
router.delete(
  "/me",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const userId = session.user.id as string;

    try {
      await prisma.user.delete({ where: { id: userId } });
    } catch (err) {
      // Surface a real failure rather than pretending the account is gone.
      return ApiResponse.error(
        res,
        "Could not fully delete the account. Please contact support.",
        500,
        ErrorCode.INTERNAL_ERROR,
      );
    }

    ApiResponse.success(res, null, "Account deleted");
  }),
);

// ========================================
// Account Bikes (Garage Alias)
// ========================================

router.get(
  "/bikes",
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
  "/bikes",
  requireAuth,
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
        year: bikeData.year ?? new Date().getFullYear(),
        userId: session.user.id,
      },
    });

    ApiResponse.created(res, bike, "Bike added to garage");
  }),
);

export default router;
