import { describe, it, expect } from "vitest";
import { computeRideSummary, deriveEffectiveDurationSec } from "./summary.service.js";

describe("Ride Summary & Gamification Safety Service", () => {
  it("computes score from distance, elevation, and moving time WITHOUT rewarding speed", () => {
    const normalRide = computeRideSummary({
      actualStartTime: new Date("2026-06-01T08:00:00Z"),
      actualEndTime: new Date("2026-06-01T09:00:00Z"),
      totalDistanceKm: 50,
      elevationGainM: 200,
      maxSpeedKmh: 65,
      breaks: [],
      detours: [],
    });

    const highSpeedRide = computeRideSummary({
      actualStartTime: new Date("2026-06-01T08:00:00Z"),
      actualEndTime: new Date("2026-06-01T09:00:00Z"),
      totalDistanceKm: 50,
      elevationGainM: 200,
      maxSpeedKmh: 180, // Dangerous speed!
      breaks: [],
      detours: [],
    });

    // Score must be IDENTICAL regardless of speed
    expect(normalRide.score).toBe(highSpeedRide.score);
    // Neither should have a speed-demon badge
    expect(highSpeedRide.badges).not.toContain("speed-demon");
    expect(normalRide.badges).not.toContain("speed-demon");
  });

  it("does not penalize riders for taking rest or fuel breaks (idle time)", () => {
    const straightRide = computeRideSummary({
      actualStartTime: new Date("2026-06-01T08:00:00Z"),
      actualEndTime: new Date("2026-06-01T09:00:00Z"),
      totalDistanceKm: 40,
      elevationGainM: 100,
      breaks: [],
      detours: [],
    });

    const rideWithChaiBreak = computeRideSummary({
      actualStartTime: new Date("2026-06-01T08:00:00Z"),
      actualEndTime: new Date("2026-06-01T09:30:00Z"), // 30 min break
      totalDistanceKm: 40,
      elevationGainM: 100,
      breaks: [
        {
          startedAt: new Date("2026-06-01T08:40:00Z"),
          endedAt: new Date("2026-06-01T09:10:00Z"),
          durationSec: 1800,
        },
      ],
      detours: [],
    });

    // Score must NOT be penalized for resting
    expect(rideWithChaiBreak.score).toBeGreaterThanOrEqual(straightRide.score);
  });

  it("awards authentic milestone badges for distance and climbing", () => {
    const centuryRide = computeRideSummary({
      actualStartTime: new Date("2026-06-01T06:00:00Z"),
      actualEndTime: new Date("2026-06-01T10:00:00Z"),
      totalDistanceKm: 120,
      elevationGainM: 1100,
      breaks: [],
      detours: [],
    });

    expect(centuryRide.badges).toContain("century");
    expect(centuryRide.badges).toContain("mountain-goat");
    expect(centuryRide.highlights).toContain("Century ride (100km+)");
    expect(centuryRide.highlights).toContain("Climbed 1100m");
  });

  it("derives effective duration correctly excluding break intervals", () => {
    const tracking = {
      actualStartTime: new Date("2026-06-01T10:00:00Z"),
      actualEndTime: new Date("2026-06-01T12:00:00Z"), // 7200 sec total
    };
    const breaks = [
      {
        startedAt: new Date("2026-06-01T10:30:00Z"),
        endedAt: new Date("2026-06-01T11:00:00Z"),
        durationSec: 1800,
      },
    ];

    const effectiveSec = deriveEffectiveDurationSec(tracking, breaks);
    expect(effectiveSec).toBe(5400); // 7200 - 1800 = 5400
  });
});
