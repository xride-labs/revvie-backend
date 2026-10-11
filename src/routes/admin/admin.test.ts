/**
 * ADMIN ROUTES TESTS
 *
 * Comprehensive coverage for every endpoint mounted under /api/admin across
 * both route files:
 *   - src/routes/admin/admin.routes.ts          (core admin + moderation)
 *   - src/routes/admin/admin.commerce.routes.ts (businesses / ad campaigns /
 *                                                 discounts — mounted at "/")
 *
 * Per endpoint we aim to cover: happy path (status + envelope + key fields),
 * validation (400), no-auth (401), non-admin (403), not-found / missing-row
 * behaviour (404 where the handler guards, 500 where it calls prisma.update on
 * a missing row and P2025 surfaces through asyncHandler), conflicts (409),
 * list pagination + filters, and DB side-effect assertions for mutations.
 *
 * AUTH MODEL NOTES (verified from source — not changeable here):
 *  - admin.routes.ts:  router.use(requireAuth); router.use(requireWebAccess);
 *    apply to that file's own routes. requireWebAccess = ADMIN | CO_ADMIN |
 *    CLUB_OWNER | SELLER. Then each route layers requireAdmin (ADMIN|CO_ADMIN)
 *    or requireSuperAdmin (ADMIN only).
 *  - admin.commerce.routes.ts is mounted BEFORE those .use() calls and brings
 *    its own requireAuth + requireAdmin. So commerce routes need ADMIN|CO_ADMIN
 *    and a plain user (no roles) gets 403.
 *  - Middleware ORDER matters: several :id routes run validateParams (and/or
 *    validateBody) BEFORE the role guard, so a malformed id / body yields 400
 *    even for a non-admin caller.
 *  - idParamSchema = /^[a-zA-Z0-9_-]{20,36}$/. A short id => 400. A 24-char id
 *    that doesn't exist => passes validation and reaches the handler.
 */

import request from "supertest";
import { app } from "../../server";
import prisma from "../../lib/prisma";
import {
  createAdminUser,
  createTestUser,
  createTestRide,
  createTestClub,
  createTestListing,
  cleanupTestData,
} from "../../test/utils";

// A 24-char id that satisfies idParamSchema but never exists in the DB.
const NONEXISTENT_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
// Too short for idParamSchema (needs 20-36 chars) => validation 400.
const SHORT_ID = "abc";

/**
 * Create a user and grant it an extra role assignment (e.g. CO_ADMIN, SELLER).
 * createAdminUser already grants ADMIN; this is for the non-super / web-access
 * permutations.
 */
async function createUserWithRole(role: string) {
  const helper = await createTestUser();
  const slug = role.toLowerCase();
  const roleRecord =
    (await prisma.role.findFirst({ where: { slug, scope: "GLOBAL" } })) ??
    (await prisma.role.create({
      data: { name: role, slug, scope: "GLOBAL", isSystem: true },
    }));
  await prisma.userRoleAssignment.create({
    data: { userId: helper.user.id, roleId: roleRecord.id },
  });
  return helper;
}

// Track non-user rows we create so we can clean them up (FK children first)
// BEFORE cleanupTestData() wipes users.
const createdReportIds = new Set<string>();
const createdBusinessIds = new Set<string>();
const createdCampaignIds = new Set<string>();
const createdDiscountIds = new Set<string>();
const createdNotificationIds = new Set<string>();
const createdEventIds = new Set<string>();

async function makeReport(data: Record<string, any> = {}) {
  const report = await prisma.report.create({
    data: { type: "user", title: "Test report", ...data },
  });
  createdReportIds.add(report.id);
  return report;
}

async function makeBusiness(ownerId: string, data: Record<string, any> = {}) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const business = await prisma.businessProfile.create({
    data: {
      ownerId,
      displayName: data.displayName ?? "Test Business",
      slug: data.slug ?? `test-biz-${suffix}`,
      categories: data.categories ?? ["BRAND"],
      verification: data.verification ?? "SUBMITTED",
      ...data,
    },
  });
  createdBusinessIds.add(business.id);
  return business;
}

async function makeCampaign(businessId: string, data: Record<string, any> = {}) {
  const campaign = await prisma.adCampaign.create({
    data: {
      businessId,
      title: data.title ?? "Test Campaign",
      ctaLabel: data.ctaLabel ?? "Shop now",
      imageUrl: data.imageUrl ?? "https://example.com/ad.png",
      startsAt: data.startsAt ?? new Date(),
      endsAt: data.endsAt ?? new Date(Date.now() + 7 * 86400000),
      status: data.status ?? "PENDING_APPROVAL",
      ...data,
    },
  });
  createdCampaignIds.add(campaign.id);
  return campaign;
}

async function makeDiscount(businessId: string, data: Record<string, any> = {}) {
  const suffix = Math.random().toString(36).slice(2, 10);
  const discount = await prisma.discount.create({
    data: {
      businessId,
      title: data.title ?? "Test Discount",
      code: data.code ?? `CODE_${suffix}`,
      percentOff: data.percentOff ?? 10,
      validFrom: data.validFrom ?? new Date(),
      validUntil: data.validUntil ?? new Date(Date.now() + 7 * 86400000),
      ...data,
    },
  });
  createdDiscountIds.add(discount.id);
  return discount;
}

async function makeNotification(userId: string, data: Record<string, any> = {}) {
  const notification = await prisma.notification.create({
    data: {
      userId,
      type: data.type ?? "MESSAGE",
      title: data.title ?? "Test notification",
      message: data.message ?? "Hello",
      ...data,
    },
  });
  createdNotificationIds.add(notification.id);
  return notification;
}

async function makeEvent(creatorId: string, data: Record<string, any> = {}) {
  const event = await prisma.event.create({
    data: {
      creatorId,
      title: data.title ?? "Test Event",
      scheduledAt: data.scheduledAt ?? new Date(Date.now() + 86400000),
      ...data,
    },
  });
  createdEventIds.add(event.id);
  return event;
}

describe("Admin Routes", () => {
  afterEach(async () => {
    // Children / dependents first so FK constraints don't block deletes. These
    // tables are NOT touched by cleanupTestData(), so we clear them here.
    if (createdNotificationIds.size) {
      await prisma.notification.deleteMany({
        where: { id: { in: [...createdNotificationIds] } },
      });
      createdNotificationIds.clear();
    }
    if (createdCampaignIds.size) {
      await prisma.adCampaign.deleteMany({
        where: { id: { in: [...createdCampaignIds] } },
      });
      createdCampaignIds.clear();
    }
    if (createdDiscountIds.size) {
      await prisma.discount.deleteMany({
        where: { id: { in: [...createdDiscountIds] } },
      });
      createdDiscountIds.clear();
    }
    if (createdBusinessIds.size) {
      await prisma.businessProfile.deleteMany({
        where: { id: { in: [...createdBusinessIds] } },
      });
      createdBusinessIds.clear();
    }
    if (createdEventIds.size) {
      await prisma.event.deleteMany({
        where: { id: { in: [...createdEventIds] } },
      });
      createdEventIds.clear();
    }
    if (createdReportIds.size) {
      await prisma.report.deleteMany({
        where: { id: { in: [...createdReportIds] } },
      });
      createdReportIds.clear();
    }
    await cleanupTestData();
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/stats  (requireSuperAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/stats", () => {
    it("super admin gets platform stats with overview/recent/breakdown", async () => {
      const admin = await createAdminUser();

      const res = await request(app)
        .get("/api/admin/stats")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("overview");
      expect(res.body.data).toHaveProperty("recent");
      expect(res.body.data).toHaveProperty("breakdown");
      expect(res.body.data.overview).toHaveProperty("totalUsers");
      expect(typeof res.body.data.overview.totalUsers).toBe("number");
      expect(res.body.data.breakdown).toHaveProperty("usersByRole");
      expect(res.body.data.breakdown).toHaveProperty("ridesByStatus");
    });

    it("rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/admin/stats");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("rejects user with no web-access role with 403", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .get("/api/admin/stats")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it("rejects CO_ADMIN (passes web-access but not super-admin) with 403", async () => {
      const coAdmin = await createUserWithRole("CO_ADMIN");
      const res = await request(app)
        .get("/api/admin/stats")
        .set("Authorization", `Bearer ${coAdmin.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Admin settings (requireSuperAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/settings", () => {
    it("super admin reads the global settings record", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .get("/api/admin/settings")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("siteName");
      expect(res.body.data).toHaveProperty("scope", "global");
    });

    it("rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/admin/settings");
      expect(res.status).toBe(401);
    });

    it("rejects CO_ADMIN with 403", async () => {
      const coAdmin = await createUserWithRole("CO_ADMIN");
      const res = await request(app)
        .get("/api/admin/settings")
        .set("Authorization", `Bearer ${coAdmin.token}`);
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/admin/settings", () => {
    it("super admin updates a setting and the change persists", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch("/api/admin/settings")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ maintenanceMode: true, siteName: "Revvie QA" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.maintenanceMode).toBe(true);
      expect(res.body.data.siteName).toBe("Revvie QA");

      const persisted = await prisma.adminSettings.findUnique({
        where: { scope: "global" },
      });
      expect(persisted?.maintenanceMode).toBe(true);

      // Restore so other tests/runs see defaults.
      await prisma.adminSettings.update({
        where: { scope: "global" },
        data: { maintenanceMode: false, siteName: "Revvie" },
      });
    });

    it("rejects empty body (refine: at least one field) with 400", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch("/api/admin/settings")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("rejects invalid field value (sessionTimeout out of range) with 400", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch("/api/admin/settings")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ sessionTimeoutMinutes: 1 });
      expect(res.status).toBe(400);
    });

    it("rejects CO_ADMIN with 403", async () => {
      const coAdmin = await createUserWithRole("CO_ADMIN");
      const res = await request(app)
        .patch("/api/admin/settings")
        .set("Authorization", `Bearer ${coAdmin.token}`)
        .send({ maintenanceMode: true });
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/activity/weekly  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/activity/weekly", () => {
    it("admin gets daily activity ranges (default 7 days)", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .get("/api/admin/activity/weekly")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("days", 7);
      expect(Array.isArray(res.body.data.activity)).toBe(true);
      expect(res.body.data.activity).toHaveLength(7);
      expect(res.body.data.activity[0]).toHaveProperty("usersRegistered");
    });

    it("respects the days query param", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .get("/api/admin/activity/weekly?days=3")
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.days).toBe(3);
      expect(res.body.data.activity).toHaveLength(3);
    });

    it("rejects out-of-range days (>90) with 400", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .get("/api/admin/activity/weekly?days=999")
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(400);
    });

    it("rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/admin/activity/weekly");
      expect(res.status).toBe(401);
    });

    it("CO_ADMIN is allowed (requireAdmin)", async () => {
      const coAdmin = await createUserWithRole("CO_ADMIN");
      const res = await request(app)
        .get("/api/admin/activity/weekly")
        .set("Authorization", `Bearer ${coAdmin.token}`);
      expect(res.status).toBe(200);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/users  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/users", () => {
    it("admin lists users in a paginated envelope", async () => {
      const admin = await createAdminUser();
      await createTestUser();
      await createTestUser();

      const res = await request(app)
        .get("/api/admin/users?page=1&limit=10")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: expect.any(Number),
        totalPages: expect.any(Number),
      });
      // Mapped record shape (toAdminUserRecord): roles + status fields present.
      const sample = res.body.data.items[0];
      expect(sample).toHaveProperty("roles");
      expect(sample).toHaveProperty("status");
    });

    it("filters by search term", async () => {
      const admin = await createAdminUser();
      const target = await createTestUser({ name: "ZZ Unique Searchterm" });

      const res = await request(app)
        .get("/api/admin/users?search=Unique Searchterm")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((u: any) => u.id);
      expect(ids).toContain(target.user.id);
    });

    it("filters by status=active", async () => {
      const admin = await createAdminUser();
      await createTestUser({ emailVerified: true });

      const res = await request(app)
        .get("/api/admin/users?status=active")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      for (const u of res.body.data.items) {
        expect(u.status).toBe("active");
      }
    });

    it("filters by role", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .get("/api/admin/users?role=ADMIN")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((u: any) => u.id);
      expect(ids).toContain(admin.user.id);
    });

    it("rejects invalid query (limit > 100) with 400", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .get("/api/admin/users?limit=500")
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(400);
    });

    it("rejects unauthenticated with 401", async () => {
      const res = await request(app).get("/api/admin/users");
      expect(res.status).toBe(401);
    });

    it("rejects non-admin web user (SELLER) with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/users/:id  (validateParams BEFORE requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/users/:id", () => {
    it("admin gets full user detail with counts and unreadNotifications", async () => {
      const admin = await createAdminUser();
      const user = await createTestUser();

      const res = await request(app)
        .get(`/api/admin/users/${user.user.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("id", user.user.id);
      expect(res.body.data).toHaveProperty("counts");
      expect(res.body.data).toHaveProperty("unreadNotifications");
      expect(res.body.data).toHaveProperty("roles");
    });

    it("returns 404 for a valid-but-nonexistent id", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .get(`/api/admin/users/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for a malformed (too short) id", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .get(`/api/admin/users/${SHORT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(400);
    });

    it("rejects non-admin with valid id with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const user = await createTestUser();
      const res = await request(app)
        .get(`/api/admin/users/${user.user.id}`)
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/admin/users  (validateBody BEFORE requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/admin/users", () => {
    it("admin creates a user and gets a 201 with the mapped record", async () => {
      const admin = await createAdminUser();
      const suffix = Math.random().toString(36).slice(2, 8);
      const email = `created_${suffix}@example.com`;

      const res = await request(app)
        .post("/api/admin/users")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({
          email,
          name: "Created User",
          username: `created_${suffix}`,
          roles: ["RIDER"],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.email).toBe(email);
      expect(res.body.data.roles).toContain("RIDER");

      // Side effect: user actually exists and has no password credential.
      const dbUser = await prisma.user.findUnique({ where: { email } });
      expect(dbUser).not.toBeNull();
      expect(await prisma.account.count({ where: { userId: dbUser!.id, password: { not: null } } })).toBe(0);
    });

    it("returns 409 when email already exists", async () => {
      const admin = await createAdminUser();
      const existing = await createTestUser();

      const res = await request(app)
        .post("/api/admin/users")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({
          email: existing.user.email,
          name: "Dupe User",
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for an invalid email", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post("/api/admin/users")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ email: "not-an-email" });
      expect(res.status).toBe(400);
    });

    it("CO_ADMIN cannot assign privileged roles (403)", async () => {
      const coAdmin = await createUserWithRole("CO_ADMIN");
      const suffix = Math.random().toString(36).slice(2, 8);
      const res = await request(app)
        .post("/api/admin/users")
        .set("Authorization", `Bearer ${coAdmin.token}`)
        .send({
          email: `priv_${suffix}@example.com`,
          roles: ["ADMIN"],
        });
      expect(res.status).toBe(403);
    });

    it("rejects unauthenticated with 401 (valid body so it reaches auth)", async () => {
      const res = await request(app)
        .post("/api/admin/users")
        .send({ email: "x@example.com" });
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /api/admin/users/:id  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/admin/users/:id", () => {
    it("admin updates user fields and roles; roles are replaced in DB", async () => {
      const admin = await createAdminUser();
      const user = await createTestUser();

      const res = await request(app)
        .patch(`/api/admin/users/${user.user.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ name: "Renamed", roles: ["MODERATOR", "SELLER"] });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Renamed");
      expect(res.body.data.roles.sort()).toEqual(["MODERATOR", "SELLER"]);

      // Side effect: role assignments replaced.
      const roles = await prisma.userRoleAssignment.findMany({
        where: { userId: user.user.id },
        select: { role: true },
      });
      expect(roles.map((r) => r.role).sort()).toEqual(["MODERATOR", "SELLER"]);
    });

    it("returns 400 for an empty body (refine: >=1 field)", async () => {
      const admin = await createAdminUser();
      const user = await createTestUser();
      const res = await request(app)
        .patch(`/api/admin/users/${user.user.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 for a malformed id", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/users/${SHORT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ name: "Whatever" });
      expect(res.status).toBe(400);
    });

    it("returns 500 (P2025) when updating a nonexistent user", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/users/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ name: "Ghost" });
      expect(res.status).toBe(500);
    });

    it("CO_ADMIN cannot modify a privileged (ADMIN) user => 403", async () => {
      const coAdmin = await createUserWithRole("CO_ADMIN");
      const targetAdmin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/users/${targetAdmin.user.id}`)
        .set("Authorization", `Bearer ${coAdmin.token}`)
        .send({ name: "Hax" });
      expect(res.status).toBe(403);
    });

    it("CO_ADMIN cannot assign privileged roles => 403", async () => {
      const coAdmin = await createUserWithRole("CO_ADMIN");
      const user = await createTestUser();
      const res = await request(app)
        .patch(`/api/admin/users/${user.user.id}`)
        .set("Authorization", `Bearer ${coAdmin.token}`)
        .send({ roles: ["ADMIN"] });
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /api/admin/users/:id/role  (requireSuperAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/admin/users/:id/role", () => {
    it("super admin adds a role (upsert) and returns updated roles", async () => {
      const admin = await createAdminUser();
      const user = await createTestUser();

      const res = await request(app)
        .patch(`/api/admin/users/${user.user.id}/role`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ role: "SELLER" });

      expect(res.status).toBe(200);
      expect(res.body.data.user.roles).toContain("SELLER");

      const roles = await prisma.userRoleAssignment.findMany({
        where: { userId: user.user.id, role: "SELLER" },
      });
      expect(roles).toHaveLength(1);
    });

    it("returns 400 for an invalid role enum", async () => {
      const admin = await createAdminUser();
      const user = await createTestUser();
      const res = await request(app)
        .patch(`/api/admin/users/${user.user.id}/role`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ role: "NOT_A_ROLE" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for a malformed id", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/users/${SHORT_ID}/role`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ role: "SELLER" });
      expect(res.status).toBe(400);
    });

    it("CO_ADMIN (not super) is rejected with 403", async () => {
      const coAdmin = await createUserWithRole("CO_ADMIN");
      const user = await createTestUser();
      const res = await request(app)
        .patch(`/api/admin/users/${user.user.id}/role`)
        .set("Authorization", `Bearer ${coAdmin.token}`)
        .send({ role: "SELLER" });
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /api/admin/users/:id/status  (requireAdmin, manual status validation)
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/admin/users/:id/status", () => {
    it("admin sets status=pending and emailVerified flips to false", async () => {
      const admin = await createAdminUser();
      const user = await createTestUser({ emailVerified: true });

      const res = await request(app)
        .patch(`/api/admin/users/${user.user.id}/status`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ status: "pending" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("pending");

      const dbUser = await prisma.user.findUnique({
        where: { id: user.user.id },
        select: { emailVerified: true },
      });
      expect(dbUser?.emailVerified).toBe(false);
    });

    it("admin sets status=active and emailVerified flips to true", async () => {
      const admin = await createAdminUser();
      const user = await createTestUser({ emailVerified: false });

      const res = await request(app)
        .patch(`/api/admin/users/${user.user.id}/status`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ status: "active" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("active");
    });

    it("returns 400 for an invalid status value", async () => {
      const admin = await createAdminUser();
      const user = await createTestUser();
      const res = await request(app)
        .patch(`/api/admin/users/${user.user.id}/status`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ status: "banned" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for a malformed id", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/users/${SHORT_ID}/status`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ status: "active" });
      expect(res.status).toBe(400);
    });

    it("CO_ADMIN cannot change a privileged user's status => 403", async () => {
      const coAdmin = await createUserWithRole("CO_ADMIN");
      const targetAdmin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/users/${targetAdmin.user.id}/status`)
        .set("Authorization", `Bearer ${coAdmin.token}`)
        .send({ status: "pending" });
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // DELETE /api/admin/users/:id  (requireSuperAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("DELETE /api/admin/users/:id", () => {
    it("super admin deletes another user; row is gone", async () => {
      const admin = await createAdminUser();
      const user = await createTestUser();

      const res = await request(app)
        .delete(`/api/admin/users/${user.user.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const dbUser = await prisma.user.findUnique({
        where: { id: user.user.id },
      });
      expect(dbUser).toBeNull();
    });

    it("rejects deleting your own account with 400", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .delete(`/api/admin/users/${admin.user.id}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(400);
    });

    it("returns 400 for a malformed id", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .delete(`/api/admin/users/${SHORT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(400);
    });

    it("returns 500 (P2025) deleting a nonexistent user", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .delete(`/api/admin/users/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(500);
    });

    it("CO_ADMIN (not super) is rejected with 403", async () => {
      const coAdmin = await createUserWithRole("CO_ADMIN");
      const user = await createTestUser();
      const res = await request(app)
        .delete(`/api/admin/users/${user.user.id}`)
        .set("Authorization", `Bearer ${coAdmin.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/rides  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/rides", () => {
    it("admin lists rides in a paginated envelope", async () => {
      const admin = await createAdminUser();
      const creator = await createTestUser();
      await createTestRide(creator.user.id);

      const res = await request(app)
        .get("/api/admin/rides")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toHaveProperty("total");
    });

    it("filters by creatorId", async () => {
      const admin = await createAdminUser();
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id);

      const res = await request(app)
        .get(`/api/admin/rides?creatorId=${creator.user.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((r: any) => r.id);
      expect(ids).toContain(ride.id);
    });

    it("filters by status", async () => {
      const admin = await createAdminUser();
      const creator = await createTestUser();
      await createTestRide(creator.user.id, { status: "COMPLETED" });

      const res = await request(app)
        .get("/api/admin/rides?status=COMPLETED")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      for (const r of res.body.data.items) {
        expect(r.status).toBe("COMPLETED");
      }
    });

    it("rejects unauthenticated with 401", async () => {
      const res = await request(app).get("/api/admin/rides");
      expect(res.status).toBe(401);
    });

    it("rejects non-admin web user (CLUB_OWNER) with 403", async () => {
      const owner = await createUserWithRole("CLUB_OWNER");
      const res = await request(app)
        .get("/api/admin/rides")
        .set("Authorization", `Bearer ${owner.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/clubs  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/clubs", () => {
    it("admin lists clubs in a paginated envelope", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      await createTestClub(owner.user.id);

      const res = await request(app)
        .get("/api/admin/clubs")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });

    it("filters by verified=true", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id, { verified: true });

      const res = await request(app)
        .get("/api/admin/clubs?verified=true")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((c: any) => c.id);
      expect(ids).toContain(club.id);
      for (const c of res.body.data.items) {
        expect(c.verified).toBe(true);
      }
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .get("/api/admin/clubs")
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /api/admin/clubs/:id/verify  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/admin/clubs/:id/verify", () => {
    it("admin verifies a club; verified persists", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id, { verified: false });

      const res = await request(app)
        .patch(`/api/admin/clubs/${club.id}/verify`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ verified: true });

      expect(res.status).toBe(200);
      expect(res.body.data.club.verified).toBe(true);

      const dbClub = await prisma.club.findUnique({ where: { id: club.id } });
      expect(dbClub?.verified).toBe(true);
    });

    it("defaults to verified=true when body omits verified", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id, { verified: false });

      const res = await request(app)
        .patch(`/api/admin/clubs/${club.id}/verify`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.club.verified).toBe(true);
    });

    it("returns 400 for a malformed id", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/clubs/${SHORT_ID}/verify`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ verified: true });
      expect(res.status).toBe(400);
    });

    it("returns 500 (P2025) for a nonexistent club", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/clubs/${NONEXISTENT_ID}/verify`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ verified: true });
      expect(res.status).toBe(500);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id);
      const res = await request(app)
        .patch(`/api/admin/clubs/${club.id}/verify`)
        .set("Authorization", `Bearer ${seller.token}`)
        .send({ verified: true });
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/admin/jobs/:jobName/run  (requireSuperAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/admin/jobs/:jobName/run", () => {
    it("super admin runs a known job and gets a result", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post("/api/admin/jobs/updateRideStatuses/run")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("result");
    });

    it("returns 400 for an unknown job name", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post("/api/admin/jobs/notARealJob/run")
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(400);
    });

    it("CO_ADMIN (not super) is rejected with 403", async () => {
      const coAdmin = await createUserWithRole("CO_ADMIN");
      const res = await request(app)
        .post("/api/admin/jobs/updateRideStatuses/run")
        .set("Authorization", `Bearer ${coAdmin.token}`);
      expect(res.status).toBe(403);
    });

    it("rejects unauthenticated with 401", async () => {
      const res = await request(app).post(
        "/api/admin/jobs/updateRideStatuses/run",
      );
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/reports  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/reports", () => {
    it("admin lists reports in a paginated envelope with formatted shape", async () => {
      const admin = await createAdminUser();
      await makeReport({ title: "Spammy user", priority: "high" });

      const res = await request(app)
        .get("/api/admin/reports")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      const sample = res.body.data.items[0];
      expect(sample).toHaveProperty("reportedItem");
      expect(sample).toHaveProperty("reporter");
      expect(sample).toHaveProperty("status");
    });

    it("filters by status", async () => {
      const admin = await createAdminUser();
      await makeReport({ status: "investigating" });

      const res = await request(app)
        .get("/api/admin/reports?status=investigating")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      for (const r of res.body.data.items) {
        expect(r.status).toBe("investigating");
      }
    });

    it("filters by priority", async () => {
      const admin = await createAdminUser();
      await makeReport({ priority: "critical" });

      const res = await request(app)
        .get("/api/admin/reports?priority=critical")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      for (const r of res.body.data.items) {
        expect(r.priority).toBe("critical");
      }
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .get("/api/admin/reports")
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /api/admin/reports/:id  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/admin/reports/:id", () => {
    it("admin resolves a report; status + resolution persist", async () => {
      const admin = await createAdminUser();
      const report = await makeReport();

      const res = await request(app)
        .patch(`/api/admin/reports/${report.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ status: "resolved", resolution: "Handled by QA" });

      expect(res.status).toBe(200);
      expect(res.body.data.report.status).toBe("resolved");
      expect(res.body.data.report.resolution).toBe("Handled by QA");

      const dbReport = await prisma.report.findUnique({
        where: { id: report.id },
      });
      expect(dbReport?.status).toBe("resolved");
    });

    it("returns 400 for an invalid status enum", async () => {
      const admin = await createAdminUser();
      const report = await makeReport();
      const res = await request(app)
        .patch(`/api/admin/reports/${report.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ status: "RESOLVED" }); // uppercase not allowed
      expect(res.status).toBe(400);
    });

    it("returns 400 for a malformed id", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/reports/${SHORT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ status: "resolved" });
      expect(res.status).toBe(400);
    });

    it("returns 500 (P2025) for a nonexistent report (no existence guard)", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/reports/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ status: "resolved" });
      expect(res.status).toBe(500);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const report = await makeReport();
      const res = await request(app)
        .patch(`/api/admin/reports/${report.id}`)
        .set("Authorization", `Bearer ${seller.token}`)
        .send({ status: "resolved" });
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/notifications  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/notifications", () => {
    it("admin lists notifications in a paginated envelope", async () => {
      const admin = await createAdminUser();
      const user = await createTestUser();
      await makeNotification(user.user.id);

      const res = await request(app)
        .get("/api/admin/notifications")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.items[0]).toHaveProperty("isRead");
    });

    it("filters by userId", async () => {
      const admin = await createAdminUser();
      const user = await createTestUser();
      const notif = await makeNotification(user.user.id);

      const res = await request(app)
        .get(`/api/admin/notifications?userId=${user.user.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((n: any) => n.id);
      expect(ids).toContain(notif.id);
    });

    it("filters by type", async () => {
      const admin = await createAdminUser();
      const user = await createTestUser();
      await makeNotification(user.user.id, { type: "FOLLOW" });

      const res = await request(app)
        .get("/api/admin/notifications?type=FOLLOW")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      for (const n of res.body.data.items) {
        expect(n.type).toBe("FOLLOW");
      }
    });

    it("rejects invalid type enum with 400", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .get("/api/admin/notifications?type=NOPE")
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(400);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .get("/api/admin/notifications")
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/marketplace  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/marketplace", () => {
    it("admin lists listings in a paginated envelope", async () => {
      const admin = await createAdminUser();
      const seller = await createTestUser();
      await createTestListing(seller.user.id);

      const res = await request(app)
        .get("/api/admin/marketplace")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });

    it("filters by sellerId", async () => {
      const admin = await createAdminUser();
      const seller = await createTestUser();
      const listing = await createTestListing(seller.user.id);

      const res = await request(app)
        .get(`/api/admin/marketplace?sellerId=${seller.user.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((l: any) => l.id);
      expect(ids).toContain(listing.id);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .get("/api/admin/marketplace")
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /api/admin/rides/:id/status  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/admin/rides/:id/status", () => {
    it("admin updates ride status; persists", async () => {
      const admin = await createAdminUser();
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id);

      const res = await request(app)
        .patch(`/api/admin/rides/${ride.id}/status`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ status: "CANCELLED" });

      expect(res.status).toBe(200);
      expect(res.body.data.ride.status).toBe("CANCELLED");

      const dbRide = await prisma.ride.findUnique({ where: { id: ride.id } });
      expect(dbRide?.status).toBe("CANCELLED");
    });

    it("returns 400 when status is missing", async () => {
      const admin = await createAdminUser();
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id);
      const res = await request(app)
        .patch(`/api/admin/rides/${ride.id}/status`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 for a malformed id", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/rides/${SHORT_ID}/status`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ status: "CANCELLED" });
      expect(res.status).toBe(400);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id);
      const res = await request(app)
        .patch(`/api/admin/rides/${ride.id}/status`)
        .set("Authorization", `Bearer ${seller.token}`)
        .send({ status: "CANCELLED" });
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // DELETE /api/admin/rides/:id  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("DELETE /api/admin/rides/:id", () => {
    it("admin deletes a ride; row is gone", async () => {
      const admin = await createAdminUser();
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id);

      const res = await request(app)
        .delete(`/api/admin/rides/${ride.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const dbRide = await prisma.ride.findUnique({ where: { id: ride.id } });
      expect(dbRide).toBeNull();
    });

    it("returns 400 for a malformed id", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .delete(`/api/admin/rides/${SHORT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(400);
    });

    it("returns 500 (P2025) for a nonexistent ride", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .delete(`/api/admin/rides/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(500);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id);
      const res = await request(app)
        .delete(`/api/admin/rides/${ride.id}`)
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // DELETE /api/admin/clubs/:id  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("DELETE /api/admin/clubs/:id", () => {
    it("admin deletes a club; row is gone", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id);

      const res = await request(app)
        .delete(`/api/admin/clubs/${club.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const dbClub = await prisma.club.findUnique({ where: { id: club.id } });
      expect(dbClub).toBeNull();
    });

    it("returns 500 (P2025) for a nonexistent club", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .delete(`/api/admin/clubs/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(500);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id);
      const res = await request(app)
        .delete(`/api/admin/clubs/${club.id}`)
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /api/admin/marketplace/:id/status  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/admin/marketplace/:id/status", () => {
    it("admin updates listing status; persists", async () => {
      const admin = await createAdminUser();
      const seller = await createTestUser();
      const listing = await createTestListing(seller.user.id);

      const res = await request(app)
        .patch(`/api/admin/marketplace/${listing.id}/status`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ status: "INACTIVE" });

      expect(res.status).toBe(200);
      expect(res.body.data.listing.status).toBe("INACTIVE");

      const dbListing = await prisma.marketplaceListing.findUnique({
        where: { id: listing.id },
      });
      expect(dbListing?.status).toBe("INACTIVE");
    });

    it("returns 400 when status is missing", async () => {
      const admin = await createAdminUser();
      const seller = await createTestUser();
      const listing = await createTestListing(seller.user.id);
      const res = await request(app)
        .patch(`/api/admin/marketplace/${listing.id}/status`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const owner = await createTestUser();
      const listing = await createTestListing(owner.user.id);
      const res = await request(app)
        .patch(`/api/admin/marketplace/${listing.id}/status`)
        .set("Authorization", `Bearer ${seller.token}`)
        .send({ status: "INACTIVE" });
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // DELETE /api/admin/marketplace/:id  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("DELETE /api/admin/marketplace/:id", () => {
    it("admin deletes a listing; row is gone", async () => {
      const admin = await createAdminUser();
      const seller = await createTestUser();
      const listing = await createTestListing(seller.user.id);

      const res = await request(app)
        .delete(`/api/admin/marketplace/${listing.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const dbListing = await prisma.marketplaceListing.findUnique({
        where: { id: listing.id },
      });
      expect(dbListing).toBeNull();
    });

    it("returns 500 (P2025) for a nonexistent listing", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .delete(`/api/admin/marketplace/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(500);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const owner = await createTestUser();
      const listing = await createTestListing(owner.user.id);
      const res = await request(app)
        .delete(`/api/admin/marketplace/${listing.id}`)
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Featured toggles  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/admin/rides/:id/featured", () => {
    it("admin toggles ride featured; persists", async () => {
      const admin = await createAdminUser();
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id);

      const res = await request(app)
        .patch(`/api/admin/rides/${ride.id}/featured`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ isFeatured: true });

      expect(res.status).toBe(200);
      expect(res.body.data.isFeatured).toBe(true);

      const dbRide = await prisma.ride.findUnique({ where: { id: ride.id } });
      expect(dbRide?.isFeatured).toBe(true);
    });

    it("returns 500 (P2025) for a nonexistent ride", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/rides/${NONEXISTENT_ID}/featured`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ isFeatured: true });
      expect(res.status).toBe(500);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id);
      const res = await request(app)
        .patch(`/api/admin/rides/${ride.id}/featured`)
        .set("Authorization", `Bearer ${seller.token}`)
        .send({ isFeatured: true });
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/admin/events/:id/featured", () => {
    it("admin toggles event featured; persists", async () => {
      const admin = await createAdminUser();
      const creator = await createTestUser();
      const event = await makeEvent(creator.user.id);

      const res = await request(app)
        .patch(`/api/admin/events/${event.id}/featured`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ isFeatured: true });

      expect(res.status).toBe(200);
      expect(res.body.data.isFeatured).toBe(true);

      const dbEvent = await prisma.event.findUnique({ where: { id: event.id } });
      expect(dbEvent?.isFeatured).toBe(true);
    });

    it("returns 500 (P2025) for a nonexistent event", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/events/${NONEXISTENT_ID}/featured`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ isFeatured: true });
      expect(res.status).toBe(500);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const creator = await createTestUser();
      const event = await makeEvent(creator.user.id);
      const res = await request(app)
        .patch(`/api/admin/events/${event.id}/featured`)
        .set("Authorization", `Bearer ${seller.token}`)
        .send({ isFeatured: true });
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/admin/clubs/:id/featured", () => {
    it("admin toggles club featured; persists", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id);

      const res = await request(app)
        .patch(`/api/admin/clubs/${club.id}/featured`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ isFeatured: true });

      expect(res.status).toBe(200);
      expect(res.body.data.isFeatured).toBe(true);

      const dbClub = await prisma.club.findUnique({ where: { id: club.id } });
      expect(dbClub?.isFeatured).toBe(true);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id);
      const res = await request(app)
        .patch(`/api/admin/clubs/${club.id}/featured`)
        .set("Authorization", `Bearer ${seller.token}`)
        .send({ isFeatured: true });
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/approvals  (requireAdmin)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/approvals", () => {
    it("admin gets pending clubs / club requests / ride requests grouped", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      await createTestClub(owner.user.id, { verified: false });

      const res = await request(app)
        .get("/api/admin/approvals")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("pendingClubs");
      expect(res.body.data).toHaveProperty("pendingClubRequests");
      expect(res.body.data).toHaveProperty("pendingRideRequests");
      expect(Array.isArray(res.body.data.pendingClubs)).toBe(true);
    });

    it("rejects unauthenticated with 401", async () => {
      const res = await request(app).get("/api/admin/approvals");
      expect(res.status).toBe(401);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .get("/api/admin/approvals")
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Club join request approve / reject  (requireAdmin, guarded => 404)
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/admin/club-join-requests/:requestId/approve", () => {
    it("approves request and creates membership", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id);
      const requester = await createTestUser();
      const joinReq = await prisma.clubJoinRequest.create({
        data: { clubId: club.id, userId: requester.user.id, status: "PENDING" },
      });

      const res = await request(app)
        .post(`/api/admin/club-join-requests/${joinReq.id}/approve`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("APPROVED");

      const member = await prisma.clubMember.findUnique({
        where: {
          clubId_userId: { clubId: club.id, userId: requester.user.id },
        },
      });
      expect(member).not.toBeNull();
    });

    it("returns 404 for a nonexistent request (guarded)", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post(`/api/admin/club-join-requests/${NONEXISTENT_ID}/approve`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(404);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .post(`/api/admin/club-join-requests/${NONEXISTENT_ID}/approve`)
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/admin/club-join-requests/:requestId/reject", () => {
    it("rejects a pending request; status becomes REJECTED", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id);
      const requester = await createTestUser();
      const joinReq = await prisma.clubJoinRequest.create({
        data: { clubId: club.id, userId: requester.user.id, status: "PENDING" },
      });

      const res = await request(app)
        .post(`/api/admin/club-join-requests/${joinReq.id}/reject`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("REJECTED");

      const dbReq = await prisma.clubJoinRequest.findUnique({
        where: { id: joinReq.id },
      });
      expect(dbReq?.status).toBe("REJECTED");
    });

    it("returns 404 for a nonexistent request (guarded)", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post(`/api/admin/club-join-requests/${NONEXISTENT_ID}/reject`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(404);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .post(`/api/admin/club-join-requests/${NONEXISTENT_ID}/reject`)
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Ride participant accept / decline  (requireAdmin, guarded => 404)
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/admin/ride-participants/:participantId/accept", () => {
    it("accepts a participant; status becomes ACCEPTED", async () => {
      const admin = await createAdminUser();
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id);
      const rider = await createTestUser();
      const participant = await prisma.rideParticipant.create({
        data: { rideId: ride.id, userId: rider.user.id, status: "REQUESTED" },
      });

      const res = await request(app)
        .post(`/api/admin/ride-participants/${participant.id}/accept`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("ACCEPTED");

      const dbP = await prisma.rideParticipant.findUnique({
        where: { id: participant.id },
      });
      expect(dbP?.status).toBe("ACCEPTED");
    });

    it("returns 404 for a nonexistent participant (guarded)", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post(`/api/admin/ride-participants/${NONEXISTENT_ID}/accept`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(404);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .post(`/api/admin/ride-participants/${NONEXISTENT_ID}/accept`)
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/admin/ride-participants/:participantId/decline", () => {
    it("declines a participant; status becomes DECLINED", async () => {
      const admin = await createAdminUser();
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id);
      const rider = await createTestUser();
      const participant = await prisma.rideParticipant.create({
        data: { rideId: ride.id, userId: rider.user.id, status: "REQUESTED" },
      });

      const res = await request(app)
        .post(`/api/admin/ride-participants/${participant.id}/decline`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("DECLINED");

      const dbP = await prisma.rideParticipant.findUnique({
        where: { id: participant.id },
      });
      expect(dbP?.status).toBe("DECLINED");
    });

    it("returns 404 for a nonexistent participant (guarded)", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post(`/api/admin/ride-participants/${NONEXISTENT_ID}/decline`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(404);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .post(`/api/admin/ride-participants/${NONEXISTENT_ID}/decline`)
        .set("Authorization", `Bearer ${seller.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Bulk routes  (requireAdmin, body validated via bulkIdsSchema in-handler)
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/admin/bulk/clubs/verify", () => {
    it("verifies multiple clubs; returns updated count", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const club1 = await createTestClub(owner.user.id, { verified: false });
      const club2 = await createTestClub(owner.user.id, { verified: false });

      const res = await request(app)
        .post("/api/admin/bulk/clubs/verify")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ ids: [club1.id, club2.id] });

      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBe(2);

      const verified = await prisma.club.count({
        where: { id: { in: [club1.id, club2.id] }, verified: true },
      });
      expect(verified).toBe(2);
    });

    it("returns 400 for an empty ids array", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post("/api/admin/bulk/clubs/verify")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ ids: [] });
      expect(res.status).toBe(400);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .post("/api/admin/bulk/clubs/verify")
        .set("Authorization", `Bearer ${seller.token}`)
        .send({ ids: ["x"] });
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/admin/bulk/club-join-requests/approve", () => {
    it("bulk approves pending requests and creates memberships", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const club = await createTestClub(owner.user.id);
      const r1 = await createTestUser();
      const r2 = await createTestUser();
      const jr1 = await prisma.clubJoinRequest.create({
        data: { clubId: club.id, userId: r1.user.id, status: "PENDING" },
      });
      const jr2 = await prisma.clubJoinRequest.create({
        data: { clubId: club.id, userId: r2.user.id, status: "PENDING" },
      });

      const res = await request(app)
        .post("/api/admin/bulk/club-join-requests/approve")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ ids: [jr1.id, jr2.id] });

      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBe(2);

      const members = await prisma.clubMember.count({
        where: { clubId: club.id },
      });
      expect(members).toBeGreaterThanOrEqual(2);
    });

    it("returns 400 for missing ids", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post("/api/admin/bulk/club-join-requests/approve")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .post("/api/admin/bulk/club-join-requests/approve")
        .set("Authorization", `Bearer ${seller.token}`)
        .send({ ids: ["x"] });
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/admin/bulk/ride-participants/accept", () => {
    it("bulk accepts requested participants; returns count", async () => {
      const admin = await createAdminUser();
      const creator = await createTestUser();
      const ride = await createTestRide(creator.user.id);
      const u1 = await createTestUser();
      const u2 = await createTestUser();
      const p1 = await prisma.rideParticipant.create({
        data: { rideId: ride.id, userId: u1.user.id, status: "REQUESTED" },
      });
      const p2 = await prisma.rideParticipant.create({
        data: { rideId: ride.id, userId: u2.user.id, status: "REQUESTED" },
      });

      const res = await request(app)
        .post("/api/admin/bulk/ride-participants/accept")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ ids: [p1.id, p2.id] });

      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBe(2);

      const accepted = await prisma.rideParticipant.count({
        where: { id: { in: [p1.id, p2.id] }, status: "ACCEPTED" },
      });
      expect(accepted).toBe(2);
    });

    it("returns 400 for an empty ids array", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post("/api/admin/bulk/ride-participants/accept")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ ids: [] });
      expect(res.status).toBe(400);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .post("/api/admin/bulk/ride-participants/accept")
        .set("Authorization", `Bearer ${seller.token}`)
        .send({ ids: ["x"] });
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/admin/bulk/businesses/approve", () => {
    it("bulk approves SUBMITTED businesses; verification becomes APPROVED", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const b1 = await makeBusiness(owner.user.id, {
        verification: "SUBMITTED",
      });
      const b2 = await makeBusiness(owner.user.id, {
        verification: "SUBMITTED",
      });

      const res = await request(app)
        .post("/api/admin/bulk/businesses/approve")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ ids: [b1.id, b2.id] });

      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBe(2);

      const approved = await prisma.businessProfile.count({
        where: { id: { in: [b1.id, b2.id] }, verification: "APPROVED" },
      });
      expect(approved).toBe(2);
    });

    it("returns 400 for an empty ids array", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post("/api/admin/bulk/businesses/approve")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ ids: [] });
      expect(res.status).toBe(400);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .post("/api/admin/bulk/businesses/approve")
        .set("Authorization", `Bearer ${seller.token}`)
        .send({ ids: ["x"] });
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/admin/bulk/ad-campaigns/approve", () => {
    it("bulk approves PENDING_APPROVAL campaigns; status becomes ACTIVE", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const business = await makeBusiness(owner.user.id);
      const c1 = await makeCampaign(business.id, {
        status: "PENDING_APPROVAL",
      });
      const c2 = await makeCampaign(business.id, {
        status: "PENDING_APPROVAL",
      });

      const res = await request(app)
        .post("/api/admin/bulk/ad-campaigns/approve")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ ids: [c1.id, c2.id] });

      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBe(2);

      const active = await prisma.adCampaign.count({
        where: { id: { in: [c1.id, c2.id] }, status: "ACTIVE" },
      });
      expect(active).toBe(2);
    });

    it("returns 400 for missing ids", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post("/api/admin/bulk/ad-campaigns/approve")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it("rejects non-admin with 403", async () => {
      const seller = await createUserWithRole("SELLER");
      const res = await request(app)
        .post("/api/admin/bulk/ad-campaigns/approve")
        .set("Authorization", `Bearer ${seller.token}`)
        .send({ ids: ["x"] });
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // COMMERCE SUB-ROUTER (admin.commerce.routes.ts) — mounted at "/" with its
  // own requireAuth + requireAdmin. Plain users (no roles) => 403.
  // ═══════════════════════════════════════════════════════════════════════

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/businesses
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/businesses", () => {
    it("admin lists businesses in a paginated envelope", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      await makeBusiness(owner.user.id);

      const res = await request(app)
        .get("/api/admin/businesses")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toHaveProperty("total");
    });

    it("filters by status (verification)", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id, {
        verification: "APPROVED",
      });

      const res = await request(app)
        .get("/api/admin/businesses?status=APPROVED")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((b: any) => b.id);
      expect(ids).toContain(biz.id);
    });

    it("filters by search term", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id, {
        displayName: "Findable Motors",
      });

      const res = await request(app)
        .get("/api/admin/businesses?search=Findable")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((b: any) => b.id);
      expect(ids).toContain(biz.id);
    });

    it("returns 400 for an invalid status enum", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .get("/api/admin/businesses?status=NOPE")
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(400);
    });

    it("rejects unauthenticated with 401", async () => {
      const res = await request(app).get("/api/admin/businesses");
      expect(res.status).toBe(401);
    });

    it("rejects a plain user (no admin role) with 403", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .get("/api/admin/businesses")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it("CO_ADMIN is allowed (requireAdmin)", async () => {
      const coAdmin = await createUserWithRole("CO_ADMIN");
      const res = await request(app)
        .get("/api/admin/businesses")
        .set("Authorization", `Bearer ${coAdmin.token}`);
      expect(res.status).toBe(200);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/businesses/:id  (guarded => 404)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/businesses/:id", () => {
    it("admin gets a business with campaigns + discounts", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);

      const res = await request(app)
        .get(`/api/admin/businesses/${biz.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("id", biz.id);
      expect(res.body.data).toHaveProperty("campaigns");
      expect(res.body.data).toHaveProperty("discounts");
      expect(res.body.data).toHaveProperty("owner");
    });

    it("returns 404 for a nonexistent business (guarded)", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .get(`/api/admin/businesses/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(404);
    });

    it("rejects a plain user with 403", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .get(`/api/admin/businesses/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /api/admin/businesses/:id
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/admin/businesses/:id", () => {
    it("admin updates safe fields; persists", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);

      const res = await request(app)
        .patch(`/api/admin/businesses/${biz.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({
          displayName: "Renamed Biz",
          verification: "APPROVED",
          tagline: "We ride",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.displayName).toBe("Renamed Biz");
      expect(res.body.data.verification).toBe("APPROVED");

      const dbBiz = await prisma.businessProfile.findUnique({
        where: { id: biz.id },
      });
      expect(dbBiz?.displayName).toBe("Renamed Biz");
      expect(dbBiz?.verification).toBe("APPROVED");
    });

    it("returns 400 for an invalid field (bad email)", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const res = await request(app)
        .patch(`/api/admin/businesses/${biz.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ email: "not-an-email" });
      expect(res.status).toBe(400);
    });

    it("returns 500 (P2025) for a nonexistent business", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/businesses/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ displayName: "Ghost Biz" });
      expect(res.status).toBe(500);
    });

    it("rejects a plain user with 403", async () => {
      const { token } = await createTestUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const res = await request(app)
        .patch(`/api/admin/businesses/${biz.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ displayName: "Hax" });
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // DELETE /api/admin/businesses/:id
  // ───────────────────────────────────────────────────────────────────────
  describe("DELETE /api/admin/businesses/:id", () => {
    it("admin deletes a business (cascades campaigns/discounts)", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const campaign = await makeCampaign(biz.id);

      const res = await request(app)
        .delete(`/api/admin/businesses/${biz.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      createdBusinessIds.delete(biz.id);
      createdCampaignIds.delete(campaign.id);

      const dbBiz = await prisma.businessProfile.findUnique({
        where: { id: biz.id },
      });
      expect(dbBiz).toBeNull();
      // Cascade removed the campaign too.
      const dbCampaign = await prisma.adCampaign.findUnique({
        where: { id: campaign.id },
      });
      expect(dbCampaign).toBeNull();
    });

    it("returns 500 (P2025) for a nonexistent business", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .delete(`/api/admin/businesses/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(500);
    });

    it("rejects a plain user with 403", async () => {
      const { token } = await createTestUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const res = await request(app)
        .delete(`/api/admin/businesses/${biz.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/ad-campaigns
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/ad-campaigns", () => {
    it("admin lists campaigns in a paginated envelope", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      await makeCampaign(biz.id);

      const res = await request(app)
        .get("/api/admin/ad-campaigns")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });

    it("filters by businessId and status", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const campaign = await makeCampaign(biz.id, { status: "ACTIVE" });

      const res = await request(app)
        .get(`/api/admin/ad-campaigns?businessId=${biz.id}&status=ACTIVE`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((c: any) => c.id);
      expect(ids).toContain(campaign.id);
    });

    it("returns 400 for an invalid status enum", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .get("/api/admin/ad-campaigns?status=NOPE")
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(400);
    });

    it("rejects a plain user with 403", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .get("/api/admin/ad-campaigns")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /api/admin/ad-campaigns/:id
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/admin/ad-campaigns/:id", () => {
    it("admin updates a campaign; persists (incl. date coercion)", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const campaign = await makeCampaign(biz.id);
      const newStart = new Date(Date.now() + 86400000).toISOString();

      const res = await request(app)
        .patch(`/api/admin/ad-campaigns/${campaign.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ title: "Updated Campaign", startsAt: newStart });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("Updated Campaign");

      const dbCampaign = await prisma.adCampaign.findUnique({
        where: { id: campaign.id },
      });
      expect(dbCampaign?.title).toBe("Updated Campaign");
    });

    it("returns 400 for an invalid field (bad ctaUrl)", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const campaign = await makeCampaign(biz.id);
      const res = await request(app)
        .patch(`/api/admin/ad-campaigns/${campaign.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ ctaUrl: "not a url" });
      expect(res.status).toBe(400);
    });

    it("returns 500 (P2025) for a nonexistent campaign", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/ad-campaigns/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ title: "Ghost Campaign" });
      expect(res.status).toBe(500);
    });

    it("rejects a plain user with 403", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .patch(`/api/admin/ad-campaigns/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "Hax" });
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/admin/ad-campaigns/:id/approve|reject|pause
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/admin/ad-campaigns/:id/approve", () => {
    it("approves a campaign; status becomes ACTIVE and notes saved", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const campaign = await makeCampaign(biz.id);

      const res = await request(app)
        .post(`/api/admin/ad-campaigns/${campaign.id}/approve`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ notes: "Looks good" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("ACTIVE");

      const dbCampaign = await prisma.adCampaign.findUnique({
        where: { id: campaign.id },
      });
      expect(dbCampaign?.status).toBe("ACTIVE");
      expect(dbCampaign?.reviewNotes).toBe("Looks good");
    });

    it("approves with an empty body (notes optional)", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const campaign = await makeCampaign(biz.id);

      const res = await request(app)
        .post(`/api/admin/ad-campaigns/${campaign.id}/approve`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({});
      expect(res.status).toBe(200);
    });

    it("returns 500 (P2025) for a nonexistent campaign", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post(`/api/admin/ad-campaigns/${NONEXISTENT_ID}/approve`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({});
      expect(res.status).toBe(500);
    });

    it("rejects a plain user with 403", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .post(`/api/admin/ad-campaigns/${NONEXISTENT_ID}/approve`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/admin/ad-campaigns/:id/reject", () => {
    it("rejects a campaign; status becomes REJECTED", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const campaign = await makeCampaign(biz.id);

      const res = await request(app)
        .post(`/api/admin/ad-campaigns/${campaign.id}/reject`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ notes: "Policy violation" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("REJECTED");

      const dbCampaign = await prisma.adCampaign.findUnique({
        where: { id: campaign.id },
      });
      expect(dbCampaign?.status).toBe("REJECTED");
    });

    it("returns 500 (P2025) for a nonexistent campaign", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post(`/api/admin/ad-campaigns/${NONEXISTENT_ID}/reject`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({});
      expect(res.status).toBe(500);
    });

    it("rejects a plain user with 403", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .post(`/api/admin/ad-campaigns/${NONEXISTENT_ID}/reject`)
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/admin/ad-campaigns/:id/pause", () => {
    it("pauses a campaign; status becomes PAUSED", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const campaign = await makeCampaign(biz.id, { status: "ACTIVE" });

      const res = await request(app)
        .post(`/api/admin/ad-campaigns/${campaign.id}/pause`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("PAUSED");

      const dbCampaign = await prisma.adCampaign.findUnique({
        where: { id: campaign.id },
      });
      expect(dbCampaign?.status).toBe("PAUSED");
    });

    it("returns 500 (P2025) for a nonexistent campaign", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .post(`/api/admin/ad-campaigns/${NONEXISTENT_ID}/pause`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(500);
    });

    it("rejects a plain user with 403", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .post(`/api/admin/ad-campaigns/${NONEXISTENT_ID}/pause`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // DELETE /api/admin/ad-campaigns/:id
  // ───────────────────────────────────────────────────────────────────────
  describe("DELETE /api/admin/ad-campaigns/:id", () => {
    it("admin deletes a campaign; row is gone", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const campaign = await makeCampaign(biz.id);

      const res = await request(app)
        .delete(`/api/admin/ad-campaigns/${campaign.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      createdCampaignIds.delete(campaign.id);

      const dbCampaign = await prisma.adCampaign.findUnique({
        where: { id: campaign.id },
      });
      expect(dbCampaign).toBeNull();
    });

    it("returns 500 (P2025) for a nonexistent campaign", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .delete(`/api/admin/ad-campaigns/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(500);
    });

    it("rejects a plain user with 403", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .delete(`/api/admin/ad-campaigns/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/admin/discounts
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/admin/discounts", () => {
    it("admin lists discounts in a paginated envelope", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      await makeDiscount(biz.id);

      const res = await request(app)
        .get("/api/admin/discounts")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });

    it("filters by businessId", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const discount = await makeDiscount(biz.id);

      const res = await request(app)
        .get(`/api/admin/discounts?businessId=${biz.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((d: any) => d.id);
      expect(ids).toContain(discount.id);
    });

    it("filters by isFeatured", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const discount = await makeDiscount(biz.id, { isFeatured: true });

      const res = await request(app)
        .get("/api/admin/discounts?isFeatured=true")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((d: any) => d.id);
      expect(ids).toContain(discount.id);
    });

    it("rejects a plain user with 403", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .get("/api/admin/discounts")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /api/admin/discounts/:id
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/admin/discounts/:id", () => {
    it("admin updates a discount; persists (incl. date coercion)", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const discount = await makeDiscount(biz.id);
      const newUntil = new Date(Date.now() + 30 * 86400000).toISOString();

      const res = await request(app)
        .patch(`/api/admin/discounts/${discount.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ title: "Updated Discount", validUntil: newUntil });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("Updated Discount");

      const dbDiscount = await prisma.discount.findUnique({
        where: { id: discount.id },
      });
      expect(dbDiscount?.title).toBe("Updated Discount");
    });

    it("returns 400 for an invalid field (percentOff > 100)", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const discount = await makeDiscount(biz.id);
      const res = await request(app)
        .patch(`/api/admin/discounts/${discount.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ percentOff: 150 });
      expect(res.status).toBe(400);
    });

    it("returns 500 (P2025) for a nonexistent discount", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .patch(`/api/admin/discounts/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ title: "Ghost Discount" });
      expect(res.status).toBe(500);
    });

    it("rejects a plain user with 403", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .patch(`/api/admin/discounts/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "Hax" });
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // DELETE /api/admin/discounts/:id
  // ───────────────────────────────────────────────────────────────────────
  describe("DELETE /api/admin/discounts/:id", () => {
    it("admin deletes a discount; row is gone", async () => {
      const admin = await createAdminUser();
      const owner = await createTestUser();
      const biz = await makeBusiness(owner.user.id);
      const discount = await makeDiscount(biz.id);

      const res = await request(app)
        .delete(`/api/admin/discounts/${discount.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      createdDiscountIds.delete(discount.id);

      const dbDiscount = await prisma.discount.findUnique({
        where: { id: discount.id },
      });
      expect(dbDiscount).toBeNull();
    });

    it("returns 500 (P2025) for a nonexistent discount", async () => {
      const admin = await createAdminUser();
      const res = await request(app)
        .delete(`/api/admin/discounts/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);
      expect(res.status).toBe(500);
    });

    it("rejects a plain user with 403", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .delete(`/api/admin/discounts/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });
});
