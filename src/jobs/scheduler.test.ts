/**
 * SCHEDULER JOB TESTS
 *
 * Regression coverage for the destructive cron jobs in src/jobs/scheduler.ts:
 *   - cleanupOldRides: must honour the keepPermanently flag (a missing filter
 *     here silently deleted user-pinned rides every night).
 *   - updateRideStatuses: auto-complete must only fire for rides whose
 *     activity window has fully elapsed — never for live rides started
 *     manually by users who are still riding.
 *
 * These tests hit the real Postgres test database via src/test/utils helpers.
 */

import prisma from "../lib/prisma";
import { cleanupOldRides, updateRideStatuses } from "./scheduler";
import {
  createTestUser,
  createTestRide,
  cleanupTestData,
} from "../test/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

// Keep in sync with RIDE_RETENTION_DAYS in scheduler.ts (default 30).
const RETENTION_DAYS = parseInt(process.env.RIDE_RETENTION_DAYS || "30", 10);

/** Prisma's @updatedAt overwrites explicit values, so backdate via raw SQL. */
async function backdateUpdatedAt(rideId: string, daysAgo: number) {
  const when = new Date(Date.now() - daysAgo * DAY_MS);
  await prisma.$executeRaw`UPDATE "rides" SET "updated_at" = ${when} WHERE "id" = ${rideId}`;
}

describe("Scheduler Jobs", () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe("cleanupOldRides", () => {
    it("deletes old COMPLETED rides past the retention window", async () => {
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id, {
        status: "COMPLETED",
      });
      await backdateUpdatedAt(ride.id, RETENTION_DAYS + 5);

      const result = await cleanupOldRides();

      expect(result.deleted).toBeGreaterThanOrEqual(1);
      const gone = await prisma.ride.findUnique({ where: { id: ride.id } });
      expect(gone).toBeNull();
    });

    it("[REGRESSION] NEVER deletes rides flagged keepPermanently", async () => {
      const creator = await createTestUser();
      const pinned = await createTestRide(creator.user.id, {
        status: "COMPLETED",
        keepPermanently: true,
      });
      await backdateUpdatedAt(pinned.id, RETENTION_DAYS + 5);

      // An unpinned neighbour ride proves the job actually ran.
      const unpinned = await createTestRide(creator.user.id, {
        status: "COMPLETED",
      });
      await backdateUpdatedAt(unpinned.id, RETENTION_DAYS + 5);

      const result = await cleanupOldRides();

      expect(result.deleted).toBeGreaterThanOrEqual(1);
      expect(result.errors).toHaveLength(0);
      const survivor = await prisma.ride.findUnique({
        where: { id: pinned.id },
      });
      expect(survivor).not.toBeNull();
      expect(survivor!.keepPermanently).toBe(true);
      const deletedNeighbour = await prisma.ride.findUnique({
        where: { id: unpinned.id },
      });
      expect(deletedNeighbour).toBeNull();
    });

    it("keeps recent rides even without keepPermanently", async () => {
      const creator = await createTestUser();
      const recent = await createTestRide(creator.user.id, {
        status: "COMPLETED",
      });

      const result = await cleanupOldRides();

      const stillThere = await prisma.ride.findUnique({
        where: { id: recent.id },
      });
      expect(stillThere).not.toBeNull();
      void result;
    });
  });

  describe("updateRideStatuses", () => {
    it("starts PLANNED rides whose scheduled time has passed", async () => {
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id, {
        status: "PLANNED",
        scheduledAt: new Date(Date.now() - 30 * MIN_MS),
        duration: 120,
      });

      await updateRideStatuses();

      const after = await prisma.ride.findUnique({ where: { id: ride.id } });
      expect(after!.status).toBe("IN_PROGRESS");
    });

    it("auto-completes IN_PROGRESS rides whose declared duration has fully elapsed", async () => {
      const creator = await createTestUser();
      // Scheduled 3h ago with a 60-minute planned duration -> long overdue.
      const ride = await createTestRide(creator.user.id, {
        status: "IN_PROGRESS",
        scheduledAt: new Date(Date.now() - 180 * MIN_MS),
        duration: 60,
      });

      const result = await updateRideStatuses();

      expect(result.updated).toBeGreaterThanOrEqual(1);
      const after = await prisma.ride.findUnique({ where: { id: ride.id } });
      expect(after!.status).toBe("COMPLETED");
      expect(after!.endedReason).toBe("TIMEOUT");
      expect(after!.endedAt).not.toBeNull();
    });

    it("[REGRESSION] does NOT force-complete a live ride still inside its window", async () => {
      const creator = await createTestUser();
      // Started manually 30 minutes ago; rider declared a 4-hour activity and
      // is well inside both the declared window and the hard ceiling.
      const liveRide = await createTestRide(creator.user.id, {
        status: "IN_PROGRESS",
        scheduledAt: new Date(Date.now() - 30 * MIN_MS),
        duration: 240,
      });

      const result = await updateRideStatuses();

      const after = await prisma.ride.findUnique({
        where: { id: liveRide.id },
      });
      expect(after!.status).toBe("IN_PROGRESS");
      expect(after!.endedReason).toBeNull();
      void result;
    });
  });
});
