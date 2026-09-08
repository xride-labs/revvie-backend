import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../../server.js";
import prisma from "../../lib/prisma.js";
import {
  createTestUser,
  createTestClub,
  cleanupTestData,
} from "../../test/utils.js";
import { awardDistanceXp, levelForXp, evaluateAndAwardRideBadges } from "../../lib/xp.js";

describe("Winnable Leaderboards & Motorcycle XP System", () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe("XP & Mastery Calculation", () => {
    it("calculates 10 meaningful motorcycle ranks with 250 XP steps", () => {
      expect(levelForXp(0)).toEqual({ level: 1, title: "Rookie" });
      expect(levelForXp(250)).toEqual({ level: 2, title: "Cruiser" });
      expect(levelForXp(500)).toEqual({ level: 3, title: "Day Tripper" });
      expect(levelForXp(1000)).toEqual({ level: 5, title: "Tourer" });
      expect(levelForXp(1500)).toEqual({ level: 7, title: "Road Captain" });
      expect(levelForXp(2000)).toEqual({ level: 9, title: "Ironbutt" });
      expect(levelForXp(2250)).toEqual({ level: 10, title: "Legend" });
    });

    it("awards XP proportional to verified riding distance (1 XP per km)", async () => {
      const { user } = await createTestUser({ xpPoints: 100 });
      const result = await awardDistanceXp(user.id, 42.6);
      expect(result).not.toBeNull();
      expect(result?.xpPoints).toBe(143); // 100 + 43
    });
  });

  describe("GET /api/users/leaderboard (Winnable & Scoped)", () => {
    it("returns ranked users with distance metrics", async () => {
      const u1 = await createTestUser({ name: "Rider One", xpPoints: 600 });
      const u2 = await createTestUser({ name: "Rider Two", xpPoints: 200 });

      const res = await request(app)
        .get("/api/users/leaderboard")
        .set("Authorization", `Bearer ${u1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.leaderboard.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data.leaderboard[0].rank).toBe(1);
      expect(res.body.data.leaderboard[0].totalDistanceKm).toBeDefined();
    });

    it("filters by club scope for winnable club competitions", async () => {
      const owner = await createTestUser({ xpPoints: 400 });
      const member = await createTestUser({ xpPoints: 300 });
      const outsider = await createTestUser({ xpPoints: 999 });
      const club = await createTestClub(owner.user.id);
      await prisma.clubMember.create({
        data: {
          userId: member.user.id,
          clubId: club.id,
          role: "MEMBER",
        },
      });

      const res = await request(app)
        .get(`/api/users/leaderboard?scope=club&clubId=${club.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.scope).toBe("club");
      const ids = res.body.data.leaderboard.map((e: any) => e.id);
      expect(ids).toContain(owner.user.id);
      expect(ids).toContain(member.user.id);
      expect(ids).not.toContain(outsider.user.id);
    });

    it("supports monthly timeframe", async () => {
      const rider = await createTestUser({ xpPoints: 150 });
      const res = await request(app)
        .get("/api/users/leaderboard?timeframe=monthly")
        .set("Authorization", `Bearer ${rider.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.timeframe).toBe("monthly");
      expect(Array.isArray(res.body.data.leaderboard)).toBe(true);
    });
  });
});
