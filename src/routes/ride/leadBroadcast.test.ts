/**
 * Regroup point + lead-reroute broadcast (socket.ts: regroup:set/clear,
 * evaluateRegroupArrival, route:updated) — "reach the whole group" actions
 * gated to the ride's creator or lead via isCreatorOrLead.
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

// One server lifecycle for the whole file — startSocketTestServer's
// singleton is only idempotent *within* a file, so two `describe` blocks
// each starting/stopping it independently races the shared httpServer's
// listen/close (observed as spurious "handleUpgrade called twice" errors).
beforeAll(async () => {
  await startSocketTestServer();
});

afterAll(async () => {
  await stopSocketTestServer();
});

afterEach(async () => {
  await cleanupTestData();
});

describe("Regroup point", () => {

  it("lets the creator drop a regroup point and tracks arrivals until everyone's there", async () => {
    const creator = await createTestUser();
    const riderA = await createTestUser();
    const riderB = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(riderA.user.id, ride.id, "ACCEPTED");
    await addRideParticipant(riderB.user.id, ride.id, "ACCEPTED");

    const creatorSocket = await connectTestSocket(creator.token);
    const socketA = await connectTestSocket(riderA.token);
    const socketB = await connectTestSocket(riderB.token);

    try {
      await Promise.all(
        [creatorSocket, socketA, socketB].map((s) => emitWithAck(s, "join_ride_tracking", { rideId: ride.id })),
      );
      // Seed the cache so `totalExpected` (rideRiderCache size) is 3.
      await Promise.all(
        [
          [creatorSocket, 10, 10],
          [socketA, 10.001, 10.001],
          [socketB, 10.002, 10.002],
        ].map(([s, lat, lon]: any) =>
          emitWithAck(s, "update_location", { latitude: lat, longitude: lon, isOnRide: true, rideId: ride.id }),
        ),
      );

      const pointSetPromise = waitForEvent<any>(socketA, "regroup:point_set");
      const setAck = await emitWithAck<{ success: boolean }>(creatorSocket, "regroup:set", {
        rideId: ride.id,
        latitude: 11,
        longitude: 11,
        label: "Gas station",
      });
      expect(setAck.success).toBe(true);
      const pointSet = await pointSetPromise;
      expect(pointSet.label).toBe("Gas station");
      expect(pointSet.setBy).toBe(creator.user.id);

      // Rider A arrives (within REGROUP_ARRIVAL_RADIUS_M).
      const arrivedPromise = waitForEvent<any>(creatorSocket, "regroup:rider_arrived");
      await emitWithAck(socketA, "update_location", { latitude: 11, longitude: 11, isOnRide: true, rideId: ride.id });
      const arrived = await arrivedPromise;
      expect(arrived.userId).toBe(riderA.user.id);
      expect(arrived.arrivedCount).toBe(1);

      // Creator and rider B arrive too — should trigger regroup:complete.
      const completePromise = waitForEvent<any>(creatorSocket, "regroup:complete");
      await emitWithAck(creatorSocket, "update_location", { latitude: 11, longitude: 11, isOnRide: true, rideId: ride.id });
      await emitWithAck(socketB, "update_location", { latitude: 11, longitude: 11, isOnRide: true, rideId: ride.id });
      await completePromise;
    } finally {
      [creatorSocket, socketA, socketB].forEach((s) => s.disconnect());
    }
  });

  it("rejects regroup:set from a rider who is neither creator nor lead", async () => {
    const creator = await createTestUser();
    const rider = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(rider.user.id, ride.id, "ACCEPTED");

    const riderSocket = await connectTestSocket(rider.token);
    try {
      const ack = await emitWithAck<{ success: boolean }>(riderSocket, "regroup:set", {
        rideId: ride.id,
        latitude: 1,
        longitude: 1,
      });
      expect(ack.success).toBe(false);
    } finally {
      riderSocket.disconnect();
    }
  });

  it("the assigned lead (not just the creator) can also set/clear a regroup point", async () => {
    const creator = await createTestUser();
    const lead = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS", leadUserId: lead.user.id });
    await addRideParticipant(lead.user.id, ride.id, "ACCEPTED");

    const leadSocket = await connectTestSocket(lead.token);
    try {
      const setAck = await emitWithAck<{ success: boolean }>(leadSocket, "regroup:set", {
        rideId: ride.id,
        latitude: 2,
        longitude: 2,
      });
      expect(setAck.success).toBe(true);

      const clearAck = await emitWithAck<{ success: boolean }>(leadSocket, "regroup:clear", { rideId: ride.id });
      expect(clearAck.success).toBe(true);
    } finally {
      leadSocket.disconnect();
    }
  });
});

describe("Lead reroute broadcast", () => {
  it("relays the lead's updated route to followers", async () => {
    const creator = await createTestUser();
    const follower = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(follower.user.id, ride.id, "ACCEPTED");

    const creatorSocket = await connectTestSocket(creator.token);
    const followerSocket = await connectTestSocket(follower.token);

    try {
      await emitWithAck(creatorSocket, "join_ride_tracking", { rideId: ride.id });
      await emitWithAck(followerSocket, "join_ride_tracking", { rideId: ride.id });

      const updatedPromise = waitForEvent<any>(followerSocket, "route_updated");
      const ack = await emitWithAck<{ success: boolean }>(creatorSocket, "route:updated", {
        rideId: ride.id,
        endLat: 5,
        endLng: 5,
        endLocation: "New destination",
        reason: "off_route_reroute",
      });
      expect(ack.success).toBe(true);

      const updated = await updatedPromise;
      expect(updated.endLat).toBe(5);
      expect(updated.updatedBy).toBe(creator.user.id);
    } finally {
      creatorSocket.disconnect();
      followerSocket.disconnect();
    }
  });

  it("rejects route:updated from a rider who is neither creator nor lead", async () => {
    const creator = await createTestUser();
    const rider = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(rider.user.id, ride.id, "ACCEPTED");

    const riderSocket = await connectTestSocket(rider.token);
    try {
      const ack = await emitWithAck<{ success: boolean }>(riderSocket, "route:updated", {
        rideId: ride.id,
        endLat: 1,
        endLng: 1,
      });
      expect(ack.success).toBe(false);
    } finally {
      riderSocket.disconnect();
    }
  });
});
