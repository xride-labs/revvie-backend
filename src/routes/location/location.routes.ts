import { Router, Request, Response } from "express";
import { requireAuth } from "../../config/auth.js";
import {
  validateBody,
  validateParams,
  asyncHandler,
} from "../../middlewares/validation.js";
import { z } from "zod";
import { LocationService } from "../../services/location.service.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { requirePro, isUserPro } from "../../lib/subscription.js";
import { broadcastRiderLocation } from "../../lib/socket.js";
import prisma from "../../lib/prisma.js";

const router = Router();

// All location routes require authentication
router.use(requireAuth);

// Live location broadcasting is a Pro feature (see plan §8.2). Reading
// friends' locations stays free so non-Pro users still see the social map;
// only writing your own live location and managing share permissions is
// gated, since that's the actual product value (and battery cost).
const requireLiveLocationPro = requirePro("Live location sharing");

// ─── Validation Schemas ──────────────────────────────────────────────────────

const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
  accuracy: z.number().min(0).optional(),
  battery: z.number().min(0).max(100).optional(),
  isMoving: z.boolean().optional(),
  isOnRide: z.boolean().optional(),
  rideId: z.string().optional(),
});

const updateSettingsSchema = z.object({
  sharingEnabled: z.boolean().optional(),
  shareWithAll: z.boolean().optional(),
  ghostMode: z.boolean().optional(),
  expiresInMinutes: z.number().min(1).max(1440).optional(), // Max 24 hours
});

const setPermissionSchema = z.object({
  friendId: z.string(),
  canSee: z.boolean(),
  canSeeSpeed: z.boolean().optional(),
  canSeeBattery: z.boolean().optional(),
});

const ghostModeSchema = z.object({
  enabled: z.boolean(),
  durationMinutes: z.number().min(1).max(1440).optional(),
});

const friendIdParamSchema = z.object({
  friendId: z.string(),
});

const rideIdParamSchema = z.object({
  rideId: z.string(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/location:
 *   post:
 *     summary: Update current user's live location
 *     tags: [Location]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               altitude:
 *                 type: number
 *               heading:
 *                 type: number
 *               speed:
 *                 type: number
 *               accuracy:
 *                 type: number
 *               battery:
 *                 type: number
 *               isMoving:
 *                 type: boolean
 *               isOnRide:
 *                 type: boolean
 *               rideId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Location updated
 */
router.post(
  "/",
  validateBody(updateLocationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const { isOnRide, rideId, ...rest } = req.body;

    // Social friend-map live location sharing requires Revvie Pro,
    // but active ride tracking telemetry is permitted for all ride participants.
    if (!isOnRide || !rideId) {
      const hasPro = await isUserPro(userId);
      if (!hasPro) {
        return ApiResponse.forbidden(
          res,
          "Live location sharing requires Revvie Pro. Upgrade to unlock this feature.",
          ErrorCode.SUBSCRIPTION_REQUIRED,
        );
      }
    }

    await LocationService.updateLocation({
      userId,
      isOnRide,
      rideId,
      ...rest,
    });

    if (isOnRide && rideId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, avatar: true },
      });
      await broadcastRiderLocation({
        rideId,
        userId,
        name: user?.name || "Rider",
        avatar: user?.avatar,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        heading: req.body.heading,
        speed: req.body.speed,
        altitude: req.body.altitude,
        accuracy: req.body.accuracy,
        isMoving: req.body.isMoving,
      });
    }

    ApiResponse.success(res, null, "Location updated");
  }),
);

/**
 * @swagger
 * /api/location/settings:
 *   get:
 *     summary: Get location sharing settings
 *     tags: [Location]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sharing settings
 */
router.get(
  "/settings",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const settings = await LocationService.getSharingSettings(userId);
    ApiResponse.success(res, settings);
  }),
);

/**
 * @swagger
 * /api/location/settings:
 *   patch:
 *     summary: Update location sharing settings
 *     tags: [Location]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sharingEnabled:
 *                 type: boolean
 *               shareWithAll:
 *                 type: boolean
 *               ghostMode:
 *                 type: boolean
 *               expiresInMinutes:
 *                 type: number
 *     responses:
 *       200:
 *         description: Settings updated
 */
router.patch(
  "/settings",
  requireLiveLocationPro,
  validateBody(updateSettingsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const { expiresInMinutes, ...rest } = req.body;

    const expiresAt = expiresInMinutes
      ? new Date(Date.now() + expiresInMinutes * 60 * 1000)
      : undefined;

    await LocationService.updateSharingSettings(userId, {
      ...rest,
      expiresAt,
    });

    ApiResponse.success(res, null, "Settings updated");
  }),
);

/**
 * @swagger
 * /api/location/friends:
 *   get:
 *     summary: Get friend locations for map (Snapchat-style)
 *     tags: [Location]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of friend locations
 */
router.get(
  "/friends",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const locations = await LocationService.getFriendLocations(userId);
    ApiResponse.success(res, { friends: locations });
  }),
);

/**
 * @swagger
 * /api/location/friends/{friendId}:
 *   get:
 *     summary: Get a specific friend's location
 *     tags: [Location]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: friendId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Friend location
 *       404:
 *         description: Location not available
 */
router.get(
  "/friends/:friendId",
  validateParams(friendIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const { friendId } = req.params;

    const location = await LocationService.getFriendLocation(userId, friendId);

    if (!location) {
      return ApiResponse.notFound(res, "Location not available");
    }

    ApiResponse.success(res, location);
  }),
);

/**
 * @swagger
 * /api/location/permissions:
 *   get:
 *     summary: Get all location sharing permissions
 *     tags: [Location]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of permissions
 */
router.get(
  "/permissions",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const permissions = await LocationService.getAllPermissions(userId);
    ApiResponse.success(res, { permissions });
  }),
);

/**
 * @swagger
 * /api/location/permissions:
 *   post:
 *     summary: Set location sharing permission for a friend
 *     tags: [Location]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [friendId, canSee]
 *             properties:
 *               friendId:
 *                 type: string
 *               canSee:
 *                 type: boolean
 *               canSeeSpeed:
 *                 type: boolean
 *               canSeeBattery:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Permission updated
 */
router.post(
  "/permissions",
  requireLiveLocationPro,
  validateBody(setPermissionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;

    try {
      await LocationService.setFriendPermission(userId, req.body);
      ApiResponse.success(res, null, "Permission updated");
    } catch (err: any) {
      ApiResponse.error(res, err.message, 400);
    }
  }),
);

/**
 * @swagger
 * /api/location/ghost-mode:
 *   post:
 *     summary: Toggle ghost mode (hide from everyone)
 *     tags: [Location]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled]
 *             properties:
 *               enabled:
 *                 type: boolean
 *               durationMinutes:
 *                 type: number
 *     responses:
 *       200:
 *         description: Ghost mode toggled
 */
router.post(
  "/ghost-mode",
  requireLiveLocationPro,
  validateBody(ghostModeSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const { enabled, durationMinutes } = req.body;

    if (enabled) {
      await LocationService.enableGhostMode(userId, durationMinutes);
      ApiResponse.success(res, null, "Ghost mode enabled");
    } else {
      await LocationService.disableGhostMode(userId);
      ApiResponse.success(res, null, "Ghost mode disabled");
    }
  }),
);

/**
 * @swagger
 * /api/location/ride/{rideId}:
 *   get:
 *     summary: Get locations of ride participants
 *     tags: [Location]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rideId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Participant locations
 */
router.get(
  "/ride/:rideId",
  validateParams(rideIdParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).session?.user?.id;
    const { rideId } = req.params;

    try {
      const locations = await LocationService.getRideParticipantLocations(
        rideId,
        userId,
      );
      ApiResponse.success(res, { participants: locations });
    } catch (err: any) {
      ApiResponse.error(res, err.message, 400);
    }
  }),
);

export default router;
