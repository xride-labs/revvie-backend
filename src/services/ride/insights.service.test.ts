import { afterEach, describe, expect, it } from "vitest";
import prisma from "../../lib/prisma.js";
import { cleanupTestData, createTestRide, createTestUser } from "../../test/utils.js";
import { getRideInsights } from "./insights.service.js";

async function completeRide(
  creatorId: string,
  overrides: Record<string, unknown> = {},
) {
  const ride = await createTestRide(creatorId, {
    status: "COMPLETED",
    endedAt: new Date("2026-09-20T10:00:00.000Z"),
    ...overrides,
  });
  return ride;
}

async function attachMetrics(
  rideId: string,
  values: {
    distanceKm: number;
    movingTimeSec?: number;
    elevationGainM?: number;
    avgSpeedKmh?: number;
    routeGeoJson?: string;
  },
) {
  await prisma.rideTrackingData.create({
    data: {
      rideId,
      totalDistanceKm: values.distanceKm,
      totalDurationMin: Math.round((values.movingTimeSec ?? 0) / 60),
      avgSpeedKmh: values.avgSpeedKmh ?? 0,
      routeGeoJson: values.routeGeoJson,
    },
  });
  await prisma.rideSummary.create({
    data: {
      rideId,
      totalDistanceKm: values.distanceKm,
      totalDurationSec: values.movingTimeSec ?? 0,
      movingTimeSec: values.movingTimeSec ?? 0,
      elevationGainM: values.elevationGainM ?? 0,
      avgSpeedKmh: values.avgSpeedKmh ?? 0,
      badges: [],
    },
  });
}

afterEach(async () => {
  await prisma.rideSummary.deleteMany({});
  await prisma.rideTrackingData.deleteMany({});
  await prisma.rideParticipant.deleteMany({});
  await prisma.ride.deleteMany({});
  await cleanupTestData();
});

describe("getRideInsights", () => {
  it("aggregates a caller's completed creator and participant rides only once", async () => {
    const caller = await createTestUser();
    const other = await createTestUser();

    const ownRide = await completeRide(caller.user.id, {
      title: "Own completed ride",
      endedAt: new Date("2026-09-10T10:00:00.000Z"),
    });
    await prisma.rideParticipant.create({
      data: { rideId: ownRide.id, userId: caller.user.id, status: "COMPLETED" },
    });
    await attachMetrics(ownRide.id, {
      distanceKm: 120,
      movingTimeSec: 7200,
      elevationGainM: 800,
      avgSpeedKmh: 60,
      routeGeoJson: JSON.stringify({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[77.59, 12.97], [77.61, 12.98]],
        },
      }),
    });

    const participantRide = await completeRide(other.user.id, {
      title: "Completed with friends",
      endedAt: new Date("2026-08-10T10:00:00.000Z"),
    });
    await prisma.rideParticipant.create({
      data: {
        rideId: participantRide.id,
        userId: caller.user.id,
        status: "COMPLETED",
      },
    });
    await attachMetrics(participantRide.id, {
      distanceKm: 80,
      movingTimeSec: 3600,
      elevationGainM: 200,
      avgSpeedKmh: 40,
    });

    const privateOtherRide = await completeRide(other.user.id, {
      title: "Someone else's ride",
    });
    await attachMetrics(privateOtherRide.id, { distanceKm: 999 });

    const report = await getRideInsights(caller.user.id, {
      now: new Date("2026-10-10T00:00:00.000Z"),
    });

    expect(report.totals).toMatchObject({
      completedRides: 2,
      totalDistanceKm: 200,
      totalMovingTimeSec: 10800,
      elevationGainM: 1000,
      averageRideDistanceKm: 100,
    });
    expect(report.longestRide).toMatchObject({
      id: ownRide.id,
      distanceKm: 120,
    });
    expect(report.routeFootprint).toHaveLength(1);
    expect(report.routeFootprint[0]?.rideId).toBe(ownRide.id);
    expect(report.speedDistribution).toEqual([
      { label: "Under 30", rideCount: 0 },
      { label: "30–50", rideCount: 1 },
      { label: "50–70", rideCount: 1 },
      { label: "70+", rideCount: 0 },
    ]);
  });

  it("returns an empty safe report when the caller has no completed rides", async () => {
    const caller = await createTestUser();

    const report = await getRideInsights(caller.user.id, {
      now: new Date("2026-10-10T00:00:00.000Z"),
    });

    expect(report.totals).toEqual({
      completedRides: 0,
      totalDistanceKm: 0,
      totalMovingTimeSec: 0,
      elevationGainM: 0,
      averageRideDistanceKm: 0,
    });
    expect(report.longestRide).toBeNull();
    expect(report.routeFootprint).toEqual([]);
    expect(report.months).toHaveLength(12);
  });

  it("drops malformed and oversized route data from the footprint", async () => {
    const caller = await createTestUser();
    const ride = await completeRide(caller.user.id);
    await attachMetrics(ride.id, {
      distanceKm: 20,
      routeGeoJson: "{invalid json",
    });

    const report = await getRideInsights(caller.user.id, {
      now: new Date("2026-10-10T00:00:00.000Z"),
    });

    expect(report.routeFootprint).toEqual([]);
  });
});
