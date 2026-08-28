/**
 * Group Ride Report — the SOS/falling-behind/unresponsive tallies socket.ts
 * accumulates over a ride's lifetime (see RideEventCounters), snapshotted
 * onto RideSummary at end-of-ride and cleared right after.
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
  emitWithAck,
} from "../../test/socketTestServer";
import { getRideEventCounters } from "../../lib/socket";

describe("Group Ride Report (RideSummary sos/cohesion tallies)", () => {
  beforeAll(async () => {
    await startSocketTestServer();
  });

  afterAll(async () => {
    await stopSocketTestServer();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it("persists the SOS count into the ride summary and clears the in-memory tally afterward", async () => {
    const creator = await createTestUser();
    const rider = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });
    await addRideParticipant(rider.user.id, ride.id, "ACCEPTED");

    const creatorSocket = await connectTestSocket(creator.token);
    const riderSocket = await connectTestSocket(rider.token);

    try {
      await emitWithAck(creatorSocket, "join_ride_tracking", { rideId: ride.id });
      await emitWithAck(riderSocket, "join_ride_tracking", { rideId: ride.id });

      const sosAck = await emitWithAck<{ success: boolean }>(creatorSocket, "trigger_emergency", {
        rideId: ride.id,
        latitude: 12.9,
        longitude: 77.6,
        message: "Went down on a corner",
      });
      expect(sosAck.success).toBe(true);
      expect(getRideEventCounters(ride.id).sosCount).toBe(1);
    } finally {
      creatorSocket.disconnect();
      riderSocket.disconnect();
    }

    const endRes = await request(app)
      .post(`/api/rides/${ride.id}/end`)
      .set("Authorization", `Bearer ${creator.token}`)
      .send({
        actualStartTime: new Date(Date.now() - 3600_000).toISOString(),
        actualEndTime: new Date().toISOString(),
        totalDistanceKm: 40,
        avgSpeedKmh: 35,
        maxSpeedKmh: 80,
      });
    expect(endRes.status).toBe(200);

    const summary = await prisma.rideSummary.findUnique({ where: { rideId: ride.id } });
    expect(summary?.sosCount).toBe(1);
    expect(summary?.fallingBehindEvents).toBe(0);
    expect(summary?.unresponsiveEvents).toBe(0);

    // Cleared after being snapshotted so a later ride doesn't inherit it.
    expect(getRideEventCounters(ride.id)).toEqual({
      fallingBehindEvents: 0,
      unresponsiveEvents: 0,
      sosCount: 0,
    });
  });

  it("defaults every tally to 0 for an uneventful ride", async () => {
    const creator = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });

    const endRes = await request(app)
      .post(`/api/rides/${ride.id}/end`)
      .set("Authorization", `Bearer ${creator.token}`)
      .send({
        actualStartTime: new Date(Date.now() - 1800_000).toISOString(),
        actualEndTime: new Date().toISOString(),
        totalDistanceKm: 15,
      });
    expect(endRes.status).toBe(200);

    const summary = await prisma.rideSummary.findUnique({ where: { rideId: ride.id } });
    expect(summary?.sosCount).toBe(0);
    expect(summary?.fallingBehindEvents).toBe(0);
    expect(summary?.unresponsiveEvents).toBe(0);
  });
});
