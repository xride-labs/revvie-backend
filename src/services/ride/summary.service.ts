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
    elevationGainM: elevation,
    movingTimeSec,
    idleTimeSec,
    breakCount,
  });

  const highlights = computeHighlights({
    distanceKm: distance,
    elevationGainM: elevation,
    movingTimeSec,
    breakCount,
  });

  const badges = computeBadgeSlugs({
    distanceKm: distance,
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
  elevationGainM: number;
  movingTimeSec: number;
  idleTimeSec: number;
  breakCount?: number;
}): number {
  // Distance points: up to 50 pts (0.5 pts per km, capped at 100km)
  const distancePts = clamp(args.distanceKm * 0.5, 0, 50);
  // Elevation points: up to 25 pts (0.025 pts per meter, 1000m climb = 25 pts)
  const elevationPts = clamp(args.elevationGainM * 0.025, 0, 25);
  // Moving consistency: up to 25 pts (1 pt per 2 minutes moving, capped at 25 pts)
  const movingPts = clamp(args.movingTimeSec / 120, 0, 25);
  
  // Safety rest bonus: riders on long rides (>2 hours) who take safety/fuel breaks earn a bonus.
  // NOTE: Speed points and idle penalties are completely removed per Plan §6.3 and Gamification Spec.
  const safetyRestBonus = args.movingTimeSec >= 7200 && (args.breakCount ?? 0) > 0 ? 5 : 0;

  const raw = distancePts + elevationPts + movingPts + safetyRestBonus;
  return Math.round(clamp(raw, 0, 100));
}

function computeHighlights(args: {
  distanceKm: number;
  elevationGainM: number;
  movingTimeSec: number;
  breakCount: number;
}): string[] {
  const out: string[] = [];
  if (args.distanceKm >= 200) out.push("Epic 200km+ ride");
  else if (args.distanceKm >= 100) out.push("Century ride (100km+)");
  else if (args.distanceKm >= 50) out.push("Half-century (50km+)");
  if (args.elevationGainM >= 1000)
    out.push(`Climbed ${Math.round(args.elevationGainM)}m`);
  if (args.movingTimeSec >= 4 * 60 * 60) out.push("4h+ in the saddle");
  if (args.breakCount >= 1 && args.movingTimeSec >= 2 * 60 * 60)
    out.push("Safe tourer: rest breaks taken");
  return out;
}

function computeBadgeSlugs(args: {
  distanceKm: number;
  elevationGainM: number;
  movingTimeSec: number;
}): string[] {
  const out: string[] = [];
  if (args.distanceKm >= 100) out.push("century");
  if (args.distanceKm >= 200) out.push("double-century");
  if (args.distanceKm >= 300) out.push("iron-saddle");
  if (args.elevationGainM >= 1000) out.push("mountain-goat");
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
