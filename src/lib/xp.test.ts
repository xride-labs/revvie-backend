import { describe, it, expect } from "vitest";
import { levelForXp, XP_REWARDS } from "./xp.js";

describe("levelForXp", () => {
  it("should return Level 1 Rookie for 0 XP", () => {
    const result = levelForXp(0);
    expect(result).toEqual({ level: 1, title: "Rookie" });
  });

  it("should return Level 1 Rookie for 249 XP", () => {
    const result = levelForXp(249);
    expect(result).toEqual({ level: 1, title: "Rookie" });
  });

  it("should return Level 2 Cruiser for 250 XP", () => {
    const result = levelForXp(250);
    expect(result).toEqual({ level: 2, title: "Cruiser" });
  });

  it("should scale level linearly every 250 XP", () => {
    expect(levelForXp(500)).toEqual({ level: 3, title: "Day Tripper" });
    expect(levelForXp(750)).toEqual({ level: 4, title: "Weekender" });
    expect(levelForXp(1000)).toEqual({ level: 5, title: "Tourer" });
  });

  it("should cap max title at Legend for level 10 and above", () => {
    expect(levelForXp(2250)).toEqual({ level: 10, title: "Legend" });
    expect(levelForXp(5000)).toEqual({ level: 21, title: "Legend" });
  });

  it("should define positive rewards for all XP actions", () => {
    expect(XP_REWARDS.RIDE_CREATED).toBeGreaterThan(0);
    expect(XP_REWARDS.RIDE_COMPLETED).toBeGreaterThan(0);
    expect(XP_REWARDS.POST_CREATED).toBeGreaterThan(0);
  });
});
