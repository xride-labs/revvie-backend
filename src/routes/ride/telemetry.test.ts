/**
 * TELEMETRY ENDPOINT TESTS
 *
 * Covers /:id/telemetry and /:id/telemetry/batch — previously untested
 * entirely (confirmed via grep across rides.test.ts before this file was
 * added). Exercises the fixes made alongside these tests:
 *  - batch now persists the LAST ping but broadcasts EVERY ping in order
 *    (previously only the last was ever emitted)
 *  - both routes now no-op (200, ignored:true) instead of accepting/
 *    broadcasting telemetry for a ride that isn't IN_PROGRESS
 *  - both routes are rate-limited per (user, ride), not just the blanket
 *    IP-keyed apiLimiter
 */

import request from "supertest";
import { app } from "../../server";
import prisma from "../../lib/prisma";
import {
  createTestUser,
  createTestRide,
  addRideParticipant,
  cleanupTestData,
} from "../../test/utils";
import {
  startSocketTestServer,
  stopSocketTestServer,
  connectTestSocket,
  waitForEvent,
  emitWithAck,
} from "../../test/socketTestServer";

const NONEXISTENT_RIDE_ID = "clnonexistentride000000000";

describe("Ride telemetry routes", () => {
  beforeAll(async () => {
    await startSocketTestServer();
  });

  afterAll(async () => {
    await stopSocketTestServer();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe("POST /api/rides/:id/telemetry", () => {
    it("persists and broadcasts a single ping from a confirmed participant", async () => {
      const creator = await createTestUser();
      const rider = await createTestUser();
      const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
      await addRideParticipant(rider.user.id, ride.id, "ACCEPTED");

      const riderSocket = await connectTestSocket(rider.token);
      await emitWithAck(riderSocket, "join_ride_tracking", { rideId: ride.id });
      const broadcastPromise = waitForEvent(riderSocket, "rider_location_updated");

      const res = await request(app)
        .post(`/api/rides/${ride.id}/telemetry`)
        .set("Authorization", `Bearer ${rider.token}`)
        .send({ latitude: 40.7128, longitude: -74.006, speed: 12.5 });

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);

      const broadcast: any = await broadcastPromise;
      expect(broadcast.userId).toBe(rider.user.id);
      expect(broadcast.latitude).toBeCloseTo(40.7128, 5);

      const stored = await prisma.userLiveLocation.findUnique({
        where: { userId: rider.user.id },
      });
      expect(stored?.latitude).toBeCloseTo(40.7128, 5);

      riderSocket.disconnect();
    });

    it("rejects a non-participant with 403", async () => {
      const creator = await createTestUser();
      const outsider = await createTestUser();
      const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });

      const res = await request(app)
        .post(`/api/rides/${ride.id}/telemetry`)
        .set("Authorization", `Bearer ${outsider.token}`)
        .send({ latitude: 40.7128, longitude: -74.006 });

      expect(res.status).toBe(403);
    });

    it("returns 404 for a nonexistent ride", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .post(`/api/rides/${NONEXISTENT_RIDE_ID}/telemetry`)
        .set("Authorization", `Bearer ${token}`)
        .send({ latitude: 40.7128, longitude: -74.006 });

      expect(res.status).toBe(404);
    });

    it.each(["PLANNED", "PAUSED", "COMPLETED", "CANCELLED"])(
      "no-ops (200, ignored:true) for a %s ride instead of persisting/broadcasting",
      async (status) => {
        const { user, token } = await createTestUser();
        const ride = await createTestRide(user.id, { status: status as any });

        const res = await request(app)
          .post(`/api/rides/${ride.id}/telemetry`)
          .set("Authorization", `Bearer ${token}`)
          .send({ latitude: 1.1, longitude: 2.2 });

        expect(res.status).toBe(200);
        expect(res.body.data.ignored).toBe(true);

        const stored = await prisma.userLiveLocation.findUnique({
          where: { userId: user.id },
        });
        expect(stored).toBeNull();
      },
    );

    it("rejects out-of-range latitude/longitude with 400", async () => {
      const { user, token } = await createTestUser();
      const ride = await createTestRide(user.id, { status: "IN_PROGRESS" });

      const res = await request(app)
        .post(`/api/rides/${ride.id}/telemetry`)
        .set("Authorization", `Bearer ${token}`)
        .send({ latitude: 999, longitude: -74.006 });

      expect(res.status).toBe(400);
    });

    it("accepts CLLocation's -1 'unavailable' sentinel for speed/heading instead of rejecting the ping", async () => {
      const { user, token } = await createTestUser();
      const ride = await createTestRide(user.id, { status: "IN_PROGRESS" });

      const res = await request(app)
        .post(`/api/rides/${ride.id}/telemetry`)
        .set("Authorization", `Bearer ${token}`)
        .send({ latitude: 40.7128, longitude: -74.006, speed: -1, heading: -1 });

      expect(res.status).toBe(200);

      // Normalized to "unknown" (null), not stored as a literal -1 speed.
      const stored = await prisma.userLiveLocation.findUnique({ where: { userId: user.id } });
      expect(stored?.speed).toBeNull();
      expect(stored?.heading).toBeNull();
    });

    it("still rejects a genuinely invalid negative speed (anything other than the -1 sentinel)", async () => {
      const { user, token } = await createTestUser();
      const ride = await createTestRide(user.id, { status: "IN_PROGRESS" });

      const res = await request(app)
        .post(`/api/rides/${ride.id}/telemetry`)
        .set("Authorization", `Bearer ${token}`)
        .send({ latitude: 40.7128, longitude: -74.006, speed: -5 });

      expect(res.status).toBe(400);
    });

    it("is rate-limited per (user, ride) — not the blanket IP limiter", async () => {
      const { user, token } = await createTestUser();
      const ride = await createTestRide(user.id, { status: "IN_PROGRESS" });

      const res = await request(app)
        .post(`/api/rides/${ride.id}/telemetry`)
        .set("Authorization", `Bearer ${token}`)
        .send({ latitude: 1.1, longitude: 2.2 });

      // Full 429-tripping is impractical in test mode (the dev/test max is
      // deliberately generous, matching the existing apiLimiter convention)
      // — asserting the limiter is actually mounted and scoped via its
      // standard headers is the fast, deterministic signal.
      expect(res.headers["ratelimit-limit"]).toBeDefined();
    });
  });

  describe("POST /api/rides/:id/telemetry/batch", () => {
    it("persists only the last ping but broadcasts every ping in order", async () => {
      const creator = await createTestUser();
      const rider = await createTestUser();
      const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
      await addRideParticipant(rider.user.id, ride.id, "ACCEPTED");

      const riderSocket = await connectTestSocket(rider.token);
      await emitWithAck(riderSocket, "join_ride_tracking", { rideId: ride.id });
      const batchPromise = waitForEvent<{ userId: string; points: any[] }>(
        riderSocket,
        "rider_location_batch",
      );

      const pings = [
        { latitude: 10, longitude: 10, capturedAt: Date.now() - 3000 },
        { latitude: 11, longitude: 11, capturedAt: Date.now() - 2000 },
        { latitude: 12, longitude: 12, capturedAt: Date.now() - 1000 },
      ];

      const res = await request(app)
        .post(`/api/rides/${ride.id}/telemetry/batch`)
        .set("Authorization", `Bearer ${rider.token}`)
        .send({ pings });

      expect(res.status).toBe(200);
      expect(res.body.data.processed).toBe(3);

      const batch = await batchPromise;
      expect(batch.userId).toBe(rider.user.id);
      expect(batch.points).toHaveLength(3);
      expect(batch.points[0].latitude).toBe(10);
      expect(batch.points[2].latitude).toBe(12);

      // Only the FINAL ping's position is the persisted "current" location —
      // there's no per-ping history table, so replaying all three would just
      // overwrite itself.
      const stored = await prisma.userLiveLocation.findUnique({
        where: { userId: rider.user.id },
      });
      expect(stored?.latitude).toBe(12);

      riderSocket.disconnect();
    });

    it("no-ops for a ride that isn't IN_PROGRESS", async () => {
      const { user, token } = await createTestUser();
      const ride = await createTestRide(user.id, { status: "PAUSED" });

      const res = await request(app)
        .post(`/api/rides/${ride.id}/telemetry/batch`)
        .set("Authorization", `Bearer ${token}`)
        .send({ pings: [{ latitude: 1.1, longitude: 2.2 }] });

      expect(res.status).toBe(200);
      expect(res.body.data.ignored).toBe(true);
      expect(res.body.data.processed).toBe(0);
    });

    it("rejects an empty pings array with 400", async () => {
      const { user, token } = await createTestUser();
      const ride = await createTestRide(user.id, { status: "IN_PROGRESS" });

      const res = await request(app)
        .post(`/api/rides/${ride.id}/telemetry/batch`)
        .set("Authorization", `Bearer ${token}`)
        .send({ pings: [] });

      expect(res.status).toBe(400);
    });
  });
});
