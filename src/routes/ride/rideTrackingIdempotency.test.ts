/**
 * POST /:id/tracking — completion idempotency.
 *
 * `justFinished` used to compare the persisted actualEndTime to the
 * submitted one, which is true again on every retry of the same upload —
 * awardXp('RIDE_COMPLETED') fired on every retry instead of once. Fixed to
 * detect the actual no-end-time -> has-end-time transition.
 */

import request from "supertest";
import { app } from "../../server";
import prisma from "../../lib/prisma";
import { createTestUser, createTestRide, cleanupTestData } from "../../test/utils";
import { XP_REWARDS } from "../../lib/xp";

describe("POST /api/rides/:id/tracking — completion idempotency", () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  it("awards RIDE_COMPLETED XP only once across repeated uploads with the same actualEndTime", async () => {
    const { user, token } = await createTestUser();
    const ride = await createTestRide(user.id, { status: "IN_PROGRESS" });
    const before = await prisma.user.findUnique({ where: { id: user.id }, select: { xpPoints: true } });

    const body = {
      actualStartTime: new Date(Date.now() - 3600_000).toISOString(),
      actualEndTime: new Date().toISOString(),
      totalDistanceKm: 30,
    };

    const first = await request(app)
      .post(`/api/rides/${ride.id}/tracking`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    expect(first.status).toBe(200);

    // Simulate a client retry (network timeout / ambiguous response) with
    // the exact same payload, twice more.
    for (let i = 0; i < 2; i++) {
      const retry = await request(app)
        .post(`/api/rides/${ride.id}/tracking`)
        .set("Authorization", `Bearer ${token}`)
        .send(body);
      expect(retry.status).toBe(200);
    }

    const after = await prisma.user.findUnique({ where: { id: user.id }, select: { xpPoints: true } });
    expect((after?.xpPoints ?? 0) - (before?.xpPoints ?? 0)).toBe(XP_REWARDS.RIDE_COMPLETED);
  });

  it("still awards XP exactly once when two uploads race concurrently", async () => {
    const { user, token } = await createTestUser();
    const ride = await createTestRide(user.id, { status: "IN_PROGRESS" });
    const before = await prisma.user.findUnique({ where: { id: user.id }, select: { xpPoints: true } });

    const body = {
      actualStartTime: new Date(Date.now() - 3600_000).toISOString(),
      actualEndTime: new Date().toISOString(),
      totalDistanceKm: 30,
    };

    await Promise.all([
      request(app).post(`/api/rides/${ride.id}/tracking`).set("Authorization", `Bearer ${token}`).send(body),
      request(app).post(`/api/rides/${ride.id}/tracking`).set("Authorization", `Bearer ${token}`).send(body),
    ]);

    const after = await prisma.user.findUnique({ where: { id: user.id }, select: { xpPoints: true } });
    expect((after?.xpPoints ?? 0) - (before?.xpPoints ?? 0)).toBe(XP_REWARDS.RIDE_COMPLETED);
  });

  it("does not award completion XP for an upload with no actualEndTime (in-progress checkpoint)", async () => {
    const { user, token } = await createTestUser();
    const ride = await createTestRide(user.id, { status: "IN_PROGRESS" });
    const before = await prisma.user.findUnique({ where: { id: user.id }, select: { xpPoints: true } });

    const res = await request(app)
      .post(`/api/rides/${ride.id}/tracking`)
      .set("Authorization", `Bearer ${token}`)
      .send({ totalDistanceKm: 10 });
    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: user.id }, select: { xpPoints: true } });
    expect(after?.xpPoints ?? 0).toBe(before?.xpPoints ?? 0);
  });
});
