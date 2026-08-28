/**
 * CLUB RIDE SIMULATION — 60-member group ride, real edge cases.
 *
 * Replicates a club-organized ride at scale against the REAL backend (real
 * Postgres, real Socket.IO server, real rate limiter, real Redis cache if
 * configured) — not mocks. Models the exact end-state a club/friend-group
 * ride produces (a Ride row + 60 ACCEPTED RideParticipant rows), since
 * that's what the tracking/socket layer actually operates on regardless of
 * whether the ride was created via the club flow or a direct multi-invite
 * (both land in the same tables).
 *
 * This is intentionally ONE long narrative test rather than many small
 * ones — spinning up 60 users + 60 socket connections is expensive, and
 * the point is to see how the system behaves as state accumulates across a
 * single ride, the way a real 60-rider club ride would.
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
import type { Socket as ClientSocket } from "socket.io-client";

const CLUB_SIZE = 60;
const SIM_TIMEOUT_MS = 180_000;

describe("60-member club ride simulation", () => {
  beforeAll(async () => {
    await startSocketTestServer();
  });

  afterAll(async () => {
    await stopSocketTestServer();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it(
    "handles a full 60-rider club ride: joins, telemetry burst, SOS, calls, breaks, an unresponsive rider, and clean end",
    async () => {
      const timings: Record<string, number> = {};
      const mark = (label: string, t0: number) => {
        timings[label] = Date.now() - t0;
      };

      // ── Phase 1: club roster + ride ─────────────────────────────────
      let t0 = Date.now();
      const creator = await createTestUser({ name: "Club Lead" });
      const members = await Promise.all(
        Array.from({ length: CLUB_SIZE - 1 }, (_, i) => createTestUser({ name: `Rider ${i + 1}` })),
      );
      const ride = await createTestRide(creator.user.id, {
        title: "Weekend Club Run",
        status: "IN_PROGRESS",
        startLat: 12.9716,
        startLng: 77.5946,
        endLat: 13.05,
        endLng: 77.65,
      });
      await Promise.all(members.map((m) => addRideParticipant(m.user.id, ride.id, "ACCEPTED")));
      // Creator leads by default, but exercise the explicit lead-assignment
      // path too, matching what a real club ride organizer would do.
      const leadRes = await request(app)
        .post(`/api/rides/${ride.id}/lead`)
        .set("Authorization", `Bearer ${creator.token}`)
        .send({ userId: creator.user.id });
      expect(leadRes.status).toBe(200);
      mark("setup_60_users_and_ride", t0);

      const allRiders = [creator, ...members]; // index 0 = lead

      // ── Phase 2: everyone connects and joins tracking ──────────────
      t0 = Date.now();
      const sockets: ClientSocket[] = await Promise.all(
        allRiders.map((r) => connectTestSocket(r.token)),
      );
      mark("connect_60_sockets", t0);

      t0 = Date.now();
      const joinAcks = await Promise.all(
        sockets.map((s) => emitWithAck<{ success: boolean; riders?: any[] }>(s, "join_ride_tracking", { rideId: ride.id })),
      );
      expect(joinAcks.every((a) => a.success)).toBe(true);
      mark("join_ride_tracking_x60", t0);

      // ── Phase 3: everyone pings an initial location; verify the cache
      // holds all 60 for a late joiner (the real "does group tracking
      // actually scale" question). ───────────────────────────────────
      t0 = Date.now();
      const baseLat = 12.9716;
      const baseLng = 77.5946;
      await Promise.all(
        sockets.map((s, i) =>
          emitWithAck(s, "update_location", {
            latitude: baseLat + i * 0.0005, // spread riders out along the route
            longitude: baseLng + i * 0.0003,
            isOnRide: true,
            rideId: ride.id,
            isMoving: true,
          }),
        ),
      );
      mark("initial_location_burst_x60", t0);

      // Give broadcasts/cache writes a beat, then check a late joiner sees
      // everyone.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const lateJoiner = await createTestUser({ name: "Late Joiner" });
      await addRideParticipant(lateJoiner.user.id, ride.id, "ACCEPTED");
      const lateSocket = await connectTestSocket(lateJoiner.token);
      const lateAck = await emitWithAck<{ riders: any[] }>(lateSocket, "join_ride_tracking", { rideId: ride.id });
      expect(lateAck.riders.length).toBe(CLUB_SIZE);
      lateSocket.disconnect();

      // ── Phase 4: sustained riding — 5 more ticks from everyone (a
      // realistic short burst), confirm no drops/errors and the
      // per-participant rate limiter (fixed in the earlier review pass)
      // doesn't false-positive across 60 riders sharing one test-runner IP.
      t0 = Date.now();
      for (let tick = 0; tick < 5; tick++) {
        await Promise.all(
          sockets.map((s, i) =>
            emitWithAck<{ success: boolean }>(s, "update_location", {
              latitude: baseLat + i * 0.0005 + tick * 0.0002,
              longitude: baseLng + i * 0.0003 + tick * 0.0001,
              isOnRide: true,
              rideId: ride.id,
              isMoving: true,
            }).then((ack) => expect(ack.success).toBe(true)),
          ),
        );
      }
      mark("sustained_riding_5_ticks_x60", t0);

      // Cross-check via REST telemetry too (the mobile app's primary path,
      // not just the socket path) — per-(user,ride) rate limit should give
      // each rider their own headroom.
      const telemetryRes = await request(app)
        .post(`/api/rides/${ride.id}/telemetry`)
        .set("Authorization", `Bearer ${allRiders[10].token}`)
        .send({ latitude: baseLat, longitude: baseLng, speed: 45 });
      expect(telemetryRes.status).toBe(200);
      expect(telemetryRes.headers["ratelimit-limit"]).toBeDefined();

      // ── Phase 5: "a rider pings for assistance" (SOS) ───────────────
      t0 = Date.now();
      const sosRider = allRiders[25];
      const sosAck = await emitWithAck<{ success: boolean }>(sockets[25], "trigger_emergency", {
        rideId: ride.id,
        latitude: baseLat + 25 * 0.0005,
        longitude: baseLng + 25 * 0.0003,
        message: "Went down on gravel — need help",
      });
      expect(sosAck.success).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 400)); // post-ack async notification fanout
      const sosNotifications = await prisma.notification.findMany({
        where: { relatedId: ride.id, type: "SOS_ALERT" },
      });
      // Every OTHER participant gets notified (59), not the sender.
      expect(sosNotifications.length).toBe(CLUB_SIZE - 1);
      expect(sosNotifications.some((n) => n.userId === sosRider.user.id)).toBe(false);
      mark("sos_fanout_to_59_participants", t0);

      // ── Phase 6: "radio calls" — 1:1 rider-to-lead call ─────────────
      t0 = Date.now();
      const callerIdx = 40;
      const incomingPromise = waitForEvent<any>(sockets[0], "call:incoming");
      const callAck = await emitWithAck<{ success: boolean; callId: string }>(
        sockets[callerIdx],
        "call:invite",
        { toUserId: creator.user.id, rideId: ride.id },
      );
      expect(callAck.success).toBe(true);
      const incoming = await incomingPromise;
      expect(incoming.fromUserId).toBe(allRiders[callerIdx].user.id);

      // While the lead is ringing/on this call, a SECOND rider trying to
      // reach them should be told the lead is busy — there's no group
      // "radio" broadcast, calling is strictly 1:1, so this is the expected
      // (if limiting) behavior for a 60-rider club, worth knowing about.
      const secondCallAck = await emitWithAck<{ success: boolean; code?: string }>(
        sockets[41],
        "call:invite",
        { toUserId: creator.user.id, rideId: ride.id },
      );
      expect(secondCallAck.success).toBe(false);
      expect(secondCallAck.code).toBe("CALLEE_BUSY");

      await emitWithAck(sockets[0], "call:respond", { callId: incoming.callId, accepted: true });
      await emitWithAck(sockets[callerIdx], "call:end", { callId: incoming.callId });
      mark("call_lead_plus_busy_rejection", t0);

      // ── Phase 7: "stops in between" — a rider takes a break via REST ──
      t0 = Date.now();
      const breakRider = allRiders[15];
      const startBreakRes = await request(app)
        .post(`/api/rides/${ride.id}/breaks`)
        .set("Authorization", `Bearer ${breakRider.token}`)
        .send({ type: "FUEL", latitude: baseLat, longitude: baseLng });
      expect(startBreakRes.status).toBe(201);
      const breakId = startBreakRes.body.data.break.id;

      // Rest of the group keeps moving/broadcasting fine while one rider
      // is stopped — nothing in the backend gates on "everyone present."
      await emitWithAck<{ success: boolean }>(sockets[16], "update_location", {
        latitude: baseLat + 16 * 0.0005 + 0.001,
        longitude: baseLng + 16 * 0.0003,
        isOnRide: true,
        rideId: ride.id,
        isMoving: true,
      }).then((ack) => expect(ack.success).toBe(true));

      const endBreakRes = await request(app)
        .patch(`/api/rides/${ride.id}/breaks/${breakId}/end`)
        .set("Authorization", `Bearer ${breakRider.token}`)
        .send({});
      expect(endBreakRes.status).toBe(200);
      mark("break_start_and_end", t0);

      // ── Phase 8: "diverts" — a rider goes off the planned route ─────
      // There's no server-side route/divert modeling at all — off-route
      // detection and rerouting are entirely client-side (map-provider.ts
      // re-fetching directions). The backend's only involvement is that
      // telemetry keeps flowing normally regardless of the path's shape,
      // which this confirms — NOT a divert-aware feature, because none
      // exists server-side.
      const divertRider = allRiders[30];
      const divertRes = await request(app)
        .post(`/api/rides/${ride.id}/telemetry`)
        .set("Authorization", `Bearer ${divertRider.token}`)
        .send({ latitude: baseLat + 0.05, longitude: baseLng - 0.05, speed: 20 }); // well off the planned line
      expect(divertRes.status).toBe(200);

      // ── Phase 9: "a rider is falling behind" ────────────────────────
      // Simulate rider 50 lagging further and further from the group's
      // average position over several ticks. IMPORTANT FINDING: nothing
      // server-side computes group cohesion or fires any kind of
      // "falling behind" signal — this loop passes because the backend
      // accepts the pings, not because anything detects the situation.
      // (See the client-side ETA-per-rider display in live.tsx — that's a
      // per-rider visual only, not a group-aware alert either.)
      const laggingRider = allRiders[50];
      let laggingOffsetKm = 0.001;
      for (let tick = 0; tick < 4; tick++) {
        laggingOffsetKm += 0.01; // falls further behind each tick
        const ack = await emitWithAck<{ success: boolean }>(sockets[50], "update_location", {
          latitude: baseLat - laggingOffsetKm,
          longitude: baseLng - laggingOffsetKm,
          isOnRide: true,
          rideId: ride.id,
          isMoving: true,
        });
        expect(ack.success).toBe(true);
      }
      // No alert event of any kind was emitted anywhere for this — verified
      // implicitly: the only events the lead's socket receives are the
      // ordinary rider_location_updated ticks, confirmed by the absence of
      // any "cohesion"/"lagging"/"behind" event name anywhere in socket.ts.

      // ── Phase 10: "a rider is unresponsive" — abrupt disconnect,
      // not a graceful leave_ride_tracking (simulates a crashed app / dead
      // battery / lost signal, not someone tapping "leave ride"). ───────
      t0 = Date.now();
      const unresponsiveIdx = 55;
      const leftEventPromise = waitForEvent<{ userId: string }>(sockets[0], "rider_left_tracking");
      sockets[unresponsiveIdx].disconnect(); // no leave_ride_tracking emitted first
      const leftEvent = await leftEventPromise;
      expect(leftEvent.userId).toBe(allRiders[unresponsiveIdx].user.id);
      mark("unresponsive_rider_disconnect_cleanup", t0);

      // Confirmed cleaned up server-side (not just "an event fired") — a
      // fresh joiner shouldn't see them in the cached snapshot.
      const checkJoiner = await createTestUser({ name: "Cache Checker" });
      await addRideParticipant(checkJoiner.user.id, ride.id, "ACCEPTED");
      const checkSocket = await connectTestSocket(checkJoiner.token);
      const checkAck = await emitWithAck<{ riders: any[] }>(checkSocket, "join_ride_tracking", { rideId: ride.id });
      expect(checkAck.riders.some((r) => r.userId === allRiders[unresponsiveIdx].user.id)).toBe(false);
      checkSocket.disconnect();
      // IMPORTANT FINDING: this is indistinguishable server-side from a
      // rider who politely closed the app after a normal ride — there's no
      // "went silent mid-ride without ending it" alert either (no
      // server-side staleness timer at all; the only staleness handling is
      // the client's own 45s-old visual dimming of a rider's marker, which
      // nobody else is notified about).

      // ── Phase 11: end the ride with 60 (well, 61 including the checker
      // who never actually tracked, minus the one who disconnected —
      // net still dozens of real participants) rows to update. ─────────
      t0 = Date.now();
      const endRes = await request(app)
        .post(`/api/rides/${ride.id}/end`)
        .set("Authorization", `Bearer ${creator.token}`)
        .send({
          actualStartTime: new Date(Date.now() - 2 * 3600_000).toISOString(),
          actualEndTime: new Date().toISOString(),
          totalDistanceKm: 55,
          avgSpeedKmh: 38,
          maxSpeedKmh: 90,
          endedReason: "USER_ENDED",
        });
      expect(endRes.status).toBe(200);
      mark("end_ride_with_60_participants", t0);

      sockets.forEach((s) => s.disconnect());

      // eslint-disable-next-line no-console
      console.log("[club ride simulation] timings (ms):", timings);
    },
    SIM_TIMEOUT_MS,
  );
});
