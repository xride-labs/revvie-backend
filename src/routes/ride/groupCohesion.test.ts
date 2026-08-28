/**
 * Group cohesion + rider-health detection (socket.ts: evaluateGroupCohesion /
 * sweepUnresponsiveRiders).
 *
 * Covers the two gaps surfaced by the 60-rider club simulation review: a
 * rider drifting far from the group with nobody told ("falling behind"), and
 * a still-connected rider who's stopped producing location fixes with nobody
 * told ("unresponsive" — distinct from a hard disconnect, which the existing
 * disconnect handler already covers). Both thresholds are shortened in
 * NODE_ENV=test (see socket.ts) so this doesn't need real 45-second waits.
 */

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

describe("Group cohesion + rider-health detection", () => {
  beforeAll(async () => {
    await startSocketTestServer();
  });

  afterAll(async () => {
    await stopSocketTestServer();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it("alerts the group when a rider drifts far from everyone else, then clears the alert once they're back", async () => {
    const creator = await createTestUser();
    const other = await createTestUser();
    const drifter = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(other.user.id, ride.id, "ACCEPTED");
    await addRideParticipant(drifter.user.id, ride.id, "ACCEPTED");

    const creatorSocket = await connectTestSocket(creator.token);
    const otherSocket = await connectTestSocket(other.token);
    const drifterSocket = await connectTestSocket(drifter.token);

    try {
      await Promise.all(
        [creatorSocket, otherSocket, drifterSocket].map((s) =>
          emitWithAck(s, "join_ride_tracking", { rideId: ride.id }),
        ),
      );

      // Seed everyone close together first — cohesion needs at least one
      // OTHER recently-cached rider to compute a group centroid against.
      await emitWithAck(creatorSocket, "update_location", {
        latitude: 12.9, longitude: 77.6, isOnRide: true, rideId: ride.id,
      });
      await emitWithAck(otherSocket, "update_location", {
        latitude: 12.901, longitude: 77.601, isOnRide: true, rideId: ride.id,
      });
      await emitWithAck(drifterSocket, "update_location", {
        latitude: 12.9, longitude: 77.6, isOnRide: true, rideId: ride.id,
      });

      // Drifter jumps ~5.5km away — first breach starts the sustained-since
      // clock but shouldn't alert yet.
      let sawAlertEarly = false;
      creatorSocket.once("rider_falling_behind", () => { sawAlertEarly = true; });
      await emitWithAck(drifterSocket, "update_location", {
        latitude: 12.95, longitude: 77.6, isOnRide: true, rideId: ride.id,
      });
      expect(sawAlertEarly).toBe(false);

      // Wait past the (test-shortened) sustained-breach window, then send a
      // second far-away fix — cohesion is only re-evaluated on a new update.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const fallingBehindPromise = waitForEvent<any>(creatorSocket, "rider_falling_behind");
      await emitWithAck(drifterSocket, "update_location", {
        latitude: 12.9501, longitude: 77.6, isOnRide: true, rideId: ride.id,
      });
      const alert = await fallingBehindPromise;
      expect(alert.userId).toBe(drifter.user.id);
      expect(alert.distanceM).toBeGreaterThan(2000);

      // Drifter comes back — should clear the alert.
      const backPromise = waitForEvent<any>(creatorSocket, "rider_back_on_track");
      await emitWithAck(drifterSocket, "update_location", {
        latitude: 12.9, longitude: 77.6, isOnRide: true, rideId: ride.id,
      });
      const back = await backPromise;
      expect(back.userId).toBe(drifter.user.id);
    } finally {
      [creatorSocket, otherSocket, drifterSocket].forEach((s: ClientSocket) => s.disconnect());
    }
  });

  it("does not fire falling-behind for a solo rider with nobody else cached", async () => {
    const creator = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    const socket = await connectTestSocket(creator.token);

    try {
      await emitWithAck(socket, "join_ride_tracking", { rideId: ride.id });
      let sawAlert = false;
      socket.once("rider_falling_behind", () => { sawAlert = true; });
      await emitWithAck(socket, "update_location", {
        latitude: 12.9, longitude: 77.6, isOnRide: true, rideId: ride.id,
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(sawAlert).toBe(false);
    } finally {
      socket.disconnect();
    }
  });

  it("flags a rider unresponsive when their location goes stale, then clears it once fresh fixes resume", async () => {
    const creator = await createTestUser();
    const quiet = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(quiet.user.id, ride.id, "ACCEPTED");

    const creatorSocket = await connectTestSocket(creator.token);
    const quietSocket = await connectTestSocket(quiet.token);

    try {
      await emitWithAck(creatorSocket, "join_ride_tracking", { rideId: ride.id });
      await emitWithAck(quietSocket, "join_ride_tracking", { rideId: ride.id });
      await emitWithAck(creatorSocket, "update_location", {
        latitude: 12.9, longitude: 77.6, isOnRide: true, rideId: ride.id,
      });
      await emitWithAck(quietSocket, "update_location", {
        latitude: 12.91, longitude: 77.61, isOnRide: true, rideId: ride.id,
      });

      // `creator` keeps pinging so it never goes stale itself — otherwise
      // both riders sent exactly one fix and whichever was cached first
      // (creator) crosses the staleness threshold first, racing `quiet`.
      const keepAlive = setInterval(() => {
        creatorSocket.emit("update_location", {
          latitude: 12.9, longitude: 77.6, isOnRide: true, rideId: ride.id,
        });
      }, 50);

      try {
        // `quiet` stops sending updates entirely — the periodic sweep (not a
        // per-update check) should catch the staleness and flag it.
        const unresponsive = await waitForEvent<any>(creatorSocket, "rider_unresponsive");
        expect(unresponsive.userId).toBe(quiet.user.id);

        // A fresh fix should clear the flag on the next sweep tick.
        const responsiveAgain = waitForEvent<any>(creatorSocket, "rider_responsive_again");
        await emitWithAck(quietSocket, "update_location", {
          latitude: 12.911, longitude: 77.611, isOnRide: true, rideId: ride.id,
        });
        const cleared = await responsiveAgain;
        expect(cleared.userId).toBe(quiet.user.id);
      } finally {
        clearInterval(keepAlive);
      }
    } finally {
      creatorSocket.disconnect();
      quietSocket.disconnect();
    }
  });
});
