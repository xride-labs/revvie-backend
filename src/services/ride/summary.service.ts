import type { RideBreak, RideDetour, RideTrackingData } from "@prisma/client";

export interface ComputeSummaryInput {
  actualStartTime: Date | null | undefined;
  actualEndTime: Date | null | undefined;
  totalDistanceKm: number | null | undefined;
  maxSpeedKmh: number | null | undefined;
  avgSpeedKmh: number | null | undefined;
  elevationGainM: number | null | undefined;
  breaks: Pick<RideBreak, "startedAt" | "endedAt" | "durationSec">[];
  detours: Pick<RideDetour, "id">[];
}

export interface ComputedRideSummary {
  totalDistanceKm: number;
  totalDurationSec: number;
  movingTimeSec: number;
  idleTimeSec: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  elevationGainM: number;
  breakCount: number;
  detourCount: number;
  score: number;
  highlights: string[];
  badges: string[];
}

/**
 * Compute the post-ride summary from raw tracking + lifecycle events.
 *
 * Ride start/end times are treated as loose markers — the user can start late
 * or end late. The "effective" ride is `actualEndTime - actualStartTime - Σ breaks`.
 * Distance/speed come from the tracker; we don't try to back-compute them.
 *
 * Score is intentionally simple — distance, max speed, and elevation reward
 * effort; long idle stretches dampen it. Tweak the weights without breaking
 * persisted summaries (we snapshot the result in `ride_summaries`).
 */
export function computeRideSummary(
  input: ComputeSummaryInput,
): ComputedRideSummary {
  const distance = clampNonNeg(input.totalDistanceKm);
  const maxSpeed = clampNonNeg(input.maxSpeedKmh);
  const elevation = clampNonNeg(input.elevationGainM);

  const totalDurationSec =
    input.actualStartTime && input.actualEndTime
      ? Math.max(
          0,
          Math.floor(
            (input.actualEndTime.getTime() - input.actualStartTime.getTime()) /
              1000,
          ),
        )
      : 0;

  const idleTimeSec = sumBreakDurationSec(input.breaks);
  const movingTimeSec = Math.max(0, totalDurationSec - idleTimeSec);

  // If the client sent avgSpeed, trust it; otherwise derive from moving time.
  const avgSpeed =
    input.avgSpeedKmh != null && input.avgSpeedKmh > 0
      ? input.avgSpeedKmh
      : movingTimeSec > 0
        ? round1(distance / (movingTimeSec / 3600))
        : 0;

  const breakCount = input.breaks.length;
  const detourCount = input.detours.length;

  const score = computeScore({
    distanceKm: distance,
    maxSpeedKmh: maxSpeed,
    elevationGainM: elevation,
    movingTimeSec,
    idleTimeSec,
  });

  const highlights = computeHighlights({
    distanceKm: distance,
    maxSpeedKmh: maxSpeed,
    elevationGainM: elevation,
    movingTimeSec,
    breakCount,
  });

  const badges = computeBadgeSlugs({
    distanceKm: distance,
    maxSpeedKmh: maxSpeed,
    elevationGainM: elevation,
    movingTimeSec,
  });

  return {
    totalDistanceKm: round2(distance),
    totalDurationSec,
    movingTimeSec,
    idleTimeSec,
    avgSpeedKmh: round1(avgSpeed),
    maxSpeedKmh: round1(maxSpeed),
    elevationGainM: round1(elevation),
    breakCount,
    detourCount,
    score,
    highlights,
    badges,
  };
}

/**
 * Effective ride duration in seconds — what we persist on `Ride` and what the
 * scheduler uses for long-tail analytics. Excludes time spent paused/on breaks.
 */
export function deriveEffectiveDurationSec(
  trackingData:
    | Pick<RideTrackingData, "actualStartTime" | "actualEndTime">
    | null
    | undefined,
  breaks: Pick<RideBreak, "startedAt" | "endedAt" | "durationSec">[],
): number {
  if (!trackingData?.actualStartTime || !trackingData?.actualEndTime) return 0;
  const total = Math.max(
    0,
    Math.floor(
      (trackingData.actualEndTime.getTime() -
        trackingData.actualStartTime.getTime()) /
        1000,
    ),
  );
  return Math.max(0, total - sumBreakDurationSec(breaks));
}

// ─── internals ───────────────────────────────────────────────────────────────

function sumBreakDurationSec(
  breaks: Pick<RideBreak, "startedAt" | "endedAt" | "durationSec">[],
): number {
  let sum = 0;
  for (const b of breaks) {
    if (typeof b.durationSec === "number" && b.durationSec > 0) {
      sum += b.durationSec;
      continue;
    }
    if (b.startedAt && b.endedAt) {
      sum += Math.max(
        0,
        Math.floor((b.endedAt.getTime() - b.startedAt.getTime()) / 1000),
      );
    }
  }
  return sum;
}

function computeScore(args: {
  distanceKm: number;
  maxSpeedKmh: number;
  elevationGainM: number;
  movingTimeSec: number;
  idleTimeSec: number;
}): number {
  // Caps are picked so a typical 50km solo ride at 60km/h scores ~70.
  const distancePts = clamp(args.distanceKm * 0.6, 0, 40);
  const speedPts = clamp(args.maxSpeedKmh * 0.25, 0, 25);
  const elevationPts = clamp(args.elevationGainM * 0.05, 0, 20);
  const movingPts = clamp(args.movingTimeSec / 60, 0, 25); // 1 pt per minute, capped
  const idlePenalty = clamp(args.idleTimeSec / 120, 0, 20); // −1 pt per 2min idle, capped
  const raw = distancePts + speedPts + elevationPts + movingPts - idlePenalty;
  return Math.round(clamp(raw, 0, 100));
}

function computeHighlights(args: {
  distanceKm: number;
  maxSpeedKmh: number;
  elevationGainM: number;
  movingTimeSec: number;
  breakCount: number;
}): string[] {
  const out: string[] = [];
  if (args.distanceKm >= 200) out.push("Epic 200km+ ride");
  else if (args.distanceKm >= 100) out.push("Century ride (100km+)");
  else if (args.distanceKm >= 50) out.push("Half-century (50km+)");
  if (args.maxSpeedKmh >= 120)
    out.push(`Top speed ${Math.round(args.maxSpeedKmh)} km/h`);
  if (args.elevationGainM >= 1000)
    out.push(`Climbed ${Math.round(args.elevationGainM)}m`);
  if (args.movingTimeSec >= 4 * 60 * 60) out.push("4h+ in the saddle");
  if (args.breakCount === 0 && args.distanceKm >= 30)
    out.push("No breaks needed");
  return out;
}

function computeBadgeSlugs(args: {
  distanceKm: number;
  maxSpeedKmh: number;
  elevationGainM: number;
  movingTimeSec: number;
}): string[] {
  const out: string[] = [];
  if (args.distanceKm >= 100) out.push("century");
  if (args.distanceKm >= 200) out.push("double-century");
  if (args.maxSpeedKmh >= 150) out.push("speed-demon");
  if (args.elevationGainM >= 1500) out.push("mountain-goat");
  if (args.movingTimeSec >= 6 * 60 * 60) out.push("iron-butt");
  return out;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clampNonNeg(n: number | null | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return n;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
