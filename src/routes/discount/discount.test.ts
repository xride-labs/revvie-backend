/**
 * DISCOUNT ROUTES TESTS
 * Tests for the discount offer-wall endpoint.
 *
 * Routes (behind requireAuth):
 *   GET /api/business/discounts?featured=&page=&limit=  -> ApiResponse.paginated(items, ...)
 *
 * Only discounts whose business is APPROVED and whose validity window
 * includes "now" are surfaced. featured=true restricts to featured items.
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
      displayName: `Disc Biz ${suffix}`,
      slug: `disc-biz-${suffix}`,
      verification: "APPROVED",
      ...overrides,
    },
  });
}

async function createDiscount(businessId: string, overrides: Partial<any> = {}) {
  const now = Date.now();
  return prisma.discount.create({
    data: {
      businessId,
      title: "10% off",
      percentOff: 10,
      validFrom: new Date(now - 86400000), // yesterday
      validUntil: new Date(now + 86400000), // tomorrow
      ...overrides,
    },
  });
}

describe("Discount Routes", () => {
  afterEach(async () => {
    // Children first: discounts -> businesses -> users.
    await prisma.discount.deleteMany({});
    await prisma.businessProfile.deleteMany({});
    await cleanupTestData();
  });

  describe("GET /api/business/discounts", () => {
    it("should list active discounts in a paginated envelope (happy path)", async () => {
      const { token } = await createTestUser();
      const biz = await createBusiness((await createTestUser()).user.id);
      const discount = await createDiscount(biz.id, { title: "Spring Sale" });

      const res = await request(app)
        .get("/api/business/discounts?page=1&limit=10")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // ApiResponse.paginated nests under data: { items, pagination }
      expect(res.body.data).toHaveProperty("pagination");
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      const item = res.body.data.items.find((i: any) => i.id === discount.id);
      expect(item).toBeTruthy();
      expect(item.title).toBe("Spring Sale");
      // Included business projection.
      expect(item.business).toMatchObject({ id: biz.id, slug: biz.slug });
    });

    it("should hide discounts from non-APPROVED businesses", async () => {
      const { token } = await createTestUser();
      const pendingBiz = await createBusiness(
        (await createTestUser()).user.id,
        { verification: "PENDING" },
      );
      const hidden = await createDiscount(pendingBiz.id);

      const res = await request(app)
        .get("/api/business/discounts")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((i: any) => i.id);
      expect(ids).not.toContain(hidden.id);
    });

    it("should hide discounts outside their validity window", async () => {
      const { token } = await createTestUser();
      const biz = await createBusiness((await createTestUser()).user.id);
      const expired = await createDiscount(biz.id, {
        validFrom: new Date(Date.now() - 3 * 86400000),
        validUntil: new Date(Date.now() - 2 * 86400000),
      });
      const future = await createDiscount(biz.id, {
        validFrom: new Date(Date.now() + 2 * 86400000),
        validUntil: new Date(Date.now() + 3 * 86400000),
      });

      const res = await request(app)
        .get("/api/business/discounts")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((i: any) => i.id);
      expect(ids).not.toContain(expired.id);
      expect(ids).not.toContain(future.id);
    });

    it("should restrict to featured items when featured=true", async () => {
      const { token } = await createTestUser();
      const biz = await createBusiness((await createTestUser()).user.id);
      const featured = await createDiscount(biz.id, { isFeatured: true });
      const normal = await createDiscount(biz.id, { isFeatured: false });

      const res = await request(app)
        .get("/api/business/discounts?featured=true")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((i: any) => i.id);
      expect(ids).toContain(featured.id);
      expect(ids).not.toContain(normal.id);
    });

    it("should paginate results (page/limit shape)", async () => {
      const { token } = await createTestUser();
      const biz = await createBusiness((await createTestUser()).user.id);
      await createDiscount(biz.id);
      await createDiscount(biz.id);
      await createDiscount(biz.id);

      const res = await request(app)
        .get("/api/business/discounts?page=1&limit=2")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.pagination).toMatchObject({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it("should enforce a unique discount code (conflict on duplicate)", async () => {
      const { user } = await createTestUser();
      const biz = await createBusiness(user.id);
      const code = `SAVE10_${Date.now()}`;
      await createDiscount(biz.id, { code });

      // The @unique constraint on Discount.code rejects a second row.
      await expect(createDiscount(biz.id, { code })).rejects.toThrow();
    });

    it("should return 400 for an invalid limit (over max 50)", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .get("/api/business/discounts?limit=100")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 for an invalid page (below min 1)", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .get("/api/business/discounts?page=0")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 401 without authentication", async () => {
      const res = await request(app).get("/api/business/discounts");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
