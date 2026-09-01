import { normalizeExperienceLevel, normalizePace } from "../lib/utils/rideEnums.js";
import { getIO, broadcastRiderLocation, broadcastRiderLocationBatch, getRideEventCounters, markRideCompleted, clearRideEventCounters } from "../lib/socket.js";

export class RideAlreadyEndedError extends Error {
  constructor() {
    super("Ride already ended");
    this.name = "RideAlreadyEndedError";
  }
}
import { Router, Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../config/auth.js";
import { ApiResponse, ErrorCode } from "../lib/utils/apiResponse.js";
import { sendRideJoinRequestEmail } from "../lib/mailer.js";
import { createNotification, notifyUsers } from "../lib/notifications.js";
import { ElevationService } from "../services/ride/elevation.service.js";
import { computeRideSummary, deriveEffectiveDurationSec } from "../services/ride/summary.service.js";
import { LocationService } from "../services/location/location.service.js";
import { rideToGpx } from "../lib/gpx.js";
import { awardBadgeByTitle, awardXp } from "../lib/xp.js";
import { isStaff } from "../lib/utils/permissions.js";
import { RideService } from "../services/ride/ride.service.js";

export class RideController {
  /**
   * Retrieves the authenticated user's own rides.
   * Defaults to status=COMPLETED. Pass status=all to get everything.
   */
  static async getMyRides(req: Request, res: Response) {
    const session = (req as any).session;
    const userId: string = session.user.id;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    const page = Math.max(1, Number(req.query.page) || 1);
    const statusFilter = (req.query.status as string | undefined) ?? "COMPLETED";

    const where: any = { creatorId: userId };
    if (statusFilter !== "all") where.status = statusFilter;

    const [rides, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          title: true,
          status: true,
          startLocation: true,
          endLocation: true,
          startLat: true,
          startLng: true,
          endLat: true,
          endLng: true,
          scheduledAt: true,
          endedAt: true,
          createdAt: true,
          keepPermanently: true,
          waypoints: true,
          trackingData: {
            select: { routeGeoJson: true, totalDistanceKm: true, maxSpeedKmh: true },
          },
          summary: {
            select: {
              totalDistanceKm: true,
              totalDurationSec: true,
              movingTimeSec: true,
              idleTimeSec: true,
              avgSpeedKmh: true,
              maxSpeedKmh: true,
              score: true,
              badges: true,
            },
          },
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
  }

  static async getRides(req: Request, res: Response) {
    const params = req.query as any;
    const data = await RideService.getRides(params);
    ApiResponse.paginated(res, data.rides, {
      page: params.page,
      limit: params.limit,
      total: data.total,
      totalPages: data.totalPages,
    });
  }

  static async getRideById(req: Request, res: Response) {
    const session = (req as any).session;
    const { id } = req.params;
    try {
      const data = await RideService.getRideById(id, session?.user?.id || null);
      ApiResponse.success(res, data);
    } catch (err: any) {
      if (err.message === "RIDE_NOT_FOUND") return ApiResponse.notFound(res, "Ride not found", "RIDE_NOT_FOUND");
      throw err;
    }
  }
  static async getMine(req: Request, res: Response) {

    const session = (req as any).session;
    const {
      title,
      description,
      startLocation,
      endLocation,
      experienceLevel,
      xpRequired,
      pace,
      distance,
      duration,
      scheduledAt,
      keepPermanently,
      startLat,
      startLng,
      endLat,
      endLng,
      latitude,
      longitude,
      waypoints,
      routeData,
      friendGroupId,
      privacyLevel,
    } = req.body;

    // The mobile client sends startLat/startLng (route origin). Mirror those
    // into latitude/longitude so the existing geo index + nearby-feed query
    // continues to work without a parallel code path.
    const resolvedLat = startLat ?? latitude;
    const resolvedLng = startLng ?? longitude;

    // routeData column is a String — JSON-stringify object/array payloads
    // (the mobile client sends the decoded geometry as an array of coords).
    const serializedRouteData =
      typeof routeData === "string"
        ? routeData
        : routeData != null
          ? JSON.stringify(routeData)
          : undefined;

    const ride = await prisma.ride.create({
      data: {
        title,
        description,
        startLocation,
        endLocation,
        // Canonicalize so discovery + admin filters (which key on the legacy
        // Title-cased values) keep matching rides created from mobile.
        experienceLevel: normalizeExperienceLevel(experienceLevel),
        xpRequired,
        pace: normalizePace(pace),
        distance,
        duration,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        keepPermanently: keepPermanently || false,
        creatorId: session.user.id,
        latitude: resolvedLat,
        longitude: resolvedLng,
        startLat: resolvedLat,
        startLng: resolvedLng,
        endLat,
        endLng,
        waypoints: waypoints ?? undefined,
        routeData: serializedRouteData,
        friendGroupId: friendGroupId ?? undefined,
        privacyLevel: privacyLevel ?? undefined,
      },
      include: {
        creator: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Automatically add creator as participant
    await prisma.rideParticipant.create({
      data: {
        rideId: ride.id,
        userId: session.user.id,
        status: "ACCEPTED",
      },
    });

    // Reward the creator with XP (best-effort — never fails the create flow).
    await awardXp(session.user.id, "RIDE_CREATED", `ride ${ride.id}`);

    ApiResponse.created(res, { ride }, "Ride created successfully");

  }

  static async patchById(req: Request, res: Response) {

    const { id } = req.params;
    const {
      title,
      description,
      startLocation,
      endLocation,
      experienceLevel,
      xpRequired,
      pace,
      distance,
      duration,
      scheduledAt,
      keepPermanently,
      startLat,
      startLng,
      endLat,
      endLng,
      latitude,
      longitude,
      waypoints,
      routeData,
    } = req.body;

    // Mirror startLat/startLng → latitude/longitude so the geo index stays in sync.
    const resolvedLat = startLat ?? latitude;
    const resolvedLng = startLng ?? longitude;

    const serializedRouteData =
      routeData === undefined
        ? undefined
        : typeof routeData === "string"
          ? routeData
          : routeData == null
            ? null
            : JSON.stringify(routeData);

    const ride = await prisma.ride.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(startLocation !== undefined && { startLocation }),
        ...(endLocation !== undefined && { endLocation }),
        ...(experienceLevel !== undefined && {
          experienceLevel: normalizeExperienceLevel(experienceLevel),
        }),
        ...(xpRequired !== undefined && { xpRequired }),
        ...(pace !== undefined && { pace: normalizePace(pace) }),
        ...(distance !== undefined && { distance }),
        ...(duration !== undefined && { duration }),
        ...(scheduledAt !== undefined && {
          scheduledAt: new Date(scheduledAt),
        }),
        ...(keepPermanently !== undefined && { keepPermanently }),
        ...(resolvedLat !== undefined && { latitude: resolvedLat, startLat: resolvedLat }),
        ...(resolvedLng !== undefined && { longitude: resolvedLng, startLng: resolvedLng }),
        ...(endLat !== undefined && { endLat }),
        ...(endLng !== undefined && { endLng }),
        ...(waypoints !== undefined && { waypoints }),
        ...(serializedRouteData !== undefined && { routeData: serializedRouteData }),
      },
      include: {
        creator: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    ApiResponse.success(res, { ride }, "Ride updated successfully");

  }

  static async deleteById(req: Request, res: Response) {

    const { id } = req.params;

    // Delete participants first
    await prisma.rideParticipant.deleteMany({
      where: { rideId: id },
    });

    await prisma.ride.delete({
      where: { id },
    });

    ApiResponse.success(res, null, "Ride deleted successfully");

  }

  static async postByIdJoin(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;

    const ride = await prisma.ride.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!ride) {
      return ApiResponse.notFound(
        res,
        "Ride not found",
        ErrorCode.RIDE_NOT_FOUND,
      );
    }

    if (ride.status !== "PLANNED") {
      return ApiResponse.error(
        res,
        "Cannot join a ride that has already started or ended",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    // Check if already a participant
    const existing = await prisma.rideParticipant.findUnique({
      where: { rideId_userId: { rideId: id, userId: session.user.id } },
    });

    if (existing) {
      return ApiResponse.conflict(
        res,
        "You have already requested to join this ride",
      );
    }

    const participant = await prisma.rideParticipant.create({
      data: {
        rideId: id,
        userId: session.user.id,
        status: "REQUESTED",
      },
      include: {
        user: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // XP for joining is granted on REQUEST (not on accept) so users get
    // immediate feedback even on private rides where the creator hasn't
    // approved yet. Reversing on decline is intentional churn we'll skip.
    await awardXp(session.user.id, "RIDE_JOINED", `ride ${id}`);

    // if (ride.creator?.email && ride.creator.id !== session.user.id) {
    //   const requesterName = participant.user?.name || "A rider";
    //   try {
    //     await sendRideJoinRequestEmail({
    //       to: ride.creator.email,
    //       rideTitle: ride.title,
    //       requesterName,
    //       message: req.body?.message,
    //     });
    //   } catch (error) {
    //     console.warn("[Email] Ride join request email failed:", error);
    //   }
    // }

    ApiResponse.created(res, { participant }, "Join request submitted");

  }

  static async patchByIdParticipantsByUserId(req: Request, res: Response) {

    const { id, userId } = req.params;
    const { status } = req.body;

    const participant = await prisma.rideParticipant.update({
      where: { rideId_userId: { rideId: id, userId } },
      data: { status },
      include: {
        user: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    ApiResponse.success(
      res,
      { participant },
      `Participant ${status.toLowerCase()}`,
    );

  }

  static async deleteByIdLeave(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;

    const participant = await prisma.rideParticipant.findUnique({
      where: { rideId_userId: { rideId: id, userId: session.user.id } },
    });

    if (!participant) {
      return ApiResponse.notFound(
        res,
        "You are not a participant in this ride",
      );
    }

    await prisma.rideParticipant.delete({
      where: { rideId_userId: { rideId: id, userId: session.user.id } },
    });

    ApiResponse.success(res, null, "Left ride successfully");

  }

  static async postByIdTracking(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;

    const ride = await prisma.ride.findUnique({
      where: { id },
      select: {
        id: true,
        creatorId: true,
        participants: {
          where: { userId: session.user.id },
          select: { status: true },
        },
      },
    });

    if (!ride) {
      return ApiResponse.notFound(
        res,
        "Ride not found",
        ErrorCode.RIDE_NOT_FOUND,
      );
    }

    const isCreator = ride.creatorId === session.user.id;
    const isAcceptedParticipant = ride.participants.some(
      (p: { status: string }) => p.status === "ACCEPTED",
    );

    if (!isCreator && !isAcceptedParticipant) {
      return ApiResponse.forbidden(
        res,
        "Only ride participants can update tracking",
      );
    }

    const resolvedElevationGain = ElevationService.resolveElevationGain({
      elevationGainM: req.body.elevationGainM,
      routeGeoJson: req.body.routeGeoJson,
    });

    const createData = {
      rideId: id,
      actualStartTime: req.body.actualStartTime
        ? new Date(req.body.actualStartTime)
        : null,
      actualEndTime: req.body.actualEndTime
        ? new Date(req.body.actualEndTime)
        : null,
      totalDurationMin: req.body.totalDurationMin,
      totalDistanceKm: req.body.totalDistanceKm,
      maxSpeedKmh: req.body.maxSpeedKmh,
      avgSpeedKmh: req.body.avgSpeedKmh,
      elevationGainM: resolvedElevationGain,
      routeGeoJson: req.body.routeGeoJson,
      weatherNotes: req.body.weatherNotes,
      riderNotes: req.body.riderNotes,
      conditions: req.body.conditions,
    };
    const updateFields = {
      actualStartTime: req.body.actualStartTime
        ? new Date(req.body.actualStartTime)
        : undefined,
      totalDurationMin: req.body.totalDurationMin,
      totalDistanceKm: req.body.totalDistanceKm,
      maxSpeedKmh: req.body.maxSpeedKmh,
      avgSpeedKmh: req.body.avgSpeedKmh,
      elevationGainM: resolvedElevationGain ?? undefined,
      routeGeoJson: req.body.routeGeoJson,
      weatherNotes: req.body.weatherNotes,
      riderNotes: req.body.riderNotes,
      conditions: req.body.conditions,
    };

    // "First time this ride's tracking record actually transitions from no
    // actualEndTime to having one" — NOT "does the stored value match what
    // we just sent," which is true again on every retry of the same upload
    // and previously re-triggered awardXp('RIDE_COMPLETED') on each one.
    let trackingData;
    let justFinished = false;
    try {
      // No row yet for this ride — this call itself is the only writer that
      // can create it (rideId is unique), so if it succeeds, this request
      // uniquely owns "first ever upload" for this ride.
      trackingData = await prisma.rideTrackingData.create({ data: createData });
      justFinished = Boolean(req.body.actualEndTime);
    } catch (err: any) {
      if (err?.code !== "P2002") throw err;
      if (req.body.actualEndTime) {
        // Atomic claim: only succeeds if actualEndTime is still unset,
        // so two concurrent uploads with the same end time can't both
        // "win" the transition.
        const claim = await prisma.rideTrackingData.updateMany({
          where: { rideId: id, actualEndTime: null },
          data: { ...updateFields, actualEndTime: new Date(req.body.actualEndTime) },
        });
        justFinished = claim.count === 1;
        if (!justFinished) {
          // Already had an end time (or lost the race) — plain idempotent
          // field update, no completion side-effects.
          await prisma.rideTrackingData.update({ where: { rideId: id }, data: updateFields });
        }
      } else {
        await prisma.rideTrackingData.update({ where: { rideId: id }, data: updateFields });
      }
      trackingData = await prisma.rideTrackingData.findUniqueOrThrow({ where: { rideId: id } });
    }

    if (justFinished) {
      await awardXp(session.user.id, "RIDE_COMPLETED", `ride ${id}`);

      const completedCount = await prisma.rideParticipant.count({
        where: { userId: session.user.id, status: "ACCEPTED" },
      });
      if (completedCount === 1) {
        await awardBadgeByTitle(session.user.id, "First Ride");
      }
    }

    ApiResponse.success(res, {
      trackingData,
      elevationComputed: req.body.elevationGainM == null,
    });

  }

  static async postByIdEnd(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;
    const userId: string = session.user.id;
    const clientIdleSec: number | undefined = req.body.clientIdleSec;

    const ride = await prisma.ride.findUnique({
      where: { id },
      select: { id: true, creatorId: true, status: true },
    });

    if (!ride) {
      return ApiResponse.notFound(res, "Ride not found", ErrorCode.RIDE_NOT_FOUND);
    }

    if (
      ride.creatorId !== userId &&
      !isStaff((req as any).session?.user?.roles)
    ) {
      return ApiResponse.forbidden(res, "Only the ride creator can end the ride");
    }

    if (ride.status === "COMPLETED" || ride.status === "CANCELLED") {
      return ApiResponse.conflict(res, "Ride has already ended");
    }

    const now = new Date();
    const actualEnd = req.body.actualEndTime ? new Date(req.body.actualEndTime) : now;

    const resolvedElevationGain = ElevationService.resolveElevationGain({
      elevationGainM: req.body.elevationGainM,
      routeGeoJson: req.body.routeGeoJson,
    });

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        // 0. Atomically claim the ride before doing any other work. The
        //    earlier status check above (line ~1161) reads outside this
        //    transaction, so two concurrent end-ride requests (a
        //    double-tap, or a client retry racing the original) could both
        //    observe IN_PROGRESS and both reach here — updateMany's WHERE
        //    guard (not expressible on a plain unique-id `update`) makes
        //    only one of them actually flip the status, so only one runs
        //    the summary/XP/badge logic below.
        const claim = await tx.ride.updateMany({
          where: { id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
          data: { status: "COMPLETED" },
        });
        if (claim.count === 0) {
          throw new RideAlreadyEndedError();
        }

        // 1. Close any break that's still open. We don't surface a separate
        //    error for this — the user pressing "End Ride" implicitly ends
        //    whatever they're currently on.
        await tx.rideBreak.updateMany({
          where: { rideId: id, userId, endedAt: null },
          data: {
            endedAt: now,
            // durationSec is best-effort; we don't have startedAt loaded here.
            // The summary computation falls back to (endedAt - startedAt) when
            // durationSec is null, so leaving it null is safe.
          },
        });

        // 2. Upsert tracking data (same shape as POST /:id/tracking).
        const trackingData = await tx.rideTrackingData.upsert({
          where: { rideId: id },
          create: {
            rideId: id,
            actualStartTime: req.body.actualStartTime
              ? new Date(req.body.actualStartTime)
              : null,
            actualEndTime: actualEnd,
            totalDistanceKm: req.body.totalDistanceKm,
            maxSpeedKmh: req.body.maxSpeedKmh,
            avgSpeedKmh: req.body.avgSpeedKmh,
            elevationGainM: resolvedElevationGain,
            routeGeoJson: req.body.routeGeoJson,
            riderNotes: req.body.riderNotes,
          },
          update: {
            actualStartTime: req.body.actualStartTime
              ? new Date(req.body.actualStartTime)
              : undefined,
            actualEndTime: actualEnd,
            totalDistanceKm: req.body.totalDistanceKm,
            maxSpeedKmh: req.body.maxSpeedKmh,
            avgSpeedKmh: req.body.avgSpeedKmh,
            elevationGainM: resolvedElevationGain ?? undefined,
            routeGeoJson: req.body.routeGeoJson,
            riderNotes: req.body.riderNotes,
          },
        });

        // 3. Pull all breaks + detours for this ride (post-update, so the
        //    just-closed break has its endedAt set).
        const [breaks, detours] = await Promise.all([
          tx.rideBreak.findMany({
            where: { rideId: id },
            select: { startedAt: true, endedAt: true, durationSec: true },
          }),
          tx.rideDetour.findMany({
            where: { rideId: id },
            select: { id: true },
          }),
        ]);

        // 4. Compute summary + effective duration.
        const summary = computeRideSummary({
          actualStartTime: trackingData.actualStartTime,
          actualEndTime: trackingData.actualEndTime,
          totalDistanceKm: trackingData.totalDistanceKm,
          maxSpeedKmh: trackingData.maxSpeedKmh,
          avgSpeedKmh: trackingData.avgSpeedKmh,
          elevationGainM: trackingData.elevationGainM,
          breaks,
          detours,
        });

        const effectiveDurationSec = deriveEffectiveDurationSec(trackingData, breaks);

        // 5. Aggregate break metrics on the tracking record (used elsewhere
        //    in the codebase — keep the legacy fields populated).
        await tx.rideTrackingData.update({
          where: { rideId: id },
          data: {
            breakCount: summary.breakCount,
            totalBreakMin: Math.round(summary.idleTimeSec / 60),
            totalDurationMin: Math.round(summary.movingTimeSec / 60),
            avgSpeedKmh: summary.avgSpeedKmh,
          },
        });

        // Prefer client-detected auto-idle when provided. Falls back to the
        // break-derived idle (which is 0 if the rider never logged a break).
        const finalIdleTimeSec = typeof clientIdleSec === "number" && clientIdleSec > summary.idleTimeSec
          ? clientIdleSec
          : summary.idleTimeSec;

        // 5b. Group Ride Report — read (not clear yet; cleared after this
        //     transaction commits, alongside markRideCompleted below) the
        //     tallies socket.ts accumulated over the ride's lifetime.
        const eventCounters = getRideEventCounters(id);

        // 6. Persist the snapshot summary.
        const persistedSummary = await tx.rideSummary.upsert({
          where: { rideId: id },
          create: {
            rideId: id,
            totalDistanceKm: summary.totalDistanceKm,
            totalDurationSec: summary.totalDurationSec,
            movingTimeSec: summary.movingTimeSec,
            idleTimeSec: finalIdleTimeSec,
            avgSpeedKmh: summary.avgSpeedKmh,
            maxSpeedKmh: summary.maxSpeedKmh,
            elevationGainM: summary.elevationGainM,
            breakCount: summary.breakCount,
            detourCount: summary.detourCount,
            score: summary.score,
            highlights: summary.highlights,
            badges: summary.badges,
            sosCount: eventCounters.sosCount,
            fallingBehindEvents: eventCounters.fallingBehindEvents,
            unresponsiveEvents: eventCounters.unresponsiveEvents,
          },
          update: {
            totalDistanceKm: summary.totalDistanceKm,
            totalDurationSec: summary.totalDurationSec,
            movingTimeSec: summary.movingTimeSec,
            idleTimeSec: finalIdleTimeSec,
            avgSpeedKmh: summary.avgSpeedKmh,
            maxSpeedKmh: summary.maxSpeedKmh,
            elevationGainM: summary.elevationGainM,
            breakCount: summary.breakCount,
            detourCount: summary.detourCount,
            score: summary.score,
            highlights: summary.highlights,
            badges: summary.badges,
            sosCount: eventCounters.sosCount,
            fallingBehindEvents: eventCounters.fallingBehindEvents,
            unresponsiveEvents: eventCounters.unresponsiveEvents,
            generatedAt: now,
          },
        });

        // 7. Transition the ride. `endedAt` is the wall-clock end; effective
        //    metrics live alongside.
        const updatedRide = await tx.ride.update({
          where: { id },
          data: {
            status: "COMPLETED",
            endedAt: now,
            pausedAt: null,
            effectiveDurationSec,
            effectiveDistanceKm: summary.totalDistanceKm,
            endedReason: req.body.endedReason ?? "USER_ENDED",
          },
        });

        return { ride: updatedRide, trackingData, summary: persistedSummary };
      });
    } catch (err) {
      if (err instanceof RideAlreadyEndedError) {
        return ApiResponse.conflict(res, "Ride has already ended");
      }
      throw err;
    }

    // 8. Award XP + first-ride badge to the creator. Outside the transaction
    //    so a downstream notification failure can't roll back the ride end.
    try {
      await awardXp(userId, "RIDE_COMPLETED", `ride ${id}`);
      const completedCount = await prisma.rideParticipant.count({
        where: { userId, status: "ACCEPTED" },
      });
      if (completedCount === 1) {
        await awardBadgeByTitle(userId, "First Ride");
      }
    } catch (err) {
      console.error("[RIDE_END] post-completion rewards failed", err);
    }

    // 9. Notify everyone in the ride room, clear the rider cache, and drop
    //    the Group Ride Report tallies now that they're snapshotted above.
    await markRideCompleted(id);
    clearRideEventCounters(id);

    ApiResponse.success(res, result);

  }

  static async postByIdInvite(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;
    const { userIds, message, directAdd } = req.body as {
      userIds: string[];
      message?: string;
      directAdd?: boolean;
    };

    // Verify ride exists and user is creator
    const ride = await prisma.ride.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true } },
      },
    });

    if (!ride) {
      return ApiResponse.notFound(
        res,
        "Ride not found",
        ErrorCode.RIDE_NOT_FOUND,
      );
    }

    if (ride.creatorId !== session.user.id && !isStaff(session.user.roles)) {
      return ApiResponse.forbidden(
        res,
        "Only the ride creator can send invitations",
      );
    }

    if (ride.status !== "PLANNED") {
      return ApiResponse.error(
        res,
        "Cannot invite users to a ride that has already started",
        400,
        ErrorCode.INVALID_INPUT,
      );
    }

    // The organiser-direct-add path lands recipients as ACCEPTED so they
    // appear in the Riders list immediately. The invite path keeps the old
    // REQUESTED behaviour and goes through the approval queue.
    const targetStatus = directAdd ? "ACCEPTED" : "REQUESTED";
    const invitations = await Promise.all(
      userIds.map((userId) =>
        prisma.rideParticipant.upsert({
          where: { rideId_userId: { rideId: id, userId } },
          create: {
            rideId: id,
            userId,
            status: targetStatus,
          },
          update: {
            status: targetStatus,
          },
          include: {
            user: {
              select: { id: true, name: true, avatar: true },
            },
          },
        }),
      ),
    );

    // Send notifications + push + socket via the central helper. Routing
    // through notifyUsers keeps the inbox row, the real-time socket event,
    // and the device push in lockstep — the previous prisma.create skipped
    // both push and the personal-room emit so invitees never got banners.
    const inviterName = session.user.name || "A rider";
    await notifyUsers(userIds, {
      type: "RIDE_INVITE",
      title: directAdd
        ? `${inviterName} added you to ${ride.title}`
        : `You're invited to ${ride.title}`,
      message: message || `${inviterName} invited you to join their ride`,
      relatedType: "ride",
      relatedId: id,
    });
    const notifications = userIds;

    // Emit Socket.IO event to invited users (if IO instance available)
    const io = (req as any).io;
    if (io) {
      userIds.forEach((userId) => {
        io.to(`user:${userId}`).emit("ride-invite-received", {
          rideId: id,
          rideName: ride.title,
          creatorName: session.user.name,
          creatorAvatar: session.user.avatar,
          message,
          timestamp: new Date().toISOString(),
        });
      });
    }

    ApiResponse.success(res, {
      invitations,
      notificationsSent: notifications.length,
    });

  }

  static async postByIdStart(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;

    const ride = await prisma.ride.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        creatorId: true,
        participants: {
          where: { userId: session.user.id, status: { in: ["ACCEPTED", "COMPLETED"] } },
          select: { id: true },
        },
      },
    });

    if (!ride) return ApiResponse.notFound(res, "Ride not found", ErrorCode.RIDE_NOT_FOUND);

    const isCreator = ride.creatorId === session.user.id;
    // Mirrors the mobile "Start Live Ride" button's own visibility gate
    // (isCreator || isAccepted) — anyone who could see that button can press it.
    if (!isCreator && ride.participants.length === 0) {
      return ApiResponse.forbidden(res, "Only the ride creator or an accepted participant can start this ride");
    }

    if (ride.status !== "PLANNED") {
      // Already IN_PROGRESS (someone else just started it) is fine to treat
      // as a no-op success — the caller's next step is "go to the live
      // screen" either way. PAUSED/COMPLETED/CANCELLED are real errors.
      if (ride.status === "IN_PROGRESS") {
        return ApiResponse.success(res, { status: ride.status }, "Ride already in progress");
      }
      return ApiResponse.error(res, `Ride cannot be started from ${ride.status}`, 400, ErrorCode.INVALID_INPUT);
    }

    await prisma.ride.update({
      where: { id },
      data: { status: "IN_PROGRESS" },
    });

    getIO()?.to(`ride:${id}`).emit("ride_status_changed", { rideId: id, status: "IN_PROGRESS" });

    ApiResponse.success(res, { status: "IN_PROGRESS" }, "Ride started");

  }

  static async postByIdPause(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;

    const ride = await prisma.ride.findUnique({
      where: { id },
      select: { id: true, status: true, creatorId: true, pausedAt: true },
    });

    if (!ride) return ApiResponse.notFound(res, "Ride not found", ErrorCode.RIDE_NOT_FOUND);
    if (ride.status !== "IN_PROGRESS") {
      return ApiResponse.error(res, "Ride is not in progress", 400, ErrorCode.INVALID_INPUT);
    }

    await prisma.ride.update({
      where: { id },
      data: { status: "PAUSED", pausedAt: new Date() },
    });

    ApiResponse.success(res, null, "Ride paused");

  }

  static async postByIdResume(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;

    const ride = await prisma.ride.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!ride) return ApiResponse.notFound(res, "Ride not found", ErrorCode.RIDE_NOT_FOUND);
    if (ride.status !== "PAUSED") {
      return ApiResponse.error(res, "Ride is not paused", 400, ErrorCode.INVALID_INPUT);
    }

    await prisma.ride.update({
      where: { id },
      data: { status: "IN_PROGRESS", pausedAt: null },
    });

    ApiResponse.success(res, null, "Ride resumed");

  }

  static async postByIdLead(req: Request, res: Response) {

    const session = (req as any).session;
    const requesterId = session?.user?.id;
    const { id } = req.params;
    const { userId } = req.body as { userId: string | null };

    const ride = await prisma.ride.findUnique({
      where: { id },
      select: { id: true, creatorId: true },
    });
    if (!ride) return ApiResponse.notFound(res, "Ride not found", ErrorCode.RIDE_NOT_FOUND);

    if (ride.creatorId !== requesterId) {
      return ApiResponse.forbidden(res, "Only the ride creator can assign the lead");
    }

    // A non-null target must be the creator or a confirmed participant —
    // anyone else either isn't on the ride or hasn't been accepted yet.
    if (userId !== null && userId !== ride.creatorId) {
      const participant = await prisma.rideParticipant.findFirst({
        where: { rideId: id, userId, status: { in: ["ACCEPTED", "COMPLETED"] } },
      });
      if (!participant) {
        return ApiResponse.error(
          res,
          "Lead must be the creator or a confirmed participant",
          400,
          ErrorCode.INVALID_INPUT,
        );
      }
    }

    const updated = await prisma.ride.update({
      where: { id },
      data: { leadUserId: userId },
      select: {
        id: true,
        leadUserId: true,
        lead: { select: { id: true, name: true, avatar: true } },
      },
    });

    getIO()?.to(`ride:${id}`).emit("ride_lead_changed", {
      rideId: id,
      leadUserId: updated.leadUserId,
      lead: updated.lead,
    });

    ApiResponse.success(res, { ride: updated });

  }

  static async postByIdBreaks(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;
    const { type, latitude, longitude, notes } = req.body;

    const ride = await prisma.ride.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!ride) return ApiResponse.notFound(res, "Ride not found", ErrorCode.RIDE_NOT_FOUND);
    if (ride.status !== "IN_PROGRESS" && ride.status !== "PAUSED") {
      return ApiResponse.error(res, "Ride is not active", 400, ErrorCode.INVALID_INPUT);
    }

    const rideBreak = await prisma.rideBreak.create({
      data: {
        rideId: id,
        userId: session.user.id,
        type,
        latitude,
        longitude,
        notes,
      },
    });

    ApiResponse.created(res, { break: rideBreak }, "Break started");

  }

  static async patchByIdBreaksByBreakIdEnd(req: Request, res: Response) {

    const session = (req as any).session;
    const { id, breakId } = req.params;

    const existingBreak = await prisma.rideBreak.findUnique({
      where: { id: breakId },
    });

    if (!existingBreak || existingBreak.rideId !== id) {
      return ApiResponse.notFound(res, "Break not found");
    }
    if (existingBreak.userId !== session.user.id) {
      return ApiResponse.forbidden(res, "Not your break");
    }
    if (existingBreak.endedAt) {
      return ApiResponse.error(res, "Break already ended", 400, ErrorCode.INVALID_INPUT);
    }

    const endedAt = new Date();
    const durationSec = Math.round(
      (endedAt.getTime() - existingBreak.startedAt.getTime()) / 1000,
    );

    const updated = await prisma.rideBreak.update({
      where: { id: breakId },
      data: { endedAt, durationSec },
    });

    ApiResponse.success(res, { break: updated }, "Break ended");

  }

  static async postByIdDetours(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;
    const { label, latitude, longitude, distanceAddedKm, durationAddedMin } = req.body;

    const ride = await prisma.ride.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!ride) return ApiResponse.notFound(res, "Ride not found", ErrorCode.RIDE_NOT_FOUND);
    if (ride.status !== "IN_PROGRESS" && ride.status !== "PAUSED") {
      return ApiResponse.error(res, "Ride is not active", 400, ErrorCode.INVALID_INPUT);
    }

    const detour = await prisma.rideDetour.create({
      data: {
        rideId: id,
        userId: session.user.id,
        label,
        latitude,
        longitude,
        distanceAddedKm,
        durationAddedMin,
      },
    });

    ApiResponse.success(res, { detour }, "Detour logged");

  }

  static async getByIdStats(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;

    const ride = await prisma.ride.findUnique({
      where: { id },
      include: {
        trackingData: true,
        breaks: {
          where: { userId: session.user.id },
          orderBy: { startedAt: "asc" },
        },
        detours: {
          where: { userId: session.user.id },
          orderBy: { addedAt: "asc" },
        },
        participants: { where: { userId: session.user.id }, select: { status: true } },
        creator: { select: { id: true, name: true, avatar: true } },
        // Phase 1 added a denormalized RideSummary snapshot per ride. It's
        // populated atomically by POST /:id/end. For rides that ended before
        // the migration this is null — clients fall back to the inline
        // `summary` block below.
        summary: true,
      },
    });

    if (!ride) return ApiResponse.notFound(res, "Ride not found", ErrorCode.RIDE_NOT_FOUND);

    const isCreator = ride.creatorId === session.user.id;
    const isParticipant = ride.participants.length > 0;
    if (!isCreator && !isParticipant) {
      return ApiResponse.forbidden(res, "Not a ride participant");
    }

    const completedBreaks = ride.breaks.filter((b: any) => b.endedAt != null);
    const totalBreakSec = completedBreaks.reduce(
      (sum: number, b: any) => sum + (b.durationSec ?? 0),
      0,
    );
    const totalBreakMin = Math.round(totalBreakSec / 60);

    const td = ride.trackingData;
    const totalTimeMin = td?.totalDurationMin ?? 0;
    const rideTimeMin = Math.max(0, totalTimeMin - totalBreakMin);

    ApiResponse.success(res, {
      ride: {
        id: ride.id,
        title: ride.title,
        status: ride.status,
        creator: ride.creator,
        scheduledAt: ride.scheduledAt,
        endedAt: ride.endedAt,
        effectiveDurationSec: ride.effectiveDurationSec,
        endedReason: ride.endedReason,
      },
      trackingData: td,
      breaks: ride.breaks,
      detours: ride.detours,
      summary: {
        totalTimeMin,
        rideTimeMin,
        totalBreakMin,
        totalDistanceKm: td?.totalDistanceKm ?? 0,
        maxSpeedKmh: td?.maxSpeedKmh ?? 0,
        avgSpeedKmh: td?.avgSpeedKmh ?? 0,
        elevationGainM: td?.elevationGainM ?? 0,
        breakCount: completedBreaks.length,
        detourCount: ride.detours.length,
      },
      // The RideSummary snapshot — score, highlights, badges, idle/moving
      // time. Null for legacy rides; clients should treat as optional.
      rideSummary: ride.summary,
    });

  }

  static async getByIdExportGpx(req: Request, res: Response) {

    const session = (req as any).session;
    const { id } = req.params;

    const ride = await prisma.ride.findUnique({
      where: { id },
      include: {
        trackingData: true,
        participants: { where: { userId: session.user.id } },
      },
    });

    if (!ride) {
      return ApiResponse.notFound(res, "Ride not found");
    }

    const isCreator = ride.creatorId === session.user.id;
    const isParticipant = ride.participants.length > 0;
    if (!isCreator && !isParticipant) {
      return ApiResponse.forbidden(
        res,
        "Only ride participants can export the GPX file",
      );
    }

    if (!ride.trackingData?.routeGeoJson) {
      return ApiResponse.error(
        res,
        "This ride has no recorded route. GPX export is only available after the ride has tracking data.",
        409,
        ErrorCode.CONFLICT,
      );
    }

    const gpx = rideToGpx({
      rideId: ride.id,
      title: ride.title,
      description: ride.description,
      startTime: ride.trackingData.actualStartTime ?? ride.scheduledAt,
      routeGeoJson: ride.trackingData.routeGeoJson,
    });

    const filename = `revvie-ride-${ride.id}.gpx`;
    res.setHeader("Content-Type", "application/gpx+xml; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    res.status(200).send(gpx);

  }

  static async postByIdTelemetry(req: Request, res: Response) {

    const session = (req as any).session;
    const userId = session?.user?.id;
    const { id } = req.params;

    const [ride, participant, user] = await Promise.all([
      prisma.ride.findUnique({
        where: { id },
        select: { id: true, creatorId: true, status: true },
      }),
      prisma.rideParticipant.findFirst({
        where: {
          rideId: id,
          userId,
          status: { in: ["ACCEPTED", "COMPLETED"] },
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, avatar: true },
      }),
    ]);

    if (!ride) {
      return ApiResponse.notFound(res, "Ride not found");
    }

    const isCreator = ride.creatorId === userId;
    if (!isCreator && !participant) {
      return ApiResponse.forbidden(
        res,
        "Only confirmed ride participants can send telemetry",
      );
    }

    // A queued/background ping landing just after pause/end is routine, not
    // a client error — accept it (200) but skip the persist/broadcast so a
    // stray fix from a paused or already-ended ride doesn't move the rider's
    // marker or leak into a ride that's no longer live.
    if (ride.status !== "IN_PROGRESS") {
      return ApiResponse.success(res, { success: true, ignored: true });
    }

    const {
      latitude,
      longitude,
      altitude,
      heading,
      speed,
      accuracy,
      battery,
      isMoving,
      capturedAt,
    } = req.body;

    await LocationService.updateLocation({
      userId,
      latitude,
      longitude,
      altitude: altitude ?? undefined,
      heading: heading ?? undefined,
      speed: speed ?? undefined,
      accuracy: accuracy ?? undefined,
      battery: battery ?? undefined,
      isMoving: isMoving ?? false,
      isOnRide: true,
      rideId: id,
    });

    await broadcastRiderLocation({
      rideId: id,
      userId,
      name: user?.name || "Rider",
      avatar: user?.avatar,
      latitude,
      longitude,
      heading,
      speed,
      altitude,
      accuracy,
      isMoving,
      timestamp: capturedAt ? new Date(capturedAt).toISOString() : undefined,
    });

    ApiResponse.success(res, { success: true });

  }

  static async postByIdTelemetryBatch(req: Request, res: Response) {

    const session = (req as any).session;
    const userId = session?.user?.id;
    const { id } = req.params;
    const { pings } = req.body;

    const [ride, participant, user] = await Promise.all([
      prisma.ride.findUnique({
        where: { id },
        select: { id: true, creatorId: true, status: true },
      }),
      prisma.rideParticipant.findFirst({
        where: {
          rideId: id,
          userId,
          status: { in: ["ACCEPTED", "COMPLETED"] },
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, avatar: true },
      }),
    ]);

    if (!ride) {
      return ApiResponse.notFound(res, "Ride not found");
    }

    const isCreator = ride.creatorId === userId;
    if (!isCreator && !participant) {
      return ApiResponse.forbidden(
        res,
        "Only confirmed ride participants can send telemetry",
      );
    }

    if (ride.status !== "IN_PROGRESS") {
      return ApiResponse.success(res, { success: true, ignored: true, processed: 0 });
    }

    const latestPing = pings[pings.length - 1];

    if (latestPing) {
      // Only the final ping's position is persisted — LocationService is a
      // single-row upsert per user with no per-ping history table, so
      // replaying every ping into it would just overwrite itself N times.
      await LocationService.updateLocation({
        userId,
        latitude: latestPing.latitude,
        longitude: latestPing.longitude,
        altitude: latestPing.altitude ?? undefined,
        heading: latestPing.heading ?? undefined,
        speed: latestPing.speed ?? undefined,
        accuracy: latestPing.accuracy ?? undefined,
        battery: latestPing.battery ?? undefined,
        isMoving: latestPing.isMoving ?? false,
        isOnRide: true,
        rideId: id,
      });

      // Every ping is broadcast, in order, in one event — previously only
      // the last ping was ever emitted, so a client catching up after a
      // connectivity gap (exactly what this endpoint exists for) saw the
      // rider teleport straight to their latest position instead of the
      // actual path they rode while offline.
      await broadcastRiderLocationBatch(
        id,
        userId,
        user?.name || "Rider",
        user?.avatar,
        pings.map((p: typeof latestPing) => ({
          latitude: p.latitude,
          longitude: p.longitude,
          heading: p.heading,
          speed: p.speed,
          altitude: p.altitude,
          accuracy: p.accuracy,
          isMoving: p.isMoving,
          timestamp: p.capturedAt ? new Date(p.capturedAt).toISOString() : undefined,
        })),
      );
    }

    ApiResponse.success(res, { processed: pings.length });

  }

}
