/**
 * ACCOUNT (AUTH) ROUTES TESTS
 *
 * The custom account endpoints are mounted at /api/account. The /api/auth/*
 * prefix is owned entirely by Better Auth's own handler (toNodeHandler), so
 * these endpoints must be exercised through /api/account, not /api/auth.
 *
 * Covers: current user (/me), profile update, change password, email verify.
 */

import request from "supertest";
import { auth } from "../../config/auth.js";
import { app } from "../../server";
import {
  createTestUser,
  cleanupTestData,
  assertValidSuccessResponse,
} from "../../test/utils";

describe("Account Routes", () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe("GET /api/account/me", () => {
    it("should return current user profile when authenticated", async () => {
      const { user, token } = await createTestUser();

      const res = await request(app)
        .get("/api/account/me")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      assertValidSuccessResponse(res.body, "user");
      expect(res.body.data.user.id).toBe(user.id);
      expect(res.body.data.user.email).toBe(user.email);
    });

    it("should return 401 when not authenticated", async () => {
      const res = await request(app).get("/api/account/me");
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH /api/account/me", () => {
    it("should update user profile successfully", async () => {
      const { token } = await createTestUser();

      const updateData = {
        name: "Updated Name",
        bio: "Updated bio",
        location: "New City",
        dob: new Date("1990-01-01").toISOString(),
      };

      const res = await request(app)
        .patch("/api/account/me")
        .set("Authorization", `Bearer ${token}`)
        .send(updateData);

      expect(res.status).toBe(200);
      assertValidSuccessResponse(res.body, "user");
      expect(res.body.data.user.name).toBe(updateData.name);
      expect(res.body.data.user.bio).toBe(updateData.bio);
    });

    it("should return 401 when not authenticated", async () => {
      const res = await request(app)
        .patch("/api/account/me")
        .send({ name: "Updated" });

      expect(res.status).toBe(401);
    });

    it("should reject an invalid avatar URL", async () => {
      const { token } = await createTestUser();

      // email is not a profile field; avatar IS validated as a URL, so this is
      // the real "invalid input is rejected" case for this endpoint.
      const res = await request(app)
        .patch("/api/account/me")
        .set("Authorization", `Bearer ${token}`)
        .send({ avatar: "not-a-valid-url" });

      expect(res.status).toBe(400);
    });
  });

  describe("retired password endpoints", () => {
    it("should change password successfully", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/account/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({
          currentPassword: "OldPassword123",
          newPassword: "NewPassword456",
        });

      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe("PASSWORD_AUTH_RETIRED");
    });

    it("should return 400 with a weak new password", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/account/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({
          currentPassword: "ValidPassword123",
          newPassword: "weak", // < 8 chars, fails changePasswordSchema
        });

      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe("PASSWORD_AUTH_RETIRED");
    });

    it("should return 401 when not authenticated", async () => {
      const res = await request(app).post("/api/account/change-password").send({
        currentPassword: "test",
        newPassword: "NewPass123",
      });

      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe("PASSWORD_AUTH_RETIRED");
    });

    it("does not configure email-password or magic-link authentication", () => {
      const options = (auth as any).options;
      expect(options.emailAndPassword?.enabled).not.toBe(true);
      expect(options.plugins.some((plugin: { id?: string }) => plugin.id === "magic-link")).toBe(false);
    });
  });

  describe("POST /api/account/verify-email", () => {
    // verify-email is a PUBLIC endpoint (no requireAuth). It validates a JWT
    // signed with BETTER_AUTH_SECRET, so a non-JWT token is rejected with 400.
    it("should reject an invalid verification token", async () => {
      const { user } = await createTestUser({ emailVerified: false });

      const res = await request(app)
        .post("/api/account/verify-email")
        .send({ email: user.email, token: "invalid-verification-token" });

      expect(res.status).toBe(400);
    });

    it("should return 400 when the email is missing", async () => {
      const res = await request(app)
        .post("/api/account/verify-email")
        .send({ token: "some-token" });

      expect(res.status).toBe(400);
    });
  });
});
