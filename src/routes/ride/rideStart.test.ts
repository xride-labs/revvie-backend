/**
 * POST /:id/start — explicit "begin now" transition.
 *
 * Before this endpoint existed, a PLANNED ride only became IN_PROGRESS via
 * the 15-minute updateRideStatuses cron once scheduledAt passed. Every
 * telemetry route silently no-ops (`ignored: true`) on a non-IN_PROGRESS
 * ride, so tapping "Start Live Ride" didn't actually start tracking —
 * this closes that gap.
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

describe("POST /api/rides/:id/start", () => {
  beforeAll(async () => {
    await startSocketTestServer();
  });

  afterAll(async () => {
    await stopSocketTestServer();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it("creator can start a PLANNED ride, which broadcasts ride_status_changed", async () => {
    const creator = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "PLANNED" });

    const socket = await connectTestSocket(creator.token);
    try {
      await emitWithAck(socket, "join_ride_tracking", { rideId: ride.id });
      const changedPromise = waitForEvent<any>(socket, "ride_status_changed");

      const res = await request(app)
        .post(`/api/rides/${ride.id}/start`)
        .set("Authorization", `Bearer ${creator.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("IN_PROGRESS");

      const changed = await changedPromise;
      expect(changed.rideId).toBe(ride.id);
      expect(changed.status).toBe("IN_PROGRESS");

      const dbRide = await prisma.ride.findUnique({ where: { id: ride.id } });
      expect(dbRide?.status).toBe("IN_PROGRESS");
    } finally {
      socket.disconnect();
    }
  });

  it("an accepted participant (not the creator) can also start the ride", async () => {
    const creator = await createTestUser();
    const rider = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "PLANNED" });
    await addRideParticipant(rider.user.id, ride.id, "ACCEPTED");

    const res = await request(app)
      .post(`/api/rides/${ride.id}/start`)
      .set("Authorization", `Bearer ${rider.token}`);
    expect(res.status).toBe(200);
  });

  it("rejects a user who isn't the creator or an accepted participant", async () => {
    const creator = await createTestUser();
    const outsider = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "PLANNED" });

    const res = await request(app)
      .post(`/api/rides/${ride.id}/start`)
      .set("Authorization", `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);

    const dbRide = await prisma.ride.findUnique({ where: { id: ride.id } });
    expect(dbRide?.status).toBe("PLANNED");
  });

  it("treats starting an already-IN_PROGRESS ride as a harmless no-op", async () => {
    const creator = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "IN_PROGRESS" });

    const res = await request(app)
      .post(`/api/rides/${ride.id}/start`)
      .set("Authorization", `Bearer ${creator.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("IN_PROGRESS");
  });

  it("rejects starting a COMPLETED ride", async () => {
    const creator = await createTestUser();
    const ride = await createTestRide(creator.user.id, { status: "COMPLETED" });

    const res = await request(app)
      .post(`/api/rides/${ride.id}/start`)
      .set("Authorization", `Bearer ${creator.token}`);
    expect(res.status).toBe(400);
  });
});
