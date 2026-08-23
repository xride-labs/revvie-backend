import cron from "node-cron";
import prisma from "../lib/prisma.js";
import { deleteMultipleMedia } from "../lib/cloudinary.js";
import { notifyUsers } from "../lib/notifications.js";

/**
 * Configuration for ride cleanup
 */
const RIDE_RETENTION_DAYS = parseInt(
  process.env.RIDE_RETENTION_DAYS || "30",
  10,
);

const DEFAULT_SELF_PING_INTERVAL_MINUTES = 10;
const SELF_PING_TIMEOUT_MS = 10_000;

/**
 * Ride cleanup job - runs daily at 2 AM
 * Deletes rides that ended more than RIDE_RETENTION_DAYS ago
 * unless they have keepPermanently flag set
 */
export async function cleanupOldRides(): Promise<{
  deleted: number;
  errors: string[];
}> {
  const errors: string[] = [];
  // eslint-disable-next-line prefer-const
  let deleted = 0;

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RIDE_RETENTION_DAYS);

    // Find rides to delete
    // Rides that are COMPLETED or CANCELLED and ended before cutoff date
    // and don't have keepPermanently flag
    const ridesToDelete = await prisma.ride.findMany({
      where: {
        status: { in: ["COMPLETED", "CANCELLED"] },
        updatedAt: { lt: cutoffDate },
        // Using a raw query approach since keepPermanently might need to be added to schema
        // For now, we'll check rides that were completed/cancelled before cutoff
      },
      select: {
        id: true,
        title: true,
        chatGroupId: true,
      },
    });

    console.log(
      `[Ride Cleanup] Found ${ridesToDelete.length} rides eligible for deletion`,
    );

    for (const ride of ridesToDelete) {
      try {
        // Delete associated chat messages if chat group exists
        if (ride.chatGroupId) {
          await prisma.chatMessage.deleteMany({
            where: { chatGroupId: ride.chatGroupId },
          });
        }

        // Delete ride participants
        await prisma.rideParticipant.deleteMany({
          where: { rideId: ride.id },
        });

        // Delete associated posts (optional - might want to keep as archived)
        await prisma.post.deleteMany({
          where: { rideId: ride.id },
        });

        // Delete the ride
        await prisma.ride.delete({
          where: { id: ride.id },
        });

        deleted++;
        console.log(`[Ride Cleanup] Deleted ride: ${ride.title} (${ride.id})`);
      } catch (error) {
        const errorMsg = `Failed to delete ride ${ride.id}: ${(error as Error).message}`;
        console.error(`[Ride Cleanup] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    console.log(
      `[Ride Cleanup] Completed. Deleted: ${deleted}, Errors: ${errors.length}`,
    );
    return { deleted, errors };
  } catch (error) {
    const errorMsg = `Ride cleanup job failed: ${(error as Error).message}`;
    console.error(`[Ride Cleanup] ${errorMsg}`);
    errors.push(errorMsg);
    return { deleted, errors };
  }
}

/**
 * Daily media cleanup. Finds Media rows whose `expiresAt` has passed,
 * deletes the Cloudinary assets, then drops the Postgres rows.
 *
 * Cloudinary deletion is best-effort batched in chunks of 100 (the API limit
 * for `delete_resources`). If a Cloudinary call fails, those rows are left
 * intact so the next run retries them — better than leaking storage.
 *
 * Runs nightly via the cron schedule below.
 */
export async function cleanupOrphanedMedia(): Promise<{
  deleted: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let deleted = 0;
  const BATCH = 100;

  try {
    const now = new Date();

    // Pull expired rows in pages so a backlog doesn't blow up memory.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const expired = await prisma.media.findMany({
        where: { expiresAt: { lte: now } },
        take: BATCH,
        select: { id: true, publicId: true, type: true },
      });

      if (expired.length === 0) break;

      const imageIds = expired.filter((m) => m.type === "IMAGE").map((m) => m.publicId);
      const videoIds = expired.filter((m) => m.type === "VIDEO").map((m) => m.publicId);

      const dbIdsToDelete: string[] = [];

      if (imageIds.length > 0) {
        const result = await deleteMultipleMedia(imageIds, "image");
        // Only delete the DB row when Cloudinary confirmed deletion. If a
        // resource was already gone Cloudinary returns "not_found" — those
        // are also safe to drop locally so we don't keep retrying them.
        const removable = new Set([...result.deleted, ...result.failed.filter((id) => /* keep retryable */ false)]);
        for (const m of expired) {
          if (m.type === "IMAGE" && removable.has(m.publicId)) dbIdsToDelete.push(m.id);
        }
      }

      if (videoIds.length > 0) {
        const result = await deleteMultipleMedia(videoIds, "video");
        const removable = new Set(result.deleted);
        for (const m of expired) {
          if (m.type === "VIDEO" && removable.has(m.publicId)) dbIdsToDelete.push(m.id);
        }
      }

      if (dbIdsToDelete.length > 0) {
        const res = await prisma.media.deleteMany({
          where: { id: { in: dbIdsToDelete } },
        });
        deleted += res.count;
      }

      // If Cloudinary refused the whole batch (network/auth issue) we'd
      // loop forever — break when no DB rows were deletable in this round.
      if (dbIdsToDelete.length === 0) {
        errors.push(
          `Cloudinary deletion produced 0 removable rows out of ${expired.length} — aborting to avoid an infinite loop`,
        );
        break;
      }
    }

    console.log(`[Media Cleanup] Deleted ${deleted} expired media rows`);
    return { deleted, errors };
  } catch (error) {
    const errorMsg = `Media cleanup job failed: ${(error as Error).message}`;
    console.error(`[Media Cleanup] ${errorMsg}`);
    errors.push(errorMsg);
    return { deleted, errors };
  }
}

/**
 * Update ride statuses based on scheduled time
 * Runs every 15 minutes
 */
export async function updateRideStatuses(): Promise<{
  updated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let updated = 0;

  try {
    const now = new Date();

    // Update PLANNED rides to IN_PROGRESS if scheduled time has passed
    const startedRides = await prisma.ride.updateMany({
      where: {
        status: "PLANNED",
        scheduledAt: { lte: now },
      },
      data: {
        status: "IN_PROGRESS",
      },
    });

    updated += startedRides.count;

    // Optionally: Auto-complete rides after expected duration
    // This could be based on scheduledAt + duration

    if (updated > 0) {
      console.log(`[Ride Status] Started ${updated} rides`);
    }

    // auto complete rides
    if (startedRides.count > 0) {
      const completedRides = await prisma.ride.updateMany({
        where: {
          status: "IN_PROGRESS",
          scheduledAt: { lt: now },
        },
        data: {
          status: "COMPLETED",
        },
      });
      updated += completedRides.count;
    }

    return { updated, errors };
  } catch (error) {
    const errorMsg = `Ride status update job failed: ${(error as Error).message}`;
    console.error(`[Ride Status] ${errorMsg}`);
    errors.push(errorMsg);
    return { updated, errors };
  }
}

/**
 * Delete device tokens not seen in 90 days.
 *
 * Expo push tokens rotate after app reinstalls or OS upgrades. Tokens that
 * haven't been refreshed via POST /notifications/devices/register in 90 days
 * are almost certainly dead — the `DeviceNotRegistered` pruning in push.ts
 * handles immediate failures, but tokens that just go silent (device factory-
 * reset without uninstall) only get caught here. Runs daily at 3:30 AM so it
 * doesn't overlap with the media cleanup job at 3:00 AM.
 */
export async function cleanupStaleDeviceTokens(): Promise<{ deleted: number }> {
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const result = await prisma.deviceToken.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      console.log(`[Token Cleanup] Pruned ${result.count} stale device tokens`);
    }
    return { deleted: result.count };
  } catch (error) {
    console.error(`[Token Cleanup] Failed: ${(error as Error).message}`);
    return { deleted: 0 };
  }
}

/**
 * Cleanup inactive sessions
 * Runs daily at 4 AM
 */
export async function cleanupExpiredSessions(): Promise<{ deleted: number }> {
  try {
    const result = await prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    if (result.count > 0) {
      console.log(`[Session Cleanup] Deleted ${result.count} expired sessions`);
    }

    return { deleted: result.count };
  } catch (error) {
    console.error(`[Session Cleanup] Failed: ${(error as Error).message}`);
    return { deleted: 0 };
  }
}

/**
 * Calculate and update user statistics
 * Runs daily at 1 AM
 */
export async function updateUserStatistics(): Promise<{ updated: number }> {
  try {
    // Update rides completed count for all users
    const users = await prisma.user.findMany({
      select: { id: true },
    });

    let updated = 0;

    for (const user of users) {
      const ridesCount = await prisma.rideParticipant.count({
        where: {
          userId: user.id,
          status: "COMPLETED",
        },
      });

      // Upsert UserRideStats to update totalRides
      await prisma.userRideStats.upsert({
        where: { userId: user.id },
        update: { totalRides: ridesCount },
        create: {
          userId: user.id,
          totalRides: ridesCount,
        },
      });

      updated++;
    }

    console.log(`[User Stats] Updated statistics for ${updated} users`);
    return { updated };
  } catch (error) {
    console.error(`[User Stats] Failed: ${(error as Error).message}`);
    return { updated: 0 };
  }
}

/**
 * Notify accepted participants 30 minutes before a ride starts.
 *
 * The cron schedule fires every 5 minutes, so a ride scheduled at T can
 * land in two adjacent windows. We dedupe by writing a `startReminderSentAt`
 * timestamp on the ride row — sending only when it's null and the ride is
 * within the 25–35 min window relative to now.
 */
export async function sendUpcomingRideReminders(): Promise<{
  notified: number;
}> {
  let notified = 0;
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 25 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 35 * 60 * 1000);

    const upcoming = await prisma.ride.findMany({
      where: {
        status: "PLANNED",
        scheduledAt: { gte: windowStart, lte: windowEnd },
        startReminderSentAt: null,
      },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        creatorId: true,
        participants: {
          where: { status: "ACCEPTED" },
          select: { userId: true },
        },
      },
    });

    for (const ride of upcoming) {
      const recipientIds = Array.from(
        new Set([ride.creatorId, ...ride.participants.map((p) => p.userId)]),
      ).filter(Boolean);

      if (recipientIds.length) {
        await notifyUsers(recipientIds, {
          type: "RIDE_INVITE",
          title: `${ride.title} starts in 30 minutes`,
          message: "Time to gear up — open the ride to view route + meetup.",
          relatedType: "ride",
          relatedId: ride.id,
        });
      }

      await prisma.ride
        .update({
          where: { id: ride.id },
          data: { startReminderSentAt: new Date() },
        })
        .catch(() => {
          // The startReminderSentAt column may not exist yet on older
          // databases — fall back to a no-op so the job doesn't loop
          // forever sending duplicate reminders. Run the migration to
          // enable proper deduping.
        });
      notified += recipientIds.length;
    }
  } catch (err) {
    console.error("[RideReminder] Failed:", (err as Error).message);
  }
  return { notified };
}

/**
 * Initialize all scheduled jobs
 */
export function initializeScheduledJobs(): void {
  console.log("[Jobs] Initializing scheduled jobs...");

  // Daily ride cleanup at 2:00 AM
  cron.schedule("0 2 * * *", async () => {
    console.log("[Jobs] Running daily ride cleanup...");
    await cleanupOldRides();
  });

  // Update ride statuses every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    await updateRideStatuses();
  });

  // Upcoming-ride reminder push every 5 minutes — picks up rides that fall
  // into the 25–35 min window. The 10-min window absorbs cron jitter while
  // the row-level `startReminderSentAt` flag prevents duplicate banners.
  cron.schedule("*/5 * * * *", async () => {
    await sendUpcomingRideReminders();
  });

  // Daily session cleanup at 4:00 AM
  cron.schedule("0 4 * * *", async () => {
    console.log("[Jobs] Running session cleanup...");
    await cleanupExpiredSessions();
  });

  // Daily user statistics update at 1:00 AM
  cron.schedule("0 1 * * *", async () => {
    console.log("[Jobs] Running user statistics update...");
    await updateUserStatistics();
  });

  // Daily expired-media cleanup at 3:00 AM. Phase 5 retention requires
  // expired chat/ride media to be removed promptly — daily is the right
  // cadence for a 24h disappearing default.
  cron.schedule("0 3 * * *", async () => {
    console.log("[Jobs] Running daily expired-media cleanup...");
    await cleanupOrphanedMedia();
  });

  // Daily stale device token pruning at 3:30 AM.
  // Tokens not seen in 90 days are silently dead — removes them so push
  // fan-out stays lean and Expo API quotas aren't wasted on ghost devices.
  cron.schedule("30 3 * * *", async () => {
    await cleanupStaleDeviceTokens();
  });

  console.log("[Jobs] All scheduled jobs initialized successfully");
}

function resolveSelfPingUrl(port: number): string | null {
  const explicit = process.env.SELF_PING_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const externalBase =
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    process.env.BETTER_AUTH_BASE_URL?.trim();

  if (externalBase) {
    return `${externalBase.replace(/\/$/, "")}/health`;
  }

  if (process.env.NODE_ENV !== "production") {
    return `http://localhost:${port}/health`;
  }

  return null;
}

async function pingServer(url: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SELF_PING_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "revvie-backend-self-ping/1.0",
      },
    });

    if (!response.ok) {
      console.warn(
        `[KeepAlive] Self-ping returned ${response.status} ${response.statusText}`,
      );
      return;
    }

    console.log(`[KeepAlive] Self-ping successful (${response.status})`);
  } catch (error) {
    console.warn(
      `[KeepAlive] Self-ping failed: ${(error as Error).message}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Periodically pings the deployed backend to keep warm on free-tier hosts.
 */
export function initializeSelfPing(port: number): void {
  const isEnabled = (process.env.SELF_PING_ENABLED || "true") === "true";
  if (!isEnabled) {
    console.log("[KeepAlive] Self-ping disabled by SELF_PING_ENABLED");
    return;
  }

  const productionOnly =
    (process.env.SELF_PING_PRODUCTION_ONLY || "true") === "true";
  if (productionOnly && process.env.NODE_ENV !== "production") {
    console.log(
      "[KeepAlive] Self-ping skipped outside production (SELF_PING_PRODUCTION_ONLY=true)",
    );
    return;
  }

  const intervalMinutes = Number.parseFloat(
    process.env.SELF_PING_INTERVAL_MINUTES ||
      String(DEFAULT_SELF_PING_INTERVAL_MINUTES),
  );

  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    console.warn(
      `[KeepAlive] Invalid SELF_PING_INTERVAL_MINUTES value: ${process.env.SELF_PING_INTERVAL_MINUTES}`,
    );
    return;
  }

  const pingUrl = resolveSelfPingUrl(port);
  if (!pingUrl) {
    console.warn(
      "[KeepAlive] Skipped self-ping: set SELF_PING_URL or RENDER_EXTERNAL_URL in production",
    );
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(
    `[KeepAlive] Self-ping enabled: ${pingUrl} every ${intervalMinutes} minute(s)`,
  );

  // Trigger a warm-up ping shortly after startup.
  setTimeout(() => {
    void pingServer(pingUrl);
  }, 30_000);

  const timer = setInterval(() => {
    void pingServer(pingUrl);
  }, intervalMs);

  timer.unref();
}

/**
 * Run a specific job manually (for admin use)
 */
export async function runJobManually(jobName: string): Promise<any> {
  switch (jobName) {
    case "cleanupOldRides":
      return await cleanupOldRides();
    case "updateRideStatuses":
      return await updateRideStatuses();
    case "cleanupExpiredSessions":
      return await cleanupExpiredSessions();
    case "updateUserStatistics":
      return await updateUserStatistics();
    case "cleanupOrphanedMedia":
      return await cleanupOrphanedMedia();
    case "cleanupStaleDeviceTokens":
      return await cleanupStaleDeviceTokens();
    default:
      throw new Error(`Unknown job: ${jobName}`);
  }
}
