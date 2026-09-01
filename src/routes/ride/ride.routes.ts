import { Request, Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { requireAuth } from "../../config/auth.js";
import { RideController } from "../../controllers/ride.controller.js";
import { requirePro } from "../../lib/subscription.js";
import {
    requireOwnershipOrAdmin
} from "../../middlewares/rbac.js";
import {
    asyncHandler,
    validateBody,
    validateParams,
    validateQuery,
} from "../../middlewares/validation.js";
import {
    createRideSchema,
    idParamSchema,
    joinRideSchema,
    rideQuerySchema,
    updateParticipantStatusSchema,
    updateRideSchema,
} from "../../validators/schemas.js";

const router = Router();

// All ride routes require authentication
router.use(requireAuth);

// Sentinel thrown inside the /:id/end transaction when the atomic claim
// (tx.ride.updateMany status guard) finds the ride was already completed by
// a concurrent request — lets the outer catch distinguish "lost the race,
// respond 409" from a genuine failure that should bubble to asyncHandler.
/**
 * @swagger
 * /api/rides:
 *   get:
 *     summary: Get all rides
 *     description: Retrieve a paginated list of rides with optional status filter
 *     tags: [Rides]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PLANNED, IN_PROGRESS, COMPLETED, CANCELLED]
 *         description: Filter by ride status
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by title, description or start location
 *       - in: query
 *         name: experienceLevel
 *         schema:
 *           type: string
 *           enum: [BEGINNER, INTERMEDIATE, ADVANCED, EXPERT]
 *         description: Filter by experience level
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter rides scheduled on or after this date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter rides scheduled on or before this date
 *     responses:
 *       200:
 *         description: List of rides
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rides:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Ride'
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
/**
 * GET /api/rides/mine — the authenticated user's own rides, with the per-ride
 * RideSummary snapshot attached so the mobile profile carousel can render a
 * map preview + distance/time/score without a second fetch.
 *
 * Defaults to `status=COMPLETED` because the carousel is "past rides". Pass
 * `status=all` to get everything (used by the full-list screen).
 */
router.get("/mine", asyncHandler(RideController.getMyRides));

router.get(
  "/",
  validateQuery(rideQuerySchema),
  asyncHandler(RideController.getRides)
);

/**
 * @swagger
 * /api/rides/{id}:
 *   get:
 *     summary: Get ride by ID
 *     description: Retrieve a single ride by its unique identifier
 *     tags: [Rides]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Ride ID
 *     responses:
 *       200:
 *         description: Ride details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ride:
 *                   $ref: '#/components/schemas/Ride'
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
  asyncHandler(RideController.getRideById)
);

/**
 * @swagger
 * /api/rides:
 *   post:
 *     summary: Create a new ride
 *     description: Create a new ride with the provided details
 *     tags: [Rides]
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
 *               - title
 *               - startLocation
 *             properties:
 *               title:
 *                 type: string
 *                 example: Morning Coastal Ride
 *               description:
 *                 type: string
 *                 example: A beautiful morning ride along the coast
 *               startLocation:
 *                 type: string
 *                 example: San Francisco, CA
 *               endLocation:
 *                 type: string
 *                 example: Half Moon Bay, CA
 *               distance:
 *                 type: number
 *                 example: 45.5
 *               duration:
 *                 type: integer
 *                 description: Duration in minutes
 *                 example: 120
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Ride created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Ride created successfully
 *                 ride:
 *                   $ref: '#/components/schemas/Ride'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  "/",
  validateBody(createRideSchema),
  asyncHandler(RideController.getMine),
);

/**
 * @swagger
 * /api/rides/{id}:
 *   patch:
 *     summary: Update a ride
 *     description: Update ride details. Must be the ride creator or admin.
 *     tags: [Rides]
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
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               startLocation:
 *                 type: string
 *               endLocation:
 *                 type: string
 *               distance:
 *                 type: number
 *               duration:
 *                 type: integer
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Ride updated successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not ride owner or admin
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch(
  "/:id",
  validateParams(idParamSchema),
  validateBody(updateRideSchema),
  requireOwnershipOrAdmin("ride"),
  asyncHandler(RideController.patchById),
);

/**
 * @swagger
 * /api/rides/{id}:
 *   delete:
 *     summary: Delete a ride
 *     description: Delete a ride. Must be the ride creator or admin.
 *     tags: [Rides]
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
 *         description: Ride deleted successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not ride owner or admin
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  "/:id",
  validateParams(idParamSchema),
  requireOwnershipOrAdmin("ride"),
  asyncHandler(RideController.deleteById),
);

/**
 * @swagger
 * /api/rides/{id}/join:
 *   post:
 *     summary: Request to join a ride
 *     description: Request to join a ride as a participant. Creates a REQUESTED status that needs to be approved by the ride creator.
 *     tags: [Rides]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Ride ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *                 description: Optional message to ride creator
 *     responses:
 *       201:
 *         description: Join request submitted
 *       400:
 *         description: Ride already started or ended
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Already requested to join
 */
router.post(
  "/:id/join",
  validateParams(idParamSchema),
  validateBody(joinRideSchema),
  asyncHandler(RideController.postByIdJoin),
);

/**
 * @swagger
 * /api/rides/{id}/participants/{userId}:
 *   patch:
 *     summary: Update participant status
 *     description: Accept or decline a ride join request. Must be ride creator or admin.
 *     tags: [Rides]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Ride ID
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: Participant user ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [ACCEPTED, DECLINED, CANCELLED]
 *     responses:
 *       200:
 *         description: Participant status updated
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Not ride owner or admin
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch(
  "/:id/participants/:userId",
  validateParams(idParamSchema.extend({ userId: idParamSchema.shape.id })),
  validateBody(updateParticipantStatusSchema),
  requireOwnershipOrAdmin("ride"),
  asyncHandler(RideController.patchByIdParticipantsByUserId),
);

/**
 * @swagger
 * /api/rides/{id}/leave:
 *   delete:
 *     summary: Leave a ride
 *     description: Leave a ride you have joined.
 *     tags: [Rides]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Ride ID
 *     responses:
 *       200:
 *         description: Left ride successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Not a participant in this ride
 */
router.delete(
  "/:id/leave",
  validateParams(idParamSchema),
  asyncHandler(RideController.deleteByIdLeave),
);

/**
 * @swagger
 * /api/rides/{id}/tracking:
 *   post:
 *     summary: Upsert ride tracking metrics
 *     description: Stores or updates ride tracking data. Elevation gain is calculated server-side from route coordinates if not explicitly provided.
 *     tags: [Rides]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Ride ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               actualStartTime:
 *                 type: string
 *                 format: date-time
 *               actualEndTime:
 *                 type: string
 *                 format: date-time
 *               totalDurationMin:
 *                 type: integer
 *               totalDistanceKm:
 *                 type: number
 *               maxSpeedKmh:
 *                 type: number
 *               avgSpeedKmh:
 *                 type: number
 *               elevationGainM:
 *                 type: number
 *               routeGeoJson:
 *                 type: string
 *                 description: GeoJSON LineString payload as string
 *     responses:
 *       200:
 *         description: Tracking data saved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Only creator/admin/participant can update tracking
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post(
  "/:id/tracking",
  validateParams(idParamSchema),
  validateBody(
    z.object({
      actualStartTime: z.string().datetime().optional().nullable(),
      actualEndTime: z.string().datetime().optional().nullable(),
      totalDurationMin: z.number().int().min(0).optional(),
      totalDistanceKm: z.number().min(0).optional(),
      maxSpeedKmh: z.number().min(0).optional(),
      avgSpeedKmh: z.number().min(0).optional(),
      elevationGainM: z.number().min(0).optional().nullable(),
      routeGeoJson: z.string().optional().nullable(),
      weatherNotes: z.string().max(500).optional(),
      riderNotes: z.string().max(5000).optional(),
      conditions: z.string().max(200).optional(),
    }),
  ),
  asyncHandler(RideController.postByIdTracking),
);

/**
 * @swagger
 * /api/rides/{id}/end:
 *   post:
 *     summary: End a ride atomically
 *     description: |
 *       Single source of truth for completing a ride. In one transaction:
 *       closes any open break, upserts tracking data, computes the post-ride
 *       summary (effective duration excludes breaks/detours), transitions
 *       Ride.status to COMPLETED, and emits `ride-completed` to all sockets in
 *       the ride room. Replaces the legacy split between `PATCH /rides/:id`
 *       (status) and `POST /rides/:id/tracking` (metrics).
 *     tags: [Rides]
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
 *         description: Ride ended; returns ride, tracking data, and summary
 *       403:
 *         description: Only the ride creator can end the ride
 *       409:
 *         description: Ride is already completed or cancelled
 */
router.post(
  "/:id/end",
  validateParams(idParamSchema),
  validateBody(
    z.object({
      actualStartTime: z.string().datetime().optional().nullable(),
      actualEndTime: z.string().datetime().optional().nullable(),
      totalDistanceKm: z.number().min(0).optional(),
      maxSpeedKmh: z.number().min(0).optional(),
      avgSpeedKmh: z.number().min(0).optional(),
      elevationGainM: z.number().min(0).optional().nullable(),
      routeGeoJson: z.string().optional().nullable(),
      endedReason: z.enum(["USER_ENDED", "TIMEOUT", "EMERGENCY"]).optional(),
      riderNotes: z.string().max(5000).optional(),
      // Auto-idle time the client detected (rider stationary without
      // manually pressing pause). We prefer this over the break-derived
      // idleTimeSec when present, because the client has the real
      // stationary signal; the server would only know that no break was
      // logged at all.
      clientIdleSec: z.number().int().min(0).max(86_400).optional(),
    }),
  ),
  asyncHandler(RideController.postByIdEnd),
);

/**
 * @swagger
 * /api/rides/{id}/invite:
 *   post:
 *     summary: Invite users to a ride
 *     description: Send invitations to multiple users for a specific ride. Only the ride creator can invite. Creates REQUESTED RideParticipant records and sends Notifications.
 *     tags: [Rides]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Ride ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userIds
 *             properties:
 *               userIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of user IDs to invite
 *               message:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional custom invitation message
 *     responses:
 *       200:
 *         description: Invitations sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 invitations:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/RideParticipant'
 *                 notificationsSent:
 *                   type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Only ride creator can send invitations
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post(
  "/:id/invite",
  validateParams(idParamSchema),
  validateBody(
    z.object({
      userIds: z.array(z.string()).min(1).max(50),
      message: z.string().max(500).optional(),
      // When true, the organiser is *adding* people directly rather than
      // inviting them — recipients land as ACCEPTED participants and skip
      // the approval queue. Default false preserves the existing invite UX
      // for friend-to-friend invites.
      directAdd: z.boolean().optional(),
    }),
  ),
  asyncHandler(RideController.postByIdInvite),
);

// ─── Ride Lifecycle: Start ───────────────────────────────────────────────────
// Explicit "begin now" transition. Without this, a PLANNED ride only ever
// became IN_PROGRESS via the 15-minute updateRideStatuses cron job
// (src/jobs/scheduler.ts) once scheduledAt passed — fine for a ride
// scheduled well ahead of time, but it meant tapping "Start Live Ride"
// (mobile) didn't actually start anything: every telemetry route silently
// no-ops on a non-IN_PROGRESS ride (see the `ignored: true` branches below),
// so a quick/solo ride's location would go nowhere for up to 15 minutes.

router.post(
  "/:id/start",
  validateParams(idParamSchema),
  asyncHandler(RideController.postByIdStart),
);

// ─── Ride Lifecycle: Pause / Resume ─────────────────────────────────────────

router.post(
  "/:id/pause",
  validateParams(idParamSchema),
  asyncHandler(RideController.postByIdPause),
);

router.post(
  "/:id/resume",
  validateParams(idParamSchema),
  asyncHandler(RideController.postByIdResume),
);

// ─── Group Ride Lead ─────────────────────────────────────────────────────────
// A ride's lead is the rider other participants see distinguished on the
// live map. Nullable single FK on Ride (see schema.prisma) rather than a
// per-participant role — a ride only ever has one lead at a time. Unset
// (leadUserId: null) means the API/clients should treat the creator as the
// de-facto lead, so this endpoint both assigns and clears it.

const setRideLeadSchema = z.object({
  userId: z.string().min(1).nullable(),
});

router.post(
  "/:id/lead",
  validateParams(idParamSchema),
  validateBody(setRideLeadSchema),
  asyncHandler(RideController.postByIdLead),
);

// ─── Ride Lifecycle: Breaks ──────────────────────────────────────────────────

const breakTypeValues = ["REST", "FUEL", "FOOD", "PHOTO", "REPAIR", "EMERGENCY", "OTHER"] as const;

router.post(
  "/:id/breaks",
  validateParams(idParamSchema),
  validateBody(
    z.object({
      type: z.enum(breakTypeValues).optional().default("REST"),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      notes: z.string().max(500).optional(),
    }),
  ),
  asyncHandler(RideController.postByIdBreaks),
);

router.patch(
  "/:id/breaks/:breakId/end",
  validateParams(idParamSchema.extend({ breakId: z.string() })),
  asyncHandler(RideController.patchByIdBreaksByBreakIdEnd),
);

// ─── Ride Lifecycle: Detours ─────────────────────────────────────────────────

router.post(
  "/:id/detours",
  validateParams(idParamSchema),
  validateBody(
    z.object({
      label: z.string().max(200).optional(),
      latitude: z.number(),
      longitude: z.number(),
      distanceAddedKm: z.number().min(0).optional(),
      durationAddedMin: z.number().int().min(0).optional(),
    }),
  ),
  asyncHandler(RideController.postByIdDetours),
);

// ─── Ride Stats (post-ride summary) ─────────────────────────────────────────

router.get(
  "/:id/stats",
  validateParams(idParamSchema),
  asyncHandler(RideController.getByIdStats),
);

/**
 * GPX export — Pro-only. Reads the recorded route from RideTrackingData
 * (stored as GeoJSON LineString) and converts it to GPX 1.1 XML so the
 * user can import the ride into Strava, Komoot, RideWithGPS, etc.
 *
 * Returns text/xml so the mobile client can save it directly via the
 * Sharing API. The participant check ensures private rides aren't
 * scrape-able by anyone with a ride ID.
 */
router.get(
  "/:id/export.gpx",
  validateParams(idParamSchema),
  requirePro("GPX export"),
  asyncHandler(RideController.getByIdExportGpx),
);

// The blanket IP-keyed apiLimiter in server.ts is the only rate limit
// telemetry had before this — every rider on a shared IP/NAT shared one
// bucket, which both under-protects the server (one rider can't be
// individually throttled) and makes multi-rider load-testing from a single
// machine trip the limit immediately. These are keyed per participant per
// ride instead.
const isProduction = process.env.NODE_ENV === "production";

const telemetryLimiter = rateLimit({
  windowMs: 60 * 1000,
  // Real cadence is ~15-20 pings/min per rider (foreground + background
  // tracking combined) — 30/min leaves headroom without opening the door to
  // a runaway client hammering the endpoint.
  max: isProduction ? 30 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const userId = (req as any).session?.user?.id;
    // These routes sit behind requireAuth, so userId is present in
    // practice — the IP fallback only matters defensively, but
    // express-rate-limit requires IPv6 addresses go through its own
    // normalization helper rather than being used raw as a key.
    const idPart = userId || ipKeyGenerator(req.ip ?? "");
    return `${idPart}:${req.params.id}`;
  },
  message: {
    error: { code: "RATE_LIMITED", message: "Too many telemetry updates. Slow down." },
  },
});

const telemetryBatchLimiter = rateLimit({
  windowMs: 60 * 1000,
  // Batch calls are inherently bursty (queued offline pings flushed at
  // once) — allow a handful per minute rather than per-ping cadence.
  max: isProduction ? 6 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const userId = (req as any).session?.user?.id;
    // These routes sit behind requireAuth, so userId is present in
    // practice — the IP fallback only matters defensively, but
    // express-rate-limit requires IPv6 addresses go through its own
    // normalization helper rather than being used raw as a key.
    const idPart = userId || ipKeyGenerator(req.ip ?? "");
    return `${idPart}:${req.params.id}`;
  },
  message: {
    error: { code: "RATE_LIMITED", message: "Too many telemetry batches. Slow down." },
  },
});

const rideTelemetrySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional().nullable(),
  // CLLocation/expo-location legitimately report -1 for "heading/speed
  // unavailable" (not an error state, just no fix yet) — accept it as the
  // sentinel it is and normalize to null, rather than rejecting the whole
  // ping with a 400. It used to be silently lost forever: the client would
  // queue-and-retry a rejected ping, which fails identically every time.
  heading: z
    .number()
    .min(-1)
    .max(360)
    .optional()
    .nullable()
    .transform((v) => (v === -1 ? null : v)),
  speed: z
    .number()
    .min(-1)
    .optional()
    .nullable()
    .transform((v) => (v === -1 ? null : v)),
  accuracy: z.number().min(0).optional().nullable(),
  battery: z.number().min(0).max(100).optional().nullable(),
  isMoving: z.boolean().optional(),
  capturedAt: z.number().optional().nullable(),
});

const rideTelemetryBatchSchema = z.object({
  pings: z.array(rideTelemetrySchema).min(1).max(200),
});

/**
 * @swagger
 * /api/rides/{id}/telemetry:
 *   post:
 *     summary: Ingest real-time GPS telemetry from active ride participant
 *     tags: [Rides]
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
 *               capturedAt:
 *                 type: number
 *     responses:
 *       200:
 *         description: Telemetry recorded and broadcasted
 */
router.post(
  "/:id/telemetry",
  telemetryLimiter,
  validateParams(idParamSchema),
  validateBody(rideTelemetrySchema),
  asyncHandler(RideController.postByIdTelemetry),
);

/**
 * @swagger
 * /api/rides/{id}/telemetry/batch:
 *   post:
 *     summary: Ingest queued offline GPS telemetry pings from active ride participant
 *     tags: [Rides]
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
 *             required: [pings]
 *             properties:
 *               pings:
 *                 type: array
 *     responses:
 *       200:
 *         description: Batch telemetry processed
 */
router.post(
  "/:id/telemetry/batch",
  telemetryBatchLimiter,
  validateParams(idParamSchema),
  validateBody(rideTelemetryBatchSchema),
  asyncHandler(RideController.postByIdTelemetryBatch),
);

export default router;
