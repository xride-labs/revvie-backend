/**
 * POST /:id/end — concurrent double-completion race.
 *
 * The pre-transaction status check reads outside the transaction, so two
 * requests that both land while the ride is still IN_PROGRESS (a UI
 * double-tap, or a client retry racing the original after a slow/ambiguous
 * response) could both pass it and each run the full summary/XP/badge
 * transaction. Covers the atomic updateMany claim added inside the
 * transaction to fix that.
 */

import request from "supertest";
import { app } from "../../server";
import prisma from "../../lib/prisma";
import { createTestUser, createTestRide, cleanupTestData } from "../../test/utils";
import { XP_REWARDS } from "../../lib/xp";

describe("POST /api/rides/:id/end — concurrent double-completion", () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  it("only completes the ride once when two end requests race, and only grants XP once", async () => {
    const { user, token } = await createTestUser();
    const ride = await createTestRide(user.id, { status: "IN_PROGRESS" });

    const endBody = {
      actualStartTime: new Date(Date.now() - 3600_000).toISOString(),
      actualEndTime: new Date().toISOString(),
      totalDistanceKm: 42,
      avgSpeedKmh: 35,
      maxSpeedKmh: 80,
      endedReason: "USER_ENDED",
    };

    const before = await prisma.user.findUnique({ where: { id: user.id }, select: { xpPoints: true } });

    const [resA, resB] = await Promise.all([
      request(app).post(`/api/rides/${ride.id}/end`).set("Authorization", `Bearer ${token}`).send(endBody),
      request(app).post(`/api/rides/${ride.id}/end`).set("Authorization", `Bearer ${token}`).send(endBody),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly one succeeds (200); the other loses the race and gets the
    // standard "already ended" conflict, same as a genuine sequential retry.
    expect(statuses).toEqual([200, 409]);

    const dbRide = await prisma.ride.findUnique({ where: { id: ride.id } });
    expect(dbRide?.status).toBe("COMPLETED");

    // Only one RideSummary row — the transaction only ran to completion once.
    const summaries = await prisma.rideSummary.findMany({ where: { rideId: ride.id } });
    expect(summaries).toHaveLength(1);

    // awardXp() adds directly onto user.xpPoints (no separate event log) —
    // the delta should be exactly one RIDE_COMPLETED reward, not two.
    // Post-completion rewards run in a fire-and-forget try/catch after the
    // response, so give it a beat to land.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = await prisma.user.findUnique({ where: { id: user.id }, select: { xpPoints: true } });
    expect((after?.xpPoints ?? 0) - (before?.xpPoints ?? 0)).toBe(XP_REWARDS.RIDE_COMPLETED);
  });
});
