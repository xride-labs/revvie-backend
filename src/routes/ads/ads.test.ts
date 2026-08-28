/**
 * ADS ROUTES TESTS
 * Tests for ad-serving endpoints: list by slot, impression beacon, click beacon.
 *
 * Routes (all behind requireAuth):
 *   GET  /api/business/ads?slot=...&limit=...   -> ApiResponse.success({ items })
 *   POST /api/business/ads/:id/impression       -> ApiResponse.success(null, "Logged")
 *   POST /api/business/ads/:id/click            -> ApiResponse.success(null, "Logged")
 */

import request from "supertest";
import { app } from "../../server";
import prisma from "../../lib/prisma";
import { createTestUser, cleanupTestData } from "../../test/utils";

// ─── Local data helpers ──────────────────────────────────────────────────────

let bizSeq = 0;

async function createBusiness(ownerId: string, overrides: Partial<any> = {}) {
  const suffix = `${Date.now().toString(36)}_${bizSeq++}`;
  return prisma.businessProfile.create({
    data: {
      ownerId,
      categories: ["BRAND"],
      displayName: `Ad Biz ${suffix}`,
      slug: `ad-biz-${suffix}`,
      verification: "APPROVED",
      ...overrides,
    },
  });
}

async function createCampaign(businessId: string, overrides: Partial<any> = {}) {
  const now = Date.now();
  return prisma.adCampaign.create({
    data: {
      businessId,
      title: "Test Campaign",
      ctaLabel: "Shop now",
      imageUrl: "https://example.com/ad.png",
      status: "ACTIVE",
      startsAt: new Date(now - 86400000), // yesterday
      endsAt: new Date(now + 86400000), // tomorrow
      slots: ["HOME_FEED"],
      ...overrides,
    },
  });
}

describe("Ads Routes", () => {
  afterEach(async () => {
    // Children first: campaigns reference businesses which reference users.
    await prisma.adCampaign.deleteMany({});
    await prisma.businessProfile.deleteMany({});
    await cleanupTestData();
  });

  // ─── GET /api/business/ads ──────────────────────────────────────────────────────────
  describe("GET /api/business/ads", () => {
    it("should return active ads for the requested slot (happy path)", async () => {
      const { token } = await createTestUser();
      const biz = await createBusiness((await createTestUser()).user.id);
      const campaign = await createCampaign(biz.id, { title: "Home Feed Ad" });

      const res = await request(app)
        .get("/api/business/ads?slot=HOME_FEED")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Non-paginated success envelope: data.items
      expect(Array.isArray(res.body.data.items)).toBe(true);
      const ids = res.body.data.items.map((i: any) => i.id);
      expect(ids).toContain(campaign.id);
      const served = res.body.data.items.find((i: any) => i.id === campaign.id);
      expect(served.title).toBe("Home Feed Ad");
      // Selected business projection is present.
      expect(served.business).toMatchObject({ id: biz.id, slug: biz.slug });
    });

    it("should not return ads targeting a different slot", async () => {
      const { token } = await createTestUser();
      const biz = await createBusiness((await createTestUser()).user.id);
      const home = await createCampaign(biz.id, { slots: ["HOME_FEED"] });

      const res = await request(app)
        .get("/api/business/ads?slot=DISCOVER_TOP")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((i: any) => i.id);
      expect(ids).not.toContain(home.id);
    });

    it("should exclude non-ACTIVE and out-of-window campaigns", async () => {
      const { token } = await createTestUser();
      const biz = await createBusiness((await createTestUser()).user.id);
      const draft = await createCampaign(biz.id, { status: "DRAFT" });
      const expired = await createCampaign(biz.id, {
        startsAt: new Date(Date.now() - 3 * 86400000),
        endsAt: new Date(Date.now() - 2 * 86400000),
      });

      const res = await request(app)
        .get("/api/business/ads?slot=HOME_FEED")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((i: any) => i.id);
      expect(ids).not.toContain(draft.id);
      expect(ids).not.toContain(expired.id);
    });

    it("should exclude campaigns that have hit their impression cap", async () => {
      const { token } = await createTestUser();
      const biz = await createBusiness((await createTestUser()).user.id);
      const capped = await createCampaign(biz.id, {
        impressionCap: 100,
        impressionCount: 100,
      });
      const underCap = await createCampaign(biz.id, {
        impressionCap: 100,
        impressionCount: 5,
      });

      const res = await request(app)
        .get("/api/business/ads?slot=HOME_FEED")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((i: any) => i.id);
      expect(ids).not.toContain(capped.id);
      expect(ids).toContain(underCap.id);
    });

    it("should respect the limit query and cap returned items", async () => {
      const { token } = await createTestUser();
      const biz = await createBusiness((await createTestUser()).user.id);
      await createCampaign(biz.id);
      await createCampaign(biz.id);
      await createCampaign(biz.id);

      const res = await request(app)
        .get("/api/business/ads?slot=HOME_FEED&limit=2")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeLessThanOrEqual(2);
    });

    it("should return an empty list for PRO-tier users (ad-free)", async () => {
      const { token } = await createTestUser({ subscriptionTier: "PRO" });
      const biz = await createBusiness((await createTestUser()).user.id);
      await createCampaign(biz.id);

      const res = await request(app)
        .get("/api/business/ads?slot=HOME_FEED")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
    });

    it("should return 400 when the required slot query is missing", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .get("/api/business/ads")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 for an invalid slot enum value", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .get("/api/business/ads?slot=NOT_A_SLOT")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 when limit exceeds the max (10)", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .get("/api/business/ads?slot=HOME_FEED&limit=50")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).get("/api/business/ads?slot=HOME_FEED");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── POST /api/business/ads/:id/impression ────────────────────────────────────────────
  describe("POST /api/business/ads/:id/impression", () => {
    it("should increment impressionCount (DB side-effect)", async () => {
      const { token } = await createTestUser();
      const biz = await createBusiness((await createTestUser()).user.id);
      const campaign = await createCampaign(biz.id, { impressionCount: 0 });

      const res = await request(app)
        .post(`/api/business/ads/${campaign.id}/impression`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = await prisma.adCampaign.findUnique({
        where: { id: campaign.id },
      });
      expect(updated?.impressionCount).toBe(1);
    });

    it("should be best-effort and still 200 for a non-existent campaign", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/business/ads/clnonexistent000000000000/impression")
        .set("Authorization", `Bearer ${token}`);

      // Handler swallows the update error and returns success regardless.
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).post(
        "/api/business/ads/clnonexistent000000000000/impression",
      );

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── POST /api/business/ads/:id/click ─────────────────────────────────────────────────
  describe("POST /api/business/ads/:id/click", () => {
    it("should increment clickCount (DB side-effect)", async () => {
      const { token } = await createTestUser();
      const biz = await createBusiness((await createTestUser()).user.id);
      const campaign = await createCampaign(biz.id, { clickCount: 0 });

      const res = await request(app)
        .post(`/api/business/ads/${campaign.id}/click`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = await prisma.adCampaign.findUnique({
        where: { id: campaign.id },
      });
      expect(updated?.clickCount).toBe(1);
    });

    it("should be best-effort and still 200 for a non-existent campaign", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/business/ads/clnonexistent000000000000/click")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).post(
        "/api/business/ads/clnonexistent000000000000/click",
      );

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
