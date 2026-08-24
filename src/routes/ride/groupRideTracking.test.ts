/**
 * GROUP RIDE TRACKING — multi-client simulation
 *
 * The concrete "proper testing for group tracking" the ride-tracking
 * stabilization work asked for: several riders' sockets joined to the same
 * ride, each pushing location updates, asserting every other rider actually
 * receives them, a late joiner gets everyone's cached position immediately,
 * and disconnect cleanup actually removes a rider from the room/cache.
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

const RIDER_COUNT = 4;

describe("Group ride live tracking (multi-socket)", () => {
  beforeAll(async () => {
    await startSocketTestServer();
  });

  afterAll(async () => {
    await stopSocketTestServer();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it("broadcasts each rider's location update to every other rider in the ride", async () => {
    const creator = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });

    const riders = await Promise.all(
      Array.from({ length: RIDER_COUNT }, () => createTestUser()),
    );
    await Promise.all(
      riders.map((r) => addRideParticipant(r.user.id, ride.id, "ACCEPTED")),
    );

    const sockets: ClientSocket[] = await Promise.all(
      riders.map((r) => connectTestSocket(r.token)),
    );

    try {
      // Every rider joins the ride's tracking room.
      await Promise.all(
        sockets.map((s) => emitWithAck(s, "join_ride_tracking", { rideId: ride.id })),
      );

      // Rider 0 sends an update; every OTHER rider's socket should receive it.
      const listeners = sockets
        .slice(1)
        .map((s) => waitForEvent<any>(s, "rider_location_updated"));

      sockets[0].emit("update_location", {
        latitude: 12.9,
        longitude: 77.6,
        isOnRide: true,
        rideId: ride.id,
      });

      const received = await Promise.all(listeners);
      for (const payload of received) {
        expect(payload.userId).toBe(riders[0].user.id);
        expect(payload.latitude).toBeCloseTo(12.9, 5);
      }

      // The sender itself should NOT receive its own broadcast back (socket.to()
      // excludes the sender by design) — a stale test-double using io.to()
      // instead would fail this.
      let selfReceived = false;
      sockets[0].once("rider_location_updated", () => {
        selfReceived = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(selfReceived).toBe(false);
    } finally {
      sockets.forEach((s) => s.disconnect());
    }
  });

  it("gives a late joiner every rider's cached last-known position via the join ack", async () => {
    const creator = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });

    const early = await Promise.all(
      Array.from({ length: RIDER_COUNT - 1 }, () => createTestUser()),
    );
    const late = await createTestUser();
    await Promise.all(
      [...early, late].map((r) => addRideParticipant(r.user.id, ride.id, "ACCEPTED")),
    );

    const earlySockets = await Promise.all(early.map((r) => connectTestSocket(r.token)));
    try {
      // Each early rider joins and pushes one location update so they land
      // in the ride's rider cache.
      for (let i = 0; i < earlySockets.length; i++) {
        await emitWithAck(earlySockets[i], "join_ride_tracking", { rideId: ride.id });
        await emitWithAck(earlySockets[i], "update_location", {
          latitude: 10 + i,
          longitude: 20 + i,
          isOnRide: true,
          rideId: ride.id,
        });
      }

      const lateSocket = await connectTestSocket(late.token);
      try {
        const ack = await emitWithAck<{ success: boolean; riders: any[] }>(
          lateSocket,
          "join_ride_tracking",
          { rideId: ride.id },
        );

        expect(ack.success).toBe(true);
        expect(ack.riders.length).toBe(earlySockets.length);
        const cachedUserIds = ack.riders.map((r: any) => r.userId).sort();
        const expectedUserIds = early.map((r) => r.user.id).sort();
        expect(cachedUserIds).toEqual(expectedUserIds);
      } finally {
        lateSocket.disconnect();
      }
    } finally {
      earlySockets.forEach((s) => s.disconnect());
    }
  });

  it("notifies the rest of the group and cleans up server-side state when a rider disconnects", async () => {
    const creator = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });

    const riderA = await createTestUser();
    const riderB = await createTestUser();
    await addRideParticipant(riderA.user.id, ride.id, "ACCEPTED");
    await addRideParticipant(riderB.user.id, ride.id, "ACCEPTED");

    const socketA = await connectTestSocket(riderA.token);
    const socketB = await connectTestSocket(riderB.token);

    try {
      await emitWithAck(socketA, "join_ride_tracking", { rideId: ride.id });
      await emitWithAck(socketB, "join_ride_tracking", { rideId: ride.id });
      await emitWithAck(socketA, "update_location", {
        latitude: 5,
        longitude: 5,
        isOnRide: true,
        rideId: ride.id,
      });

      const leftPromise = waitForEvent<{ userId: string }>(socketB, "rider_left_tracking");
      socketA.disconnect();
      const leftPayload = await leftPromise;
      expect(leftPayload.userId).toBe(riderA.user.id);

      // A late joiner after A's disconnect should no longer see A in the
      // cached snapshot — confirms removeCachedRider actually ran.
      const socketC = await connectTestSocket((await createTestUser()).token);
      try {
        const ack = await emitWithAck<{ riders: any[] }>(socketC, "join_ride_tracking", {
          rideId: ride.id,
        });
        expect(ack.riders.some((r: any) => r.userId === riderA.user.id)).toBe(false);
      } finally {
        socketC.disconnect();
      }
    } finally {
      socketB.disconnect();
    }
  });
});
