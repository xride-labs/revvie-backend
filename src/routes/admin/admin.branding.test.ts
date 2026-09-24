import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../server.js";
import prisma from "../../lib/prisma.js";
import { createAdminUser, createTestUser } from "../../test/utils.js";

// Mock mailer and cloudinary
vi.mock("../../lib/mailer.js", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/mailer.js")>();
  return {
    ...actual,
    sendEmail: vi.fn().mockResolvedValue(true),
  };
});

vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload: vi.fn().mockResolvedValue({
        secure_url: "https://res.cloudinary.com/xride-labs/image/upload/revvie/branding/test.png",
        public_id: "revvie/branding/test",
        format: "png",
        bytes: 12345,
      }),
    },
  },
}));

describe("Branding Routes Integration", () => {
  let adminUser: Awaited<ReturnType<typeof createAdminUser>>;
  let normalUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    adminUser = await createAdminUser();
    normalUser = await createTestUser();
  });

  afterAll(async () => {
    await prisma.userRoleAssignment.deleteMany({
      where: { userId: adminUser.user.id },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { id: { in: [adminUser.user.id, normalUser.user.id] } },
    }).catch(() => {});
  });

  describe("GET /api/public/branding", () => {
    it("should return public branding config without authentication and include cache headers", async () => {
      const res = await request(app).get("/api/public/branding");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.siteName).toBe("Revvie");
      expect(res.body.data.primaryColor).toMatch(/^#[A-Fa-f0-9]{6}$/);
      expect(res.body.data.logoUrl).toBeDefined();
      expect(res.headers["cache-control"]).toContain("public");
      expect(res.headers["cache-control"]).toContain("max-age=300");
    });
  });

  describe("Admin Branding Security Gates", () => {
    it("should reject unauthenticated requests to admin branding endpoints with 401", async () => {
      const getRes = await request(app).get("/api/admin/branding");
      expect(getRes.status).toBe(401);

      const putRes = await request(app)
        .put("/api/admin/branding")
        .send({ tagline: "NEW TAGLINE" });
      expect(putRes.status).toBe(401);

      const uploadRes = await request(app)
        .post("/api/admin/branding/upload")
        .send({ file: "data:image/png;base64,123", type: "logo" });
      expect(uploadRes.status).toBe(401);

      const testEmailRes = await request(app)
        .post("/api/admin/branding/test-email")
        .send({ to: "test@example.com" });
      expect(testEmailRes.status).toBe(401);
    });

    it("should reject non-admin users with 403", async () => {
      const getRes = await request(app)
        .get("/api/admin/branding")
        .set("Authorization", `Bearer ${normalUser.token}`);
      expect(getRes.status).toBe(403);
    });
  });

  describe("Admin Branding CRUD & Operations", () => {
    it("should allow admin to retrieve current branding configuration", async () => {
      const res = await request(app)
        .get("/api/admin/branding")
        .set("Authorization", `Bearer ${adminUser.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.siteName).toBe("Revvie");
      expect(res.body.data.primaryColor).toBeDefined();
    });

    it("should reject invalid hex color format with 400 validation error", async () => {
      const res = await request(app)
        .put("/api/admin/branding")
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({
          primaryColor: "not-a-hex",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should update branding configuration when valid payload is sent", async () => {
      const res = await request(app)
        .put("/api/admin/branding")
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({
          tagline: "UPDATED VIA INTEGRATION TEST",
          primaryColor: "#00ffaa",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tagline).toBe("UPDATED VIA INTEGRATION TEST");
      expect(res.body.data.primaryColor).toBe("#00ffaa");

      // Verify public branding reflects the change
      const publicRes = await request(app).get("/api/public/branding");
      expect(publicRes.status).toBe(200);
      expect(publicRes.body.data.tagline).toBe("UPDATED VIA INTEGRATION TEST");
      expect(publicRes.body.data.primaryColor).toBe("#00ffaa");
    });

    it("should upload a brand asset via Cloudinary", async () => {
      const res = await request(app)
        .post("/api/admin/branding/upload")
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({
          file: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          type: "logo",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toContain("cloudinary");
    });

    it("should dispatch a brand test email", async () => {
      const res = await request(app)
        .post("/api/admin/branding/test-email")
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({
          to: "test-brand-recipient@example.com",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recipient).toBe("test-brand-recipient@example.com");
    });
  });
});
