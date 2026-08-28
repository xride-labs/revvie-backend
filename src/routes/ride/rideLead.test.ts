/**
 * GROUP RIDE LEAD — POST /api/rides/:id/lead
 *
 * A ride's lead is a nullable single FK (Ride.leadUserId), not a
 * per-participant role — see schema.prisma for why. Unset means clients
 * should treat the creator as the de-facto lead.
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

describe("POST /api/rides/:id/lead", () => {
  beforeAll(async () => {
    await startSocketTestServer();
  });

  afterAll(async () => {
    await stopSocketTestServer();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it("lets the creator assign a confirmed participant as lead, and broadcasts it", async () => {
    const creator = await createTestUser();
    const rider = await createTestUser();
    const ride = await createTestRide(creator.user.id);
    await addRideParticipant(rider.user.id, ride.id, "ACCEPTED");

    const riderSocket = await connectTestSocket(rider.token);
    await emitWithAck(riderSocket, "join_ride_tracking", { rideId: ride.id });
    const broadcastPromise = waitForEvent<any>(riderSocket, "ride_lead_changed");

    const res = await request(app)
      .post(`/api/rides/${ride.id}/lead`)
      .set("Authorization", `Bearer ${creator.token}`)
      .send({ userId: rider.user.id });

    expect(res.status).toBe(200);
    expect(res.body.data.ride.leadUserId).toBe(rider.user.id);
    expect(res.body.data.ride.lead.id).toBe(rider.user.id);

    const broadcast = await broadcastPromise;
    expect(broadcast.rideId).toBe(ride.id);
    expect(broadcast.leadUserId).toBe(rider.user.id);

    const dbRide = await prisma.ride.findUnique({ where: { id: ride.id } });
    expect(dbRide?.leadUserId).toBe(rider.user.id);

    riderSocket.disconnect();
  });

  it("lets the creator assign themselves as lead", async () => {
    const creator = await createTestUser();
    const ride = await createTestRide(creator.user.id);

    const res = await request(app)
      .post(`/api/rides/${ride.id}/lead`)
      .set("Authorization", `Bearer ${creator.token}`)
      .send({ userId: creator.user.id });

    expect(res.status).toBe(200);
    expect(res.body.data.ride.leadUserId).toBe(creator.user.id);
  });

  it("lets the creator clear the lead back to unset (null)", async () => {
    const creator = await createTestUser();
    const rider = await createTestUser();
    const ride = await createTestRide(creator.user.id, { leadUserId: null } as any);
    await addRideParticipant(rider.user.id, ride.id, "ACCEPTED");

    await request(app)
      .post(`/api/rides/${ride.id}/lead`)
      .set("Authorization", `Bearer ${creator.token}`)
      .send({ userId: rider.user.id });

    const res = await request(app)
      .post(`/api/rides/${ride.id}/lead`)
      .set("Authorization", `Bearer ${creator.token}`)
      .send({ userId: null });

    expect(res.status).toBe(200);
    expect(res.body.data.ride.leadUserId).toBeNull();
  });

  it("rejects a non-creator with 403", async () => {
    const creator = await createTestUser();
    const rider = await createTestUser();
    const ride = await createTestRide(creator.user.id);
    await addRideParticipant(rider.user.id, ride.id, "ACCEPTED");

    const res = await request(app)
      .post(`/api/rides/${ride.id}/lead`)
      .set("Authorization", `Bearer ${rider.token}`)
      .send({ userId: rider.user.id });

    expect(res.status).toBe(403);
  });

  it("rejects a target who isn't a confirmed participant with 400", async () => {
    const creator = await createTestUser();
    const outsider = await createTestUser();
    const ride = await createTestRide(creator.user.id);

    const res = await request(app)
      .post(`/api/rides/${ride.id}/lead`)
      .set("Authorization", `Bearer ${creator.token}`)
      .send({ userId: outsider.user.id });

    expect(res.status).toBe(400);
  });

  it("rejects a REQUESTED (not yet accepted) participant with 400", async () => {
    const creator = await createTestUser();
    const requester = await createTestUser();
    const ride = await createTestRide(creator.user.id);
    await addRideParticipant(requester.user.id, ride.id, "REQUESTED");

    const res = await request(app)
      .post(`/api/rides/${ride.id}/lead`)
      .set("Authorization", `Bearer ${creator.token}`)
      .send({ userId: requester.user.id });

    expect(res.status).toBe(400);
  });

  it("returns 404 for a nonexistent ride", async () => {
    const { token } = await createTestUser();
    const res = await request(app)
      .post(`/api/rides/${NONEXISTENT_RIDE_ID}/lead`)
      .set("Authorization", `Bearer ${token}`)
      .send({ userId: null });

    expect(res.status).toBe(404);
  });
});
