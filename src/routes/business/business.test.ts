/**
 * BUSINESS ROUTES TESTS
 *
 * Comprehensive integration coverage for every endpoint mounted at
 * /api/business (see src/server.ts -> app.use("/api/business", businessRoutes)).
 *
 * Notes drawn from reading the source (business.routes.ts + apiResponse.ts):
 *  - ApiResponse.success always returns HTTP 200 (there is no 201 in this
 *    module — even "created" resources come back as 200).
 *  - ApiResponse.paginated nests data under data:{ items, pagination }.
 *  - The local idParamSchema is z.string().min(1) (NOT the 20-36 char global
 *    one), so any non-empty id passes param validation; a well-formed but
 *    nonexistent id therefore reaches the DB lookup and yields 404.
 *  - requireAuth (Better Auth mock) returns 401 when no Authorization header is
 *    present.
 *  - isStaff() only passes for ADMIN / CO_ADMIN. requireRole(ADMIN) only passes
 *    for ADMIN. BRAND_OWNER does NOT grant staff override.
 *  - cleanupTestData() does NOT touch business tables, so afterEach wipes this
 *    module's rows (FK children first) before delegating to cleanupTestData().
 */

import request from "supertest";
import { app } from "../../server";
import prisma from "../../lib/prisma";
import { createTestUser, cleanupTestData } from "../../test/utils";

// ─── Helpers ────────────────────────────────────────────────────────────────

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// A well-formed (non-empty) but guaranteed-nonexistent id for 404 paths.
const MISSING_ID = "nonexistentbiz0000000000";

let slugSeq = 0;
function uniqueSlug() {
  return `biz-${Date.now().toString(36)}-${slugSeq++}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/** Create a BusinessProfile row directly with the real required fields. */
async function createBusiness(
  ownerId: string,
  overrides: Record<string, any> = {},
) {
  return prisma.businessProfile.create({
    data: {
      ownerId,
      categories: ["BRAND"],
      displayName: "Acme Motors",
      slug: uniqueSlug(),
      verification: "PENDING",
      ...overrides,
    },
  });
}

/** Resolve a BUSINESS system role id (Task 3: BrandMember.role enum -> roleId FK). */
async function businessRoleId(slug: string): Promise<string> {
  const role = await prisma.role.findFirstOrThrow({
    where: { slug: slug.toLowerCase(), scope: "BUSINESS", scopeId: null },
    select: { id: true },
  });
  return role.id;
}

/** Promote a user to ADMIN (so isStaff() / requireRole(ADMIN) pass). */
async function makeAdmin(userId: string) {
  // Task 3: UserRoleAssignment.role enum -> roleId FK. Assign the GLOBAL admin
  // role row (slug "admin"); requireAuth maps it to "ADMIN" and the business
  // permission resolver treats it as a platform-admin bypass.
  let adminRole = await prisma.role.findFirst({
    where: { slug: "admin", scope: "GLOBAL" },
    select: { id: true },
  });
  if (!adminRole) {
    adminRole = await prisma.role.create({
      data: { name: "Admin", slug: "admin", scope: "GLOBAL", isSystem: true },
      select: { id: true },
    });
  }
  await prisma.userRoleAssignment.upsert({
    where: { userId_roleId: { userId, roleId: adminRole.id } },
    create: { userId, roleId: adminRole.id },
    update: {},
  });
}

const future = (daysFromNow: number) =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString();

const validCampaign = () => ({
  title: "Summer Sale",
  ctaLabel: "Shop now",
  ctaUrl: "https://example.com/shop",
  imageUrl: "https://example.com/banner.png",
  startsAt: future(1),
  endsAt: future(30),
  budgetPaise: 10000,
  slots: ["HOME_FEED"],
  targetTags: ["touring"],
});

const validDiscount = () => ({
  title: "Festive 20% Off",
  percentOff: 20,
  validFrom: future(0),
  validUntil: future(30),
});

// ─── Isolation ──────────────────────────────────────────────────────────────

describe("Business Routes (/api/business)", () => {
  afterEach(async () => {
    // FK children before parents, then users via cleanupTestData().
    await prisma.businessInquiry.deleteMany({});
    await prisma.brandProduct.deleteMany({});
    await prisma.serviceListing.deleteMany({});
    await prisma.brandMember.deleteMany({});
    await prisma.discount.deleteMany({});
    await prisma.adCampaign.deleteMany({});
    await prisma.businessProfile.deleteMany({});
    await cleanupTestData();
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /  — public discovery (approved only)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/business", () => {
    it("lists only APPROVED businesses with pagination envelope", async () => {
      const { user, token } = await createTestUser();
      await createBusiness(user.id, {
        verification: "APPROVED",
        displayName: "Visible Co",
      });
      await createBusiness(user.id, {
        verification: "PENDING",
        displayName: "Hidden Co",
      });

      const res = await request(app)
        .get("/api/business?page=1&limit=10")
        .set(auth(token));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("items");
      expect(res.body.data).toHaveProperty("pagination");
      expect(res.body.data.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      const names = res.body.data.items.map((b: any) => b.displayName);
      expect(names).toContain("Visible Co");
      expect(names).not.toContain("Hidden Co");
    });

    it("filters by category (hasSome)", async () => {
      const { user, token } = await createTestUser();
      await createBusiness(user.id, {
        verification: "APPROVED",
        categories: ["MECHANIC"],
        displayName: "Fix It",
      });
      await createBusiness(user.id, {
        verification: "APPROVED",
        categories: ["BRAND"],
        displayName: "Brand Co",
      });

      const res = await request(app)
        .get("/api/business?category=MECHANIC")
        .set(auth(token));

      expect(res.status).toBe(200);
      const names = res.body.data.items.map((b: any) => b.displayName);
      expect(names).toContain("Fix It");
      expect(names).not.toContain("Brand Co");
    });

    it("searches by displayName (case-insensitive)", async () => {
      const { user, token } = await createTestUser();
      await createBusiness(user.id, {
        verification: "APPROVED",
        displayName: "Royal Enfield Garage",
      });

      const res = await request(app)
        .get("/api/business?search=royal")
        .set(auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
    });

    it("rejects invalid category enum with 400", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .get("/api/business?category=NOT_A_CATEGORY")
        .set(auth(token));
      expect(res.status).toBe(400);
    });

    it("rejects out-of-range limit (>50) with 400", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .get("/api/business?limit=999")
        .set(auth(token));
      expect(res.status).toBe(400);
    });

    it("requires authentication (401)", async () => {
      const res = await request(app).get("/api/business");
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /me — owner dashboard
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/business/me", () => {
    it("returns only the caller's businesses regardless of verification", async () => {
      const owner = await createTestUser();
      const other = await createTestUser();
      await createBusiness(owner.user.id, { displayName: "Mine A" });
      await createBusiness(owner.user.id, {
        displayName: "Mine B",
        verification: "APPROVED",
      });
      await createBusiness(other.user.id, { displayName: "Not Mine" });

      const res = await request(app)
        .get("/api/business/me")
        .set(auth(owner.token));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const names = res.body.data.map((b: any) => b.displayName);
      expect(names.sort()).toEqual(["Mine A", "Mine B"]);
      expect(names).not.toContain("Not Mine");
    });

    it("requires authentication (401)", async () => {
      const res = await request(app).get("/api/business/me");
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /:id — single business (public, with owner-can-see-draft rule)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/business/:id", () => {
    it("returns an approved business to any authenticated viewer", async () => {
      const owner = await createTestUser();
      const viewer = await createTestUser();
      const biz = await createBusiness(owner.user.id, {
        verification: "APPROVED",
      });

      const res = await request(app)
        .get(`/api/business/${biz.id}`)
        .set(auth(viewer.token));

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(biz.id);
      expect(res.body.data.owner).toHaveProperty("id", owner.user.id);
    });

    it("lets the owner view their own unapproved draft", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id, {
        verification: "PENDING",
      });

      const res = await request(app)
        .get(`/api/business/${biz.id}`)
        .set(auth(owner.token));

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(biz.id);
    });

    it("hides an unapproved business from a non-owner (404)", async () => {
      const owner = await createTestUser();
      const viewer = await createTestUser();
      const biz = await createBusiness(owner.user.id, {
        verification: "PENDING",
      });

      const res = await request(app)
        .get(`/api/business/${biz.id}`)
        .set(auth(viewer.token));

      expect(res.status).toBe(404);
    });

    it("returns 404 for a nonexistent id", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .get(`/api/business/${MISSING_ID}`)
        .set(auth(token));
      expect(res.status).toBe(404);
    });

    it("requires authentication (401)", async () => {
      const biz = await createBusiness((await createTestUser()).user.id);
      const res = await request(app).get(`/api/business/${biz.id}`);
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST / — create draft
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/business", () => {
    it("creates a draft profile and persists it", async () => {
      const { user, token } = await createTestUser();

      const res = await request(app)
        .post("/api/business")
        .set(auth(token))
        .send({
          categories: ["BRAND"],
          displayName: "Thunder Bikes",
          tagline: "Ride loud",
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Business created");
      expect(res.body.data.displayName).toBe("Thunder Bikes");
      expect(res.body.data.ownerId).toBe(user.id);
      expect(res.body.data.verification).toBe("PENDING");
      expect(res.body.data.slug).toBeTruthy();

      const inDb = await prisma.businessProfile.findUnique({
        where: { id: res.body.data.id },
      });
      expect(inDb).not.toBeNull();
    });

    it("assigns BRAND_OWNER role when category is not CLUB", async () => {
      const { user, token } = await createTestUser();

      await request(app)
        .post("/api/business")
        .set(auth(token))
        .send({ categories: ["GEAR_SELLER"], displayName: "Gear Hub" });

      const role = await prisma.userRoleAssignment.findFirst({
        where: { userId: user.id, roleRecord: { slug: "brand_owner" } },
      });
      expect(role).not.toBeNull();
    });

    it("does NOT assign BRAND_OWNER role for a CLUB business", async () => {
      const { user, token } = await createTestUser();

      await request(app)
        .post("/api/business")
        .set(auth(token))
        .send({ categories: ["CLUB"], displayName: "Riders Club" });

      const role = await prisma.userRoleAssignment.findFirst({
        where: { userId: user.id, roleRecord: { slug: "brand_owner" } },
      });
      expect(role).toBeNull();
    });

    it("rejects empty categories array (400)", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .post("/api/business")
        .set(auth(token))
        .send({ categories: [], displayName: "No Cats" });
      expect(res.status).toBe(400);
    });

    it("rejects an invalid category enum (400)", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .post("/api/business")
        .set(auth(token))
        .send({ categories: ["NOPE"], displayName: "Bad Cat" });
      expect(res.status).toBe(400);
    });

    it("rejects too-short displayName (400)", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .post("/api/business")
        .set(auth(token))
        .send({ categories: ["BRAND"], displayName: "A" });
      expect(res.status).toBe(400);
    });

    it("requires authentication (401)", async () => {
      const res = await request(app)
        .post("/api/business")
        .send({ categories: ["BRAND"], displayName: "Anon Co" });
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /:id — update draft
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/business/:id", () => {
    it("updates owned business fields and persists", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id);

      const res = await request(app)
        .patch(`/api/business/${biz.id}`)
        .set(auth(owner.token))
        .send({ description: "We sell premium gear", city: "Mumbai" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Business updated");
      expect(res.body.data.description).toBe("We sell premium gear");

      const inDb = await prisma.businessProfile.findUnique({
        where: { id: biz.id },
      });
      expect(inDb?.city).toBe("Mumbai");
    });

    it("normalizes a bare websiteUrl by prefixing https://", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id);

      const res = await request(app)
        .patch(`/api/business/${biz.id}`)
        .set(auth(owner.token))
        .send({ websiteUrl: "acme.com" });

      expect(res.status).toBe(200);
      expect(res.body.data.websiteUrl).toBe("https://acme.com");
    });

    it("allows an ADMIN (staff) to update someone else's business", async () => {
      const owner = await createTestUser();
      const admin = await createTestUser();
      await makeAdmin(admin.user.id);
      const biz = await createBusiness(owner.user.id);

      const res = await request(app)
        .patch(`/api/business/${biz.id}`)
        .set(auth(admin.token))
        .send({ tagline: "Edited by admin" });

      expect(res.status).toBe(200);
      expect(res.body.data.tagline).toBe("Edited by admin");
    });

    it("forbids a non-owner non-staff user (403)", async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const biz = await createBusiness(owner.user.id);

      const res = await request(app)
        .patch(`/api/business/${biz.id}`)
        .set(auth(stranger.token))
        .send({ tagline: "hijack" });

      expect(res.status).toBe(403);
    });

    it("returns 409 when an APPROVED business changes categories", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id, {
        verification: "APPROVED",
        categories: ["BRAND"],
      });

      const res = await request(app)
        .patch(`/api/business/${biz.id}`)
        .set(auth(owner.token))
        .send({ categories: ["MECHANIC"] });

      expect(res.status).toBe(409);
    });

    it("allows an APPROVED business to edit content (no category change)", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id, {
        verification: "APPROVED",
        categories: ["BRAND"],
      });

      const res = await request(app)
        .patch(`/api/business/${biz.id}`)
        .set(auth(owner.token))
        .send({ description: "updated copy" });

      expect(res.status).toBe(200);
    });

    it("rejects an invalid latitude (out of range) with 400", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id);
      const res = await request(app)
        .patch(`/api/business/${biz.id}`)
        .set(auth(owner.token))
        .send({ latitude: 200 });
      expect(res.status).toBe(400);
    });

    it("returns 404 for a nonexistent id", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .patch(`/api/business/${MISSING_ID}`)
        .set(auth(token))
        .send({ tagline: "x" });
      expect(res.status).toBe(404);
    });

    it("requires authentication (401)", async () => {
      const biz = await createBusiness((await createTestUser()).user.id);
      const res = await request(app)
        .patch(`/api/business/${biz.id}`)
        .send({ tagline: "x" });
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /:id/documents
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/business/:id/documents", () => {
    it("attaches documents (merging with existing) and persists", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id, {
        documents: [{ type: "GST", url: "https://x/old.pdf" }],
      });

      const res = await request(app)
        .post(`/api/business/${biz.id}/documents`)
        .set(auth(owner.token))
        .send({
          documents: [{ type: "TRADE_LICENSE", url: "https://x/new.pdf" }],
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Documents attached");
      expect(res.body.data.documents).toHaveLength(2);
      // uploadedAt is auto-filled by the handler
      const added = res.body.data.documents.find(
        (d: any) => d.type === "TRADE_LICENSE",
      );
      expect(added.uploadedAt).toBeTruthy();
    });

    it("rejects an empty documents array (400)", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id);
      const res = await request(app)
        .post(`/api/business/${biz.id}/documents`)
        .set(auth(owner.token))
        .send({ documents: [] });
      expect(res.status).toBe(400);
    });

    it("rejects a document with a non-URL (400)", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id);
      const res = await request(app)
        .post(`/api/business/${biz.id}/documents`)
        .set(auth(owner.token))
        .send({ documents: [{ type: "GST", url: "not-a-url" }] });
      expect(res.status).toBe(400);
    });

    it("forbids a non-owner (403)", async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const biz = await createBusiness(owner.user.id);
      const res = await request(app)
        .post(`/api/business/${biz.id}/documents`)
        .set(auth(stranger.token))
        .send({ documents: [{ type: "GST", url: "https://x/d.pdf" }] });
      expect(res.status).toBe(403);
    });

    it("returns 404 for a nonexistent id", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .post(`/api/business/${MISSING_ID}/documents`)
        .set(auth(token))
        .send({ documents: [{ type: "GST", url: "https://x/d.pdf" }] });
      expect(res.status).toBe(404);
    });

    it("requires authentication (401)", async () => {
      const biz = await createBusiness((await createTestUser()).user.id);
      const res = await request(app)
        .post(`/api/business/${biz.id}/documents`)
        .send({ documents: [{ type: "GST", url: "https://x/d.pdf" }] });
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /:id/submit
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/business/:id/submit", () => {
    it("submits a complete draft for review and sets verification=SUBMITTED", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id, {
        displayName: "Complete Co",
        description: "All filled in",
        email: "shop@example.com",
      });

      const res = await request(app)
        .post(`/api/business/${biz.id}/submit`)
        .set(auth(owner.token));

      expect(res.status).toBe(200);
      expect(res.body.data.verification).toBe("SUBMITTED");

      const inDb = await prisma.businessProfile.findUnique({
        where: { id: biz.id },
      });
      expect(inDb?.verification).toBe("SUBMITTED");
    });

    it("returns 400 listing the missing required fields", async () => {
      const owner = await createTestUser();
      // displayName present (created), but no description and no phone/email.
      const biz = await createBusiness(owner.user.id);

      const res = await request(app)
        .post(`/api/business/${biz.id}/submit`)
        .set(auth(owner.token));

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("description");
      expect(res.body.message).toContain("phone or email");
    });

    it("returns 409 if already APPROVED", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id, {
        verification: "APPROVED",
        description: "x",
        email: "a@b.com",
      });

      const res = await request(app)
        .post(`/api/business/${biz.id}/submit`)
        .set(auth(owner.token));

      expect(res.status).toBe(409);
    });

    it("forbids a non-owner (403)", async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const biz = await createBusiness(owner.user.id, {
        description: "x",
        email: "a@b.com",
      });
      const res = await request(app)
        .post(`/api/business/${biz.id}/submit`)
        .set(auth(stranger.token));
      expect(res.status).toBe(403);
    });

    it("returns 404 for a nonexistent id", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .post(`/api/business/${MISSING_ID}/submit`)
        .set(auth(token));
      expect(res.status).toBe(404);
    });

    it("requires authentication (401)", async () => {
      const biz = await createBusiness((await createTestUser()).user.id);
      const res = await request(app).post(`/api/business/${biz.id}/submit`);
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /:id/approve  (ADMIN only)
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/business/:id/approve", () => {
    it("approves a business when called by an ADMIN", async () => {
      const owner = await createTestUser();
      const admin = await createTestUser();
      await makeAdmin(admin.user.id);
      const biz = await createBusiness(owner.user.id, {
        verification: "SUBMITTED",
      });

      const res = await request(app)
        .post(`/api/business/${biz.id}/approve`)
        .set(auth(admin.token))
        .send({ notes: "Looks good" });

      expect(res.status).toBe(200);
      expect(res.body.data.verification).toBe("APPROVED");
      expect(res.body.data.verificationNotes).toBe("Looks good");

      const inDb = await prisma.businessProfile.findUnique({
        where: { id: biz.id },
      });
      expect(inDb?.verification).toBe("APPROVED");
    });

    it("forbids a non-admin (403)", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id, {
        verification: "SUBMITTED",
      });
      // Owner is NOT an admin -> requireRole(ADMIN) blocks before handler.
      const res = await request(app)
        .post(`/api/business/${biz.id}/approve`)
        .set(auth(owner.token))
        .send({});
      expect(res.status).toBe(403);
    });

    it("requires authentication (401)", async () => {
      const biz = await createBusiness((await createTestUser()).user.id);
      const res = await request(app)
        .post(`/api/business/${biz.id}/approve`)
        .send({});
      expect(res.status).toBe(401);
    });

    it("errors for a nonexistent id (no existence check before prisma.update)", async () => {
      // The handler calls prisma.update directly; a missing row throws P2025
      // which asyncHandler maps to 500 (NOT 404). Asserting >= 400 keeps this
      // robust if the handler is later hardened to return 404.
      const admin = await createTestUser();
      await makeAdmin(admin.user.id);
      const res = await request(app)
        .post(`/api/business/${MISSING_ID}/approve`)
        .set(auth(admin.token))
        .send({});
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /:id/reject  (ADMIN only)
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/business/:id/reject", () => {
    it("rejects a business when called by an ADMIN", async () => {
      const owner = await createTestUser();
      const admin = await createTestUser();
      await makeAdmin(admin.user.id);
      const biz = await createBusiness(owner.user.id, {
        verification: "SUBMITTED",
      });

      const res = await request(app)
        .post(`/api/business/${biz.id}/reject`)
        .set(auth(admin.token))
        .send({ notes: "Incomplete docs" });

      expect(res.status).toBe(200);
      expect(res.body.data.verification).toBe("REJECTED");
      expect(res.body.data.verificationNotes).toBe("Incomplete docs");
    });

    it("forbids a non-admin (403)", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id);
      const res = await request(app)
        .post(`/api/business/${biz.id}/reject`)
        .set(auth(owner.token))
        .send({});
      expect(res.status).toBe(403);
    });

    it("requires authentication (401)", async () => {
      const biz = await createBusiness((await createTestUser()).user.id);
      const res = await request(app)
        .post(`/api/business/${biz.id}/reject`)
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Campaigns: GET / POST / PATCH / DELETE under /:id/campaigns
  // ───────────────────────────────────────────────────────────────────────
  describe("Campaigns", () => {
    describe("GET /api/business/:id/campaigns", () => {
      it("lists campaigns for the owner", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        await prisma.adCampaign.create({
          data: {
            businessId: biz.id,
            title: "C1",
            ctaLabel: "Go",
            imageUrl: "https://x/i.png",
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 86400000),
            slots: ["HOME_FEED"],
            status: "PENDING_APPROVAL",
          },
        });

        const res = await request(app)
          .get(`/api/business/${biz.id}/campaigns`)
          .set(auth(owner.token));

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data).toHaveLength(1);
      });

      it("forbids a non-owner (403)", async () => {
        const owner = await createTestUser();
        const stranger = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .get(`/api/business/${biz.id}/campaigns`)
          .set(auth(stranger.token));
        expect(res.status).toBe(403);
      });

      it("returns 404 for a nonexistent business", async () => {
        const { token } = await createTestUser();
        const res = await request(app)
          .get(`/api/business/${MISSING_ID}/campaigns`)
          .set(auth(token));
        expect(res.status).toBe(404);
      });

      it("requires authentication (401)", async () => {
        const biz = await createBusiness((await createTestUser()).user.id);
        const res = await request(app).get(`/api/business/${biz.id}/campaigns`);
        expect(res.status).toBe(401);
      });
    });

    describe("POST /api/business/:id/campaigns", () => {
      it("creates a campaign as PENDING_APPROVAL and persists", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);

        const res = await request(app)
          .post(`/api/business/${biz.id}/campaigns`)
          .set(auth(owner.token))
          .send(validCampaign());

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Campaign submitted for review");
        expect(res.body.data.status).toBe("PENDING_APPROVAL");
        expect(res.body.data.businessId).toBe(biz.id);

        const inDb = await prisma.adCampaign.findUnique({
          where: { id: res.body.data.id },
        });
        expect(inDb).not.toBeNull();
      });

      it("rejects when endsAt is missing (400)", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const { endsAt, ...rest } = validCampaign();
        const res = await request(app)
          .post(`/api/business/${biz.id}/campaigns`)
          .set(auth(owner.token))
          .send(rest);
        expect(res.status).toBe(400);
      });

      it("rejects an empty slots array (400)", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/campaigns`)
          .set(auth(owner.token))
          .send({ ...validCampaign(), slots: [] });
        expect(res.status).toBe(400);
      });

      it("rejects an invalid slot enum (400)", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/campaigns`)
          .set(auth(owner.token))
          .send({ ...validCampaign(), slots: ["NOWHERE"] });
        expect(res.status).toBe(400);
      });

      it("forbids a non-owner (403)", async () => {
        const owner = await createTestUser();
        const stranger = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/campaigns`)
          .set(auth(stranger.token))
          .send(validCampaign());
        expect(res.status).toBe(403);
      });
    });

    describe("PATCH /api/business/:id/campaigns/:cid", () => {
      it("updates a campaign and persists", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const camp = await prisma.adCampaign.create({
          data: {
            businessId: biz.id,
            title: "Old",
            ctaLabel: "Go",
            imageUrl: "https://x/i.png",
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 86400000),
            slots: ["HOME_FEED"],
            status: "PENDING_APPROVAL",
          },
        });

        const res = await request(app)
          .patch(`/api/business/${biz.id}/campaigns/${camp.id}`)
          .set(auth(owner.token))
          .send({ title: "New Title" });

        expect(res.status).toBe(200);
        expect(res.body.data.title).toBe("New Title");
      });

      it("re-enters review (status -> PENDING_APPROVAL) when editing an ACTIVE campaign", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const camp = await prisma.adCampaign.create({
          data: {
            businessId: biz.id,
            title: "Live",
            ctaLabel: "Go",
            imageUrl: "https://x/i.png",
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 86400000),
            slots: ["HOME_FEED"],
            status: "ACTIVE",
          },
        });

        const res = await request(app)
          .patch(`/api/business/${biz.id}/campaigns/${camp.id}`)
          .set(auth(owner.token))
          .send({ title: "Edited live" });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("PENDING_APPROVAL");
      });

      it("returns 404 when the campaign belongs to a different business", async () => {
        const owner = await createTestUser();
        const bizA = await createBusiness(owner.user.id);
        const bizB = await createBusiness(owner.user.id);
        const camp = await prisma.adCampaign.create({
          data: {
            businessId: bizB.id,
            title: "Other",
            ctaLabel: "Go",
            imageUrl: "https://x/i.png",
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 86400000),
            slots: ["HOME_FEED"],
            status: "PENDING_APPROVAL",
          },
        });

        const res = await request(app)
          .patch(`/api/business/${bizA.id}/campaigns/${camp.id}`)
          .set(auth(owner.token))
          .send({ title: "Updated" });
        expect(res.status).toBe(404);
      });

      it("forbids a non-owner (403)", async () => {
        const owner = await createTestUser();
        const stranger = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const camp = await prisma.adCampaign.create({
          data: {
            businessId: biz.id,
            title: "X",
            ctaLabel: "Go",
            imageUrl: "https://x/i.png",
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 86400000),
            slots: ["HOME_FEED"],
            status: "PENDING_APPROVAL",
          },
        });
        const res = await request(app)
          .patch(`/api/business/${biz.id}/campaigns/${camp.id}`)
          .set(auth(stranger.token))
          .send({ title: "Updated" });
        expect(res.status).toBe(403);
      });
    });

    describe("DELETE /api/business/:id/campaigns/:cid", () => {
      it("deletes a campaign and removes it from the DB", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const camp = await prisma.adCampaign.create({
          data: {
            businessId: biz.id,
            title: "ToDelete",
            ctaLabel: "Go",
            imageUrl: "https://x/i.png",
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 86400000),
            slots: ["HOME_FEED"],
            status: "PENDING_APPROVAL",
          },
        });

        const res = await request(app)
          .delete(`/api/business/${biz.id}/campaigns/${camp.id}`)
          .set(auth(owner.token));

        expect(res.status).toBe(200);
        const inDb = await prisma.adCampaign.findUnique({
          where: { id: camp.id },
        });
        expect(inDb).toBeNull();
      });

      it("returns 404 for a nonexistent campaign", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .delete(`/api/business/${biz.id}/campaigns/${MISSING_ID}`)
          .set(auth(owner.token));
        expect(res.status).toBe(404);
      });

      it("forbids a non-owner (403)", async () => {
        const owner = await createTestUser();
        const stranger = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const camp = await prisma.adCampaign.create({
          data: {
            businessId: biz.id,
            title: "X",
            ctaLabel: "Go",
            imageUrl: "https://x/i.png",
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 86400000),
            slots: ["HOME_FEED"],
            status: "PENDING_APPROVAL",
          },
        });
        const res = await request(app)
          .delete(`/api/business/${biz.id}/campaigns/${camp.id}`)
          .set(auth(stranger.token));
        expect(res.status).toBe(403);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Discounts: GET / POST / PATCH / DELETE under /:id/discounts
  // ───────────────────────────────────────────────────────────────────────
  describe("Discounts", () => {
    describe("GET /api/business/:id/discounts", () => {
      it("lists discounts for the owner", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        await prisma.discount.create({
          data: {
            businessId: biz.id,
            title: "D1",
            percentOff: 10,
            validFrom: new Date(),
            validUntil: new Date(Date.now() + 86400000),
          },
        });
        const res = await request(app)
          .get(`/api/business/${biz.id}/discounts`)
          .set(auth(owner.token));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
      });

      it("forbids a non-owner (403)", async () => {
        const owner = await createTestUser();
        const stranger = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .get(`/api/business/${biz.id}/discounts`)
          .set(auth(stranger.token));
        expect(res.status).toBe(403);
      });
    });

    describe("POST /api/business/:id/discounts", () => {
      it("creates a discount and persists", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);

        const res = await request(app)
          .post(`/api/business/${biz.id}/discounts`)
          .set(auth(owner.token))
          .send(validDiscount());

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Discount created");
        expect(res.body.data.percentOff).toBe(20);

        const inDb = await prisma.discount.findUnique({
          where: { id: res.body.data.id },
        });
        expect(inDb).not.toBeNull();
      });

      it("rejects when neither percentOff nor amountOffPaise is provided (400)", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const { percentOff, ...rest } = validDiscount();
        const res = await request(app)
          .post(`/api/business/${biz.id}/discounts`)
          .set(auth(owner.token))
          .send(rest);
        expect(res.status).toBe(400);
      });

      it("rejects percentOff > 100 (400)", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/discounts`)
          .set(auth(owner.token))
          .send({ ...validDiscount(), percentOff: 150 });
        expect(res.status).toBe(400);
      });

      it("forbids a non-owner (403)", async () => {
        const owner = await createTestUser();
        const stranger = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/discounts`)
          .set(auth(stranger.token))
          .send(validDiscount());
        expect(res.status).toBe(403);
      });
    });

    describe("PATCH /api/business/:id/discounts/:did", () => {
      it("updates a discount and persists", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const disc = await prisma.discount.create({
          data: {
            businessId: biz.id,
            title: "Old",
            percentOff: 10,
            validFrom: new Date(),
            validUntil: new Date(Date.now() + 86400000),
          },
        });
        const res = await request(app)
          .patch(`/api/business/${biz.id}/discounts/${disc.id}`)
          .set(auth(owner.token))
          .send({ title: "New", isFeatured: true });
        expect(res.status).toBe(200);
        expect(res.body.data.title).toBe("New");
        expect(res.body.data.isFeatured).toBe(true);
      });

      it("returns 404 when the discount belongs to a different business", async () => {
        const owner = await createTestUser();
        const bizA = await createBusiness(owner.user.id);
        const bizB = await createBusiness(owner.user.id);
        const disc = await prisma.discount.create({
          data: {
            businessId: bizB.id,
            title: "Other",
            percentOff: 10,
            validFrom: new Date(),
            validUntil: new Date(Date.now() + 86400000),
          },
        });
        const res = await request(app)
          .patch(`/api/business/${bizA.id}/discounts/${disc.id}`)
          .set(auth(owner.token))
          .send({ title: "Updated" });
        expect(res.status).toBe(404);
      });
    });

    describe("DELETE /api/business/:id/discounts/:did", () => {
      it("deletes a discount and removes it from the DB", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const disc = await prisma.discount.create({
          data: {
            businessId: biz.id,
            title: "ToDelete",
            percentOff: 10,
            validFrom: new Date(),
            validUntil: new Date(Date.now() + 86400000),
          },
        });
        const res = await request(app)
          .delete(`/api/business/${biz.id}/discounts/${disc.id}`)
          .set(auth(owner.token));
        expect(res.status).toBe(200);
        const inDb = await prisma.discount.findUnique({
          where: { id: disc.id },
        });
        expect(inDb).toBeNull();
      });

      it("returns 404 for a nonexistent discount", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .delete(`/api/business/${biz.id}/discounts/${MISSING_ID}`)
          .set(auth(owner.token));
        expect(res.status).toBe(404);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /:id/analytics
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/business/:id/analytics", () => {
    it("returns aggregate counts for the owner", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id);
      await prisma.adCampaign.create({
        data: {
          businessId: biz.id,
          title: "C",
          ctaLabel: "Go",
          imageUrl: "https://x/i.png",
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 86400000),
          slots: ["HOME_FEED"],
          status: "ACTIVE",
          impressionCount: 5,
          clickCount: 2,
        },
      });
      await prisma.discount.create({
        data: {
          businessId: biz.id,
          title: "D",
          percentOff: 10,
          validFrom: new Date(),
          validUntil: new Date(Date.now() + 86400000),
        },
      });

      const res = await request(app)
        .get(`/api/business/${biz.id}/analytics`)
        .set(auth(owner.token));

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        campaigns: 1,
        discounts: 1,
        listings: 0,
        totalImpressions: 5,
        totalClicks: 2,
      });
    });

    it("forbids a non-owner (403)", async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const biz = await createBusiness(owner.user.id);
      const res = await request(app)
        .get(`/api/business/${biz.id}/analytics`)
        .set(auth(stranger.token));
      expect(res.status).toBe(403);
    });

    it("returns 404 for a nonexistent business", async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .get(`/api/business/${MISSING_ID}/analytics`)
        .set(auth(token));
      expect(res.status).toBe(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /:id/listings  (paginated)
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/business/:id/listings", () => {
    it("returns the owner's marketplace listings paginated", async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id);
      await prisma.marketplaceListing.create({
        data: {
          title: "Listing 1",
          description: "x",
          price: 100,
          category: "Motorcycle",
          condition: "Good",
          status: "ACTIVE",
          sellerId: owner.user.id,
        },
      });

      const res = await request(app)
        .get(`/api/business/${biz.id}/listings?page=1&limit=10`)
        .set(auth(owner.token));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("items");
      expect(res.body.data).toHaveProperty("pagination");
      expect(res.body.data.pagination.total).toBe(1);
    });

    it("forbids a non-owner (403)", async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const biz = await createBusiness(owner.user.id);
      const res = await request(app)
        .get(`/api/business/${biz.id}/listings`)
        .set(auth(stranger.token));
      expect(res.status).toBe(403);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Members: GET / POST / PATCH role / DELETE under /:id/members
  // ensureBusinessAccess: owner OR staff OR brandMember; POST/PATCH/DELETE
  // require minRole ADMIN (OWNER/ADMIN brand role) — owner always qualifies.
  // ───────────────────────────────────────────────────────────────────────
  describe("Members", () => {
    describe("GET /api/business/:id/members", () => {
      it("lists members for the owner", async () => {
        const owner = await createTestUser();
        const member = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        await prisma.brandMember.create({
          data: { businessId: biz.id, userId: member.user.id, roleId: await businessRoleId("member") },
        });

        const res = await request(app)
          .get(`/api/business/${biz.id}/members`)
          .set(auth(owner.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].user).toHaveProperty("id", member.user.id);
      });

      it("forbids a stranger who is not owner/staff/member (403)", async () => {
        const owner = await createTestUser();
        const stranger = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .get(`/api/business/${biz.id}/members`)
          .set(auth(stranger.token));
        expect(res.status).toBe(403);
      });

      it("returns 404 for a nonexistent business", async () => {
        const { token } = await createTestUser();
        const res = await request(app)
          .get(`/api/business/${MISSING_ID}/members`)
          .set(auth(token));
        expect(res.status).toBe(404);
      });
    });

    describe("POST /api/business/:id/members", () => {
      it("adds a member by email and grants the platform role", async () => {
        const owner = await createTestUser();
        const target = await createTestUser();
        const biz = await createBusiness(owner.user.id);

        const res = await request(app)
          .post(`/api/business/${biz.id}/members`)
          .set(auth(owner.token))
          .send({ email: target.user.email, role: "ADMIN" });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Member added");
        expect(res.body.data.userId).toBe(target.user.id);
        expect(res.body.data.role).toBe("ADMIN");

        const platformRole = await prisma.userRoleAssignment.findFirst({
          where: { userId: target.user.id, roleRecord: { slug: "brand_admin" } },
        });
        expect(platformRole).not.toBeNull();
      });

      it("returns 404 when no user has that email", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/members`)
          .set(auth(owner.token))
          .send({ email: "nobody@example.com", role: "MEMBER" });
        expect(res.status).toBe(404);
      });

      it("returns 409 when inviting the owner", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/members`)
          .set(auth(owner.token))
          .send({ email: owner.user.email, role: "MEMBER" });
        expect(res.status).toBe(409);
      });

      it("rejects an invalid role enum (400)", async () => {
        const owner = await createTestUser();
        const target = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/members`)
          .set(auth(owner.token))
          .send({ email: target.user.email, role: "SUPERUSER" });
        expect(res.status).toBe(400);
      });

      it("rejects a malformed email (400)", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/members`)
          .set(auth(owner.token))
          .send({ email: "not-an-email", role: "MEMBER" });
        expect(res.status).toBe(400);
      });

      it("forbids a plain MEMBER (minRole ADMIN) from inviting (403)", async () => {
        const owner = await createTestUser();
        const plainMember = await createTestUser();
        const target = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        await prisma.brandMember.create({
          data: {
            businessId: biz.id,
            userId: plainMember.user.id,
            roleId: await businessRoleId("member"),
          },
        });

        const res = await request(app)
          .post(`/api/business/${biz.id}/members`)
          .set(auth(plainMember.token))
          .send({ email: target.user.email, role: "MEMBER" });

        expect(res.status).toBe(403);
      });
    });

    describe("PATCH /api/business/:id/members/:uid/role", () => {
      it("updates a member's role", async () => {
        const owner = await createTestUser();
        const member = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        await prisma.brandMember.create({
          data: { businessId: biz.id, userId: member.user.id, roleId: await businessRoleId("member") },
        });

        const res = await request(app)
          .patch(`/api/business/${biz.id}/members/${member.user.id}/role`)
          .set(auth(owner.token))
          .send({ role: "MODERATOR" });

        expect(res.status).toBe(200);
        expect(res.body.data.role).toBe("MODERATOR");
      });

      it("returns 404 when the member does not exist", async () => {
        const owner = await createTestUser();
        const ghost = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .patch(`/api/business/${biz.id}/members/${ghost.user.id}/role`)
          .set(auth(owner.token))
          .send({ role: "MODERATOR" });
        expect(res.status).toBe(404);
      });

      it("rejects an invalid role (400)", async () => {
        const owner = await createTestUser();
        const member = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        await prisma.brandMember.create({
          data: { businessId: biz.id, userId: member.user.id, roleId: await businessRoleId("member") },
        });
        const res = await request(app)
          .patch(`/api/business/${biz.id}/members/${member.user.id}/role`)
          .set(auth(owner.token))
          .send({ role: "GOD" });
        expect(res.status).toBe(400);
      });
    });

    describe("DELETE /api/business/:id/members/:uid", () => {
      it("removes a member from the DB", async () => {
        const owner = await createTestUser();
        const member = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        await prisma.brandMember.create({
          data: { businessId: biz.id, userId: member.user.id, roleId: await businessRoleId("member") },
        });

        const res = await request(app)
          .delete(`/api/business/${biz.id}/members/${member.user.id}`)
          .set(auth(owner.token));

        expect(res.status).toBe(200);
        const inDb = await prisma.brandMember.findUnique({
          where: {
            businessId_userId: {
              businessId: biz.id,
              userId: member.user.id,
            },
          },
        });
        expect(inDb).toBeNull();
      });

      it("forbids removing the owner (403)", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .delete(`/api/business/${biz.id}/members/${owner.user.id}`)
          .set(auth(owner.token));
        expect(res.status).toBe(403);
      });

      it("returns 404 for a member that does not exist", async () => {
        const owner = await createTestUser();
        const ghost = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .delete(`/api/business/${biz.id}/members/${ghost.user.id}`)
          .set(auth(owner.token));
        expect(res.status).toBe(404);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Services: GET / POST / PATCH / DELETE under /:id/services
  // GET is public (active-only for non-members); mutations need access.
  // ───────────────────────────────────────────────────────────────────────
  describe("Services", () => {
    describe("GET /api/business/:id/services", () => {
      it("returns active services to a public viewer of an APPROVED business", async () => {
        const owner = await createTestUser();
        const viewer = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "APPROVED",
          categories: ["SERVICE_STORE"],
        });
        await prisma.serviceListing.create({
          data: { businessId: biz.id, title: "Active Svc", isActive: true },
        });
        await prisma.serviceListing.create({
          data: { businessId: biz.id, title: "Hidden Svc", isActive: false },
        });

        const res = await request(app)
          .get(`/api/business/${biz.id}/services`)
          .set(auth(viewer.token));

        expect(res.status).toBe(200);
        const titles = res.body.data.map((s: any) => s.title);
        expect(titles).toContain("Active Svc");
        expect(titles).not.toContain("Hidden Svc");
      });

      it("returns inactive services too for the owner", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "APPROVED",
        });
        await prisma.serviceListing.create({
          data: { businessId: biz.id, title: "Hidden Svc", isActive: false },
        });
        const res = await request(app)
          .get(`/api/business/${biz.id}/services`)
          .set(auth(owner.token));
        expect(res.status).toBe(200);
        expect(res.body.data.map((s: any) => s.title)).toContain("Hidden Svc");
      });

      it("hides services of an unapproved business from non-members (404)", async () => {
        const owner = await createTestUser();
        const viewer = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "PENDING",
        });
        const res = await request(app)
          .get(`/api/business/${biz.id}/services`)
          .set(auth(viewer.token));
        expect(res.status).toBe(404);
      });
    });

    describe("POST /api/business/:id/services", () => {
      it("creates a service for the owner and persists", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/services`)
          .set(auth(owner.token))
          .send({ title: "Oil Change", category: "OIL_CHANGE" });

        expect(res.status).toBe(200);
        expect(res.body.data.title).toBe("Oil Change");
        expect(res.body.data.category).toBe("OIL_CHANGE");

        const inDb = await prisma.serviceListing.findUnique({
          where: { id: res.body.data.id },
        });
        expect(inDb).not.toBeNull();
      });

      it("rejects an invalid category enum (400)", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/services`)
          .set(auth(owner.token))
          .send({ title: "X", category: "TELEPORT" });
        expect(res.status).toBe(400);
      });

      it("forbids a non-member (403)", async () => {
        const owner = await createTestUser();
        const stranger = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/services`)
          .set(auth(stranger.token))
          .send({ title: "Valid Title" });
        expect(res.status).toBe(403);
      });
    });

    describe("PATCH /api/business/:id/services/:sid", () => {
      it("updates a service", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const svc = await prisma.serviceListing.create({
          data: { businessId: biz.id, title: "Old" },
        });
        const res = await request(app)
          .patch(`/api/business/${biz.id}/services/${svc.id}`)
          .set(auth(owner.token))
          .send({ title: "New", isActive: false });
        expect(res.status).toBe(200);
        expect(res.body.data.title).toBe("New");
        expect(res.body.data.isActive).toBe(false);
      });

      it("returns 404 when service belongs to a different business", async () => {
        const owner = await createTestUser();
        const bizA = await createBusiness(owner.user.id);
        const bizB = await createBusiness(owner.user.id);
        const svc = await prisma.serviceListing.create({
          data: { businessId: bizB.id, title: "Other" },
        });
        const res = await request(app)
          .patch(`/api/business/${bizA.id}/services/${svc.id}`)
          .set(auth(owner.token))
          .send({ title: "Updated" });
        expect(res.status).toBe(404);
      });
    });

    describe("DELETE /api/business/:id/services/:sid", () => {
      it("deletes a service and removes it from the DB", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const svc = await prisma.serviceListing.create({
          data: { businessId: biz.id, title: "ToDelete" },
        });
        const res = await request(app)
          .delete(`/api/business/${biz.id}/services/${svc.id}`)
          .set(auth(owner.token));
        expect(res.status).toBe(200);
        const inDb = await prisma.serviceListing.findUnique({
          where: { id: svc.id },
        });
        expect(inDb).toBeNull();
      });

      it("returns 404 for a nonexistent service", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .delete(`/api/business/${biz.id}/services/${MISSING_ID}`)
          .set(auth(owner.token));
        expect(res.status).toBe(404);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Products: GET / POST / PATCH / DELETE under /:id/products
  // ───────────────────────────────────────────────────────────────────────
  describe("Products", () => {
    describe("GET /api/business/:id/products", () => {
      it("returns active products to a public viewer of an APPROVED business", async () => {
        const owner = await createTestUser();
        const viewer = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "APPROVED",
        });
        await prisma.brandProduct.create({
          data: { businessId: biz.id, title: "Visible Helmet", isActive: true },
        });
        await prisma.brandProduct.create({
          data: { businessId: biz.id, title: "Hidden Helmet", isActive: false },
        });

        const res = await request(app)
          .get(`/api/business/${biz.id}/products`)
          .set(auth(viewer.token));

        expect(res.status).toBe(200);
        const titles = res.body.data.map((p: any) => p.title);
        expect(titles).toContain("Visible Helmet");
        expect(titles).not.toContain("Hidden Helmet");
      });

      it("hides products of an unapproved business from non-members (404)", async () => {
        const owner = await createTestUser();
        const viewer = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "PENDING",
        });
        const res = await request(app)
          .get(`/api/business/${biz.id}/products`)
          .set(auth(viewer.token));
        expect(res.status).toBe(404);
      });
    });

    describe("POST /api/business/:id/products", () => {
      it("creates a product for the owner and persists", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/products`)
          .set(auth(owner.token))
          .send({
            title: "Carbon Helmet",
            category: "HELMET",
            price: 12999.99,
            availability: "IN_STOCK",
          });

        expect(res.status).toBe(200);
        expect(res.body.data.title).toBe("Carbon Helmet");
        expect(res.body.data.category).toBe("HELMET");

        const inDb = await prisma.brandProduct.findUnique({
          where: { id: res.body.data.id },
        });
        expect(inDb).not.toBeNull();
      });

      it("rejects a negative/non-positive price (400)", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/products`)
          .set(auth(owner.token))
          .send({ title: "Bad Price", price: -5 });
        expect(res.status).toBe(400);
      });

      it("rejects an invalid availability enum (400)", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/products`)
          .set(auth(owner.token))
          .send({ title: "X", availability: "MAYBE" });
        expect(res.status).toBe(400);
      });

      it("forbids a non-member (403)", async () => {
        const owner = await createTestUser();
        const stranger = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .post(`/api/business/${biz.id}/products`)
          .set(auth(stranger.token))
          .send({ title: "Valid Title" });
        expect(res.status).toBe(403);
      });
    });

    describe("PATCH /api/business/:id/products/:pid", () => {
      it("updates a product", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const prod = await prisma.brandProduct.create({
          data: { businessId: biz.id, title: "Old" },
        });
        const res = await request(app)
          .patch(`/api/business/${biz.id}/products/${prod.id}`)
          .set(auth(owner.token))
          .send({ title: "New", isFeatured: true });
        expect(res.status).toBe(200);
        expect(res.body.data.title).toBe("New");
        expect(res.body.data.isFeatured).toBe(true);
      });

      it("returns 404 when product belongs to a different business", async () => {
        const owner = await createTestUser();
        const bizA = await createBusiness(owner.user.id);
        const bizB = await createBusiness(owner.user.id);
        const prod = await prisma.brandProduct.create({
          data: { businessId: bizB.id, title: "Other" },
        });
        const res = await request(app)
          .patch(`/api/business/${bizA.id}/products/${prod.id}`)
          .set(auth(owner.token))
          .send({ title: "Updated" });
        expect(res.status).toBe(404);
      });
    });

    describe("DELETE /api/business/:id/products/:pid", () => {
      it("deletes a product and removes it from the DB", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const prod = await prisma.brandProduct.create({
          data: { businessId: biz.id, title: "ToDelete" },
        });
        const res = await request(app)
          .delete(`/api/business/${biz.id}/products/${prod.id}`)
          .set(auth(owner.token));
        expect(res.status).toBe(200);
        const inDb = await prisma.brandProduct.findUnique({
          where: { id: prod.id },
        });
        expect(inDb).toBeNull();
      });

      it("returns 404 for a nonexistent product", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .delete(`/api/business/${biz.id}/products/${MISSING_ID}`)
          .set(auth(owner.token));
        expect(res.status).toBe(404);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Inquiries: GET list (owner) / POST (any user) / PATCH status (owner)
  // ───────────────────────────────────────────────────────────────────────
  describe("Inquiries", () => {
    describe("GET /api/business/:id/inquiries", () => {
      it("lists inquiries for the owner", async () => {
        const owner = await createTestUser();
        const sender = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "APPROVED",
        });
        await prisma.businessInquiry.create({
          data: {
            businessId: biz.id,
            fromUserId: sender.user.id,
            subject: "Question",
            message: "Do you ship to Goa?",
          },
        });

        const res = await request(app)
          .get(`/api/business/${biz.id}/inquiries`)
          .set(auth(owner.token));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].fromUser).toHaveProperty("id", sender.user.id);
      });

      it("forbids a stranger (403)", async () => {
        const owner = await createTestUser();
        const stranger = await createTestUser();
        const biz = await createBusiness(owner.user.id);
        const res = await request(app)
          .get(`/api/business/${biz.id}/inquiries`)
          .set(auth(stranger.token));
        expect(res.status).toBe(403);
      });
    });

    describe("POST /api/business/:id/inquiries", () => {
      it("lets any authenticated user inquire to an APPROVED business and persists", async () => {
        const owner = await createTestUser();
        const sender = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "APPROVED",
        });

        const res = await request(app)
          .post(`/api/business/${biz.id}/inquiries`)
          .set(auth(sender.token))
          .send({ subject: "Pricing", message: "What is the price of X?" });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Inquiry sent");
        expect(res.body.data.fromUserId).toBe(sender.user.id);
        expect(res.body.data.status).toBe("OPEN");

        const inDb = await prisma.businessInquiry.findUnique({
          where: { id: res.body.data.id },
        });
        expect(inDb).not.toBeNull();
      });

      it("returns 404 when the business is not APPROVED", async () => {
        const owner = await createTestUser();
        const sender = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "PENDING",
        });
        const res = await request(app)
          .post(`/api/business/${biz.id}/inquiries`)
          .set(auth(sender.token))
          .send({ subject: "Hi", message: "Just checking in here." });
        expect(res.status).toBe(404);
      });

      it("returns 400 when the owner inquires to their own business", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "APPROVED",
        });
        const res = await request(app)
          .post(`/api/business/${biz.id}/inquiries`)
          .set(auth(owner.token))
          .send({ subject: "Self", message: "Talking to myself here." });
        expect(res.status).toBe(400);
      });

      it("rejects too-short message (< 10 chars) with 400", async () => {
        const owner = await createTestUser();
        const sender = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "APPROVED",
        });
        const res = await request(app)
          .post(`/api/business/${biz.id}/inquiries`)
          .set(auth(sender.token))
          .send({ subject: "Hi", message: "short" });
        expect(res.status).toBe(400);
      });

      it("requires authentication (401)", async () => {
        const owner = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "APPROVED",
        });
        const res = await request(app)
          .post(`/api/business/${biz.id}/inquiries`)
          .send({ subject: "Hi", message: "Hello there friend." });
        expect(res.status).toBe(401);
      });
    });

    describe("PATCH /api/business/:id/inquiries/:iid", () => {
      it("updates inquiry status (state transition) and persists", async () => {
        const owner = await createTestUser();
        const sender = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "APPROVED",
        });
        const inquiry = await prisma.businessInquiry.create({
          data: {
            businessId: biz.id,
            fromUserId: sender.user.id,
            subject: "Q",
            message: "A question about availability.",
            status: "OPEN",
          },
        });

        const res = await request(app)
          .patch(`/api/business/${biz.id}/inquiries/${inquiry.id}`)
          .set(auth(owner.token))
          .send({ status: "RESOLVED" });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("RESOLVED");

        const inDb = await prisma.businessInquiry.findUnique({
          where: { id: inquiry.id },
        });
        expect(inDb?.status).toBe("RESOLVED");
      });

      it("rejects an invalid status enum (400)", async () => {
        const owner = await createTestUser();
        const sender = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "APPROVED",
        });
        const inquiry = await prisma.businessInquiry.create({
          data: {
            businessId: biz.id,
            fromUserId: sender.user.id,
            subject: "Q",
            message: "A question about availability.",
          },
        });
        const res = await request(app)
          .patch(`/api/business/${biz.id}/inquiries/${inquiry.id}`)
          .set(auth(owner.token))
          .send({ status: "PENDING" });
        expect(res.status).toBe(400);
      });

      it("returns 404 when the inquiry belongs to a different business", async () => {
        const owner = await createTestUser();
        const sender = await createTestUser();
        const bizA = await createBusiness(owner.user.id);
        const bizB = await createBusiness(owner.user.id);
        const inquiry = await prisma.businessInquiry.create({
          data: {
            businessId: bizB.id,
            fromUserId: sender.user.id,
            subject: "Q",
            message: "A question about availability.",
          },
        });
        const res = await request(app)
          .patch(`/api/business/${bizA.id}/inquiries/${inquiry.id}`)
          .set(auth(owner.token))
          .send({ status: "CLOSED" });
        expect(res.status).toBe(404);
      });

      it("forbids a stranger (403)", async () => {
        const owner = await createTestUser();
        const stranger = await createTestUser();
        const sender = await createTestUser();
        const biz = await createBusiness(owner.user.id, {
          verification: "APPROVED",
        });
        const inquiry = await prisma.businessInquiry.create({
          data: {
            businessId: biz.id,
            fromUserId: sender.user.id,
            subject: "Q",
            message: "A question about availability.",
          },
        });
        const res = await request(app)
          .patch(`/api/business/${biz.id}/inquiries/${inquiry.id}`)
          .set(auth(stranger.token))
          .send({ status: "CLOSED" });
        expect(res.status).toBe(403);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Task 4: business permission codes enforce routes + viewer fields.
  // ───────────────────────────────────────────────────────────────────────
  describe("RBAC permission codes (Task 4)", () => {
    /** Assign a GLOBAL admin role (platform-admin bypass) via the Role FK. */
    async function grantGlobalAdmin(userId: string) {
      let adminRole = await prisma.role.findFirst({
        where: { slug: "admin", scope: "GLOBAL" },
        select: { id: true },
      });
      if (!adminRole) {
        adminRole = await prisma.role.create({
          data: { name: "Admin", slug: "admin", scope: "GLOBAL", isSystem: true },
          select: { id: true },
        });
      }
      await prisma.userRoleAssignment.upsert({
        where: { userId_roleId: { userId, roleId: adminRole.id } },
        create: { userId, roleId: adminRole.id },
        update: {},
      });
    }

    it("member without manage_settings gets 403 on PATCH settings", { timeout: 120_000 }, async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const biz = await createBusiness(owner.user.id);
      await prisma.brandMember.create({
        data: { businessId: biz.id, userId: member.user.id, roleId: await businessRoleId("member") },
      });

      const res = await request(app)
        .patch(`/api/business/${biz.id}`)
        .set(auth(member.token))
        .send({ tagline: "hijack" });

      expect(res.status).toBe(403);
    });

    it("analytics requires business:view_analytics (403 without, 200 with)", { timeout: 120_000 }, async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const biz = await createBusiness(owner.user.id);
      await prisma.brandMember.create({
        data: { businessId: biz.id, userId: member.user.id, roleId: await businessRoleId("member") },
      });

      const denied = await request(app)
        .get(`/api/business/${biz.id}/analytics`)
        .set(auth(member.token));
      expect(denied.status).toBe(403);

      // Custom role granting exactly view_analytics opens the gate.
      const created = await request(app)
        .post(`/api/business/${biz.id}/roles`)
        .set(auth(owner.token))
        .send({ name: "Analyst", permissionCodes: ["business:view_analytics"] });
      expect(created.status).toBe(201);

      const assigned = await request(app)
        .post(`/api/business/${biz.id}/members/${member.user.id}/role`)
        .set(auth(owner.token))
        .send({ roleId: created.body.data.role.id });
      expect(assigned.status).toBe(200);

      const allowed = await request(app)
        .get(`/api/business/${biz.id}/analytics`)
        .set(auth(member.token));
      expect(allowed.status).toBe(200);
      expect(allowed.body.data).toHaveProperty("campaigns");
    });

    it("custom role created via POST /:id/roles grants exactly its codes", { timeout: 120_000 }, async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const target = await createTestUser();
      const biz = await createBusiness(owner.user.id);

      const created = await request(app)
        .post(`/api/business/${biz.id}/roles`)
        .set(auth(owner.token))
        .send({ name: "Deals Only", permissionCodes: ["business:manage_deals"] });
      expect(created.status).toBe(201);
      // createBusinessRole returns raw RolePermission joins ({ permission: { code } }).
      const codes = created.body.data.role.permissions.map((p: any) => p.code ?? p.permission?.code ?? p);
      expect(codes).toEqual(["business:manage_deals"]);

      // Invite as plain member, then assign the custom role.
      const invited = await request(app)
        .post(`/api/business/${biz.id}/members`)
        .set(auth(owner.token))
        .send({ email: target.user.email, role: "MEMBER" });
      expect(invited.status).toBe(200);

      const assigned = await request(app)
        .post(`/api/business/${biz.id}/members/${target.user.id}/role`)
        .set(auth(owner.token))
        .send({ roleId: created.body.data.role.id });
      expect(assigned.status).toBe(200);

      // manage_deals opens discount creation but not settings.
      const dealRes = await request(app)
        .post(`/api/business/${biz.id}/discounts`)
        .set(auth(target.token))
        .send(validDiscount());
      expect(dealRes.status).toBe(200);

      const settingsRes = await request(app)
        .patch(`/api/business/${biz.id}`)
        .set(auth(target.token))
        .send({ tagline: "hijack" });
      expect(settingsRes.status).toBe(403);

      // The unassigned plain member still cannot touch deals.
      await prisma.brandMember.create({
        data: { businessId: biz.id, userId: member.user.id, roleId: await businessRoleId("member") },
      });
      const plainRes = await request(app)
        .post(`/api/business/${biz.id}/discounts`)
        .set(auth(member.token))
        .send(validDiscount());
      expect(plainRes.status).toBe(403);
    });

    it("member invite/remove requires business:manage_members", { timeout: 120_000 }, async () => {
      const owner = await createTestUser();
      const analyst = await createTestUser();
      const target = await createTestUser();
      const biz = await createBusiness(owner.user.id);

      const created = await request(app)
        .post(`/api/business/${biz.id}/roles`)
        .set(auth(owner.token))
        .send({ name: "Analyst", permissionCodes: ["business:view_analytics"] });
      expect(created.status).toBe(201);

      await prisma.brandMember.create({
        data: { businessId: biz.id, userId: analyst.user.id, roleId: created.body.data.role.id },
      });

      const res = await request(app)
        .post(`/api/business/${biz.id}/members`)
        .set(auth(analyst.token))
        .send({ email: target.user.email, role: "MEMBER" });
      expect(res.status).toBe(403);
    });

    it("role endpoints require business:manage_roles", { timeout: 120_000 }, async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const biz = await createBusiness(owner.user.id);

      const denied = await request(app)
        .post(`/api/business/${biz.id}/roles`)
        .set(auth(stranger.token))
        .send({ name: "Nope", permissionCodes: ["business:view_analytics"] });
      expect(denied.status).toBe(403);
    });

    it("role CRUD cycle works for the owner", { timeout: 120_000 }, async () => {
      const owner = await createTestUser();
      const biz = await createBusiness(owner.user.id);

      const permsRes = await request(app)
        .get(`/api/business/${biz.id}/roles/permissions`)
        .set(auth(owner.token));
      expect(permsRes.status).toBe(200);
      const allCodes = permsRes.body.data.permissions.map((p: any) => p.code);
      expect(allCodes).toContain("business:manage_roles");

      const listRes = await request(app)
        .get(`/api/business/${biz.id}/roles`)
        .set(auth(owner.token));
      expect(listRes.status).toBe(200);
      const slugs = listRes.body.data.roles.map((r: any) => r.slug);
      expect(slugs).toContain("owner");
      expect(slugs).toContain("member");

      const created = await request(app)
        .post(`/api/business/${biz.id}/roles`)
        .set(auth(owner.token))
        .send({ name: "Deals Only", permissionCodes: ["business:manage_deals"] });
      expect(created.status).toBe(201);
      const roleId = created.body.data.role.id as string;

      const updated = await request(app)
        .patch(`/api/business/${biz.id}/roles/${roleId}`)
        .set(auth(owner.token))
        .send({ name: "Deals Plus", permissionCodes: ["business:manage_deals", "business:view_analytics"] });
      expect(updated.status).toBe(200);
      expect(updated.body.data.role.name).toBe("Deals Plus");

      const deleted = await request(app)
        .delete(`/api/business/${biz.id}/roles/${roleId}`)
        .set(auth(owner.token));
      expect(deleted.status).toBe(200);

      const relist = await request(app)
        .get(`/api/business/${biz.id}/roles`)
        .set(auth(owner.token));
      expect(relist.body.data.roles.map((r: any) => r.id)).not.toContain(roleId);
    });

    it("GET /:id details include viewerPermissions with the caller's codes", { timeout: 120_000 }, async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const biz = await createBusiness(owner.user.id, { verification: "APPROVED" });

      const ownerRes = await request(app)
        .get(`/api/business/${biz.id}`)
        .set(auth(owner.token));
      expect(ownerRes.status).toBe(200);
      expect(ownerRes.body.data.viewerPermissions).toContain("business:manage_roles");
      expect(ownerRes.body.data.viewerRole).toBe("OWNER");

      const strangerRes = await request(app)
        .get(`/api/business/${biz.id}`)
        .set(auth(stranger.token));
      expect(strangerRes.status).toBe(200);
      expect(strangerRes.body.data.viewerPermissions).toEqual([]);
    });

    it("platform admin bypasses business gates", { timeout: 120_000 }, async () => {
      const owner = await createTestUser();
      const admin = await createTestUser();
      await grantGlobalAdmin(admin.user.id);
      const biz = await createBusiness(owner.user.id);

      const res = await request(app)
        .patch(`/api/business/${biz.id}`)
        .set(auth(admin.token))
        .send({ tagline: "Edited by admin" });
      expect(res.status).toBe(200);
      expect(res.body.data.tagline).toBe("Edited by admin");
    });
  });
});
