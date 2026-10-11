import prisma from "../../lib/prisma.js";

const MONTH_COUNT = 12;
const MAX_FOOTPRINT_ROUTES = 12;
const MAX_POINTS_PER_ROUTE = 250;

export interface RideInsightsOptions {
  now?: Date;
}

export interface RideInsightRoute {
  rideId: string;
  completedAt: string | null;
  coordinates: Array<{ latitude: number; longitude: number }>;
}

export interface RideInsightsReport {
  totals: {
    completedRides: number;
    totalDistanceKm: number;
    totalMovingTimeSec: number;
    elevationGainM: number;
    averageRideDistanceKm: number;
  };
  longestRide: {
    id: string;
    title: string;
    distanceKm: number;
    completedAt: string | null;
  } | null;
  speedDistribution: Array<{ label: string; rideCount: number }>;
  months: Array<{ month: string; distanceKm: number; rideCount: number }>;
  routeFootprint: RideInsightRoute[];
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function monthKey(value: Date): string {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
  ].join("-");
}

function buildMonthBuckets(now: Date): RideInsightsReport["months"] {
  const buckets: RideInsightsReport["months"] = [];
  for (let offset = MONTH_COUNT - 1; offset >= 0; offset -= 1) {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
    );
    buckets.push({ month: monthKey(date), distanceKm: 0, rideCount: 0 });
  }
  return buckets;
}

function parseRouteFootprint(
  routeGeoJson: string | null | undefined,
): RideInsightRoute["coordinates"] {
  if (!routeGeoJson) return [];

  try {
    const raw = JSON.parse(routeGeoJson) as {
      geometry?: { coordinates?: unknown };
      coordinates?: unknown;
    };
    const coordinates = raw.geometry?.coordinates ?? raw.coordinates;
    if (!Array.isArray(coordinates)) return [];

    const valid = coordinates.flatMap((point) => {
      if (
        !Array.isArray(point) ||
        point.length < 2 ||
        typeof point[0] !== "number" ||
        typeof point[1] !== "number" ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1]) ||
        point[0] < -180 ||
        point[0] > 180 ||
        point[1] < -90 ||
        point[1] > 90
      ) {
        return [];
      }
      return [{ latitude: point[1], longitude: point[0] }];
    });

    if (valid.length < 2) return [];
    const stride = Math.max(1, Math.ceil(valid.length / MAX_POINTS_PER_ROUTE));
    const sampled = valid.filter((_, index) => index % stride === 0);
    const last = valid[valid.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    return sampled;
  } catch {
    return [];
  }
}

function speedBucket(speedKmh: number): number {
  if (speedKmh < 30) return 0;
  if (speedKmh < 50) return 1;
  if (speedKmh < 70) return 2;
  return 3;
}

export async function getRideInsights(
  userId: string,
  options: RideInsightsOptions = {},
): Promise<RideInsightsReport> {
  const now = options.now ?? new Date();
  const months = buildMonthBuckets(now);
  const buckets = new Map(months.map((bucket) => [bucket.month, bucket]));

  const rides = await prisma.ride.findMany({
    where: {
      status: "COMPLETED",
      OR: [
        { creatorId: userId },
        {
          participants: {
            some: {
              userId,
              status: { in: ["ACCEPTED", "COMPLETED"] },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      title: true,
      endedAt: true,
      scheduledAt: true,
      distance: true,
      effectiveDistanceKm: true,
      effectiveDurationSec: true,
      summary: {
        select: {
          totalDistanceKm: true,
          movingTimeSec: true,
          elevationGainM: true,
          avgSpeedKmh: true,
        },
      },
      trackingData: {
        select: {
          actualEndTime: true,
          totalDistanceKm: true,
          totalDurationMin: true,
          elevationGainM: true,
          avgSpeedKmh: true,
          routeGeoJson: true,
        },
      },
    },
    orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }],
  });

  let totalDistanceKm = 0;
  let totalMovingTimeSec = 0;
  let elevationGainM = 0;
  const speedCounts = [0, 0, 0, 0];
  let longestRide: RideInsightsReport["longestRide"] = null;
  const routeFootprint: RideInsightRoute[] = [];

  for (const ride of rides) {
    const distanceKm =
      ride.summary?.totalDistanceKm ??
      ride.trackingData?.totalDistanceKm ??
      ride.effectiveDistanceKm ??
      ride.distance ??
      0;
    const movingTimeSec =
      ride.summary?.movingTimeSec ??
      (ride.trackingData?.totalDurationMin != null
        ? ride.trackingData.totalDurationMin * 60
        : ride.effectiveDurationSec ?? 0);
    const elevation =
      ride.summary?.elevationGainM ?? ride.trackingData?.elevationGainM ?? 0;
    const averageSpeed =
      ride.summary?.avgSpeedKmh ?? ride.trackingData?.avgSpeedKmh ?? 0;
    const completedAt =
      ride.endedAt ?? ride.trackingData?.actualEndTime ?? ride.scheduledAt;

    totalDistanceKm += distanceKm;
    totalMovingTimeSec += movingTimeSec;
    elevationGainM += elevation;
    speedCounts[speedBucket(Math.max(0, averageSpeed))] += 1;

    if (!longestRide || distanceKm > longestRide.distanceKm) {
      longestRide = {
        id: ride.id,
        title: ride.title,
        distanceKm: round(distanceKm),
        completedAt: completedAt?.toISOString() ?? null,
      };
    }

    if (completedAt) {
      const bucket = buckets.get(monthKey(completedAt));
      if (bucket) {
        bucket.rideCount += 1;
        bucket.distanceKm += distanceKm;
      }
    }

    if (routeFootprint.length < MAX_FOOTPRINT_ROUTES) {
      const coordinates = parseRouteFootprint(ride.trackingData?.routeGeoJson);
      if (coordinates.length) {
        routeFootprint.push({
          rideId: ride.id,
          completedAt: completedAt?.toISOString() ?? null,
          coordinates,
        });
      }
    }
  }

  return {
    totals: {
      completedRides: rides.length,
      totalDistanceKm: round(totalDistanceKm),
      totalMovingTimeSec: Math.round(totalMovingTimeSec),
      elevationGainM: round(elevationGainM),
      averageRideDistanceKm: rides.length ? round(totalDistanceKm / rides.length) : 0,
    },
    longestRide,
    speedDistribution: [
      { label: "Under 30", rideCount: speedCounts[0] },
      { label: "30–50", rideCount: speedCounts[1] },
      { label: "50–70", rideCount: speedCounts[2] },
      { label: "70+", rideCount: speedCounts[3] },
    ],
    months: months.map((bucket) => ({
      ...bucket,
      distanceKm: round(bucket.distanceKm),
    })),
    routeFootprint,
  };
}
