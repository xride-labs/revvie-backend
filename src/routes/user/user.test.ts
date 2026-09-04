/**
 * USER ROUTES TESTS
 * Comprehensive coverage for /api/users (user.routes.ts).
 *
 * Endpoints under test (16 real routes mounted at /api/users):
 *   GET    /leaderboard
 *   GET    /                       (list + pagination + search + role filter)
 *   POST   /contacts/match
 *   GET    /:id
 *   PATCH  /:id                    (self / admin / forbidden)
 *   GET    /:id/roles              (admin only)
 *   POST   /:id/roles              (admin only, duplicate -> 400)
 *   DELETE /:id/roles/:role        (admin only)
 *   DELETE /:id                    (self / admin / forbidden)
 *   GET    /:id/rides
 *   GET    /:id/clubs
 *   POST   /me/bikes
 *   PATCH  /me/bikes/:bikeId
 *   DELETE /me/bikes/:bikeId
 *   PATCH  /me/ghost-mode
 *
 * NOTE: There is NO follow / unfollow / friend-request endpoint under
 * /api/users (friendship lives at /api/friends). Those legacy describe blocks
 * remain skipped on purpose. The src/routes/user/public.routes.ts file
 * (GET /:id/public) is NOT mounted anywhere in server.ts, so it is unreachable
 * and is documented as a skipped block below rather than exercised.
 */

import request from "supertest";
import { app } from "../../server";
import prisma from "../../lib/prisma";
import {
  createTestUser,
  createAdminUser,
  createTestRide,
  createTestClub,
  cleanupTestData,
  assertValidSuccessResponse,
} from "../../test/utils";

// A syntactically valid id (idParamSchema requires 20-36 chars of [a-zA-Z0-9_-])
// that does not exist in the DB -> handlers return a real 404.
const NONEXISTENT_ID = "clnonexistentuser0000abcd"; // 24 chars
// Too short for idParamSchema (< 20 chars) -> validateParams returns 400.
const MALFORMED_ID = "short-id";

describe("User Routes", () => {
  afterEach(async () => {
    // Bikes/friendships/notifications cascade on user delete, but wipe bikes
    // explicitly first for belt-and-suspenders isolation across suites.
    await prisma.bike.deleteMany({});
    await cleanupTestData();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/users/leaderboard
  // ───────────────────────────────────────────────────────────────────────────
  describe("GET /api/users/leaderboard", () => {
    it("returns ranked leaderboard (global scope by default)", async () => {
      const { token } = await createTestUser({ xpPoints: 500 });
      await createTestUser({ xpPoints: 100 });

      const res = await request(app)
        .get("/api/users/leaderboard")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scope).toBe("global");
      expect(res.body.data.city).toBeNull();
      expect(Array.isArray(res.body.data.leaderboard)).toBe(true);
      // Ranks are 1-based and ordered by xpPoints desc.
      expect(res.body.data.leaderboard[0].rank).toBe(1);
      const xps = res.body.data.leaderboard.map((u: any) => u.xpPoints);
      const sorted = [...xps].sort((a, b) => b - a);
      expect(xps).toEqual(sorted);
    });

    it("honours the limit query param (capped at 100)", async () => {
      const { token } = await createTestUser({ xpPoints: 10 });
      await createTestUser({ xpPoints: 20 });
      await createTestUser({ xpPoints: 30 });

      const res = await request(app)
        .get("/api/users/leaderboard?limit=2")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.leaderboard.length).toBeLessThanOrEqual(2);
    });

    it("supports city scope filtering", async () => {
      const { token } = await createTestUser({
        location: "Bangalore",
        xpPoints: 50,
      });
      await createTestUser({ location: "Mumbai", xpPoints: 90 });

      const res = await request(app)
        .get("/api/users/leaderboard?scope=city&city=Bangalore")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.scope).toBe("city");
      expect(res.body.data.city).toBe("Bangalore");
      // Every returned user should match the city filter (case-insensitive contains).
      for (const u of res.body.data.leaderboard) {
        expect((u.location || "").toLowerCase()).toContain("bangalore");
      }
    });

    it("returns 401 when not authenticated", async () => {
      const res = await request(app).get("/api/users/leaderboard");
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/users
  // ───────────────────────────────────────────────────────────────────────────
  describe("GET /api/users", () => {
    it("should list users with pagination", async () => {
      const { token } = await createTestUser();
      await createTestUser();

      const res = await request(app)
        .get("/api/users?page=1&limit=10")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      // ApiResponse.paginated nests as data:{items,pagination}
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 10,
        total: expect.any(Number),
        totalPages: expect.any(Number),
      });
      // Each item exposes roles as an array (userRoles flattened).
      expect(Array.isArray(res.body.data.items[0].roles)).toBe(true);
    });

    it("should filter users by search term", async () => {
      const { token } = await createTestUser({ name: "Alice Smith" });
      await createTestUser({ name: "Bob Jones" });

      const res = await request(app)
        .get("/api/users?search=Alice")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      // The Alice user must be present; Bob must not.
      const names = res.body.data.items.map((u: any) => u.name);
      expect(names).toContain("Alice Smith");
      expect(names).not.toContain("Bob Jones");
    });

    it("filters by role", async () => {
      const admin = await createAdminUser();
      await createTestUser();

      const res = await request(app)
        .get("/api/users?role=ADMIN")
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      // Every returned user must carry the ADMIN role.
      for (const u of res.body.data.items) {
        expect(u.roles).toContain("ADMIN");
      }
      const ids = res.body.data.items.map((u: any) => u.id);
      expect(ids).toContain(admin.user.id);
    });

    it("rejects an invalid limit (> 100) with 400", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .get("/api/users?limit=500")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 401 when not authenticated", async () => {
      const res = await request(app).get("/api/users");
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/users/contacts/match
  // ───────────────────────────────────────────────────────────────────────────
  describe("POST /api/users/contacts/match", () => {
    it("matches an existing user by email", async () => {
      const { token } = await createTestUser();
      const target = await createTestUser({ name: "Findable Rider" });

      const res = await request(app)
        .post("/api/users/contacts/match")
        .set("Authorization", `Bearer ${token}`)
        .send({
          contacts: [{ name: "From Phonebook", email: target.user.email }],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary.scannedContacts).toBe(1);
      expect(res.body.data.summary.matchedUsers).toBe(1);
      const match = res.body.data.matches[0];
      expect(match.user.id).toBe(target.user.id);
      expect(match.matchedBy).toContain("email");
      expect(match.contactName).toBe("From Phonebook");
    });

    it("matches an existing user by phone", async () => {
      const { token } = await createTestUser();
      const phone = "+15551230000";
      const target = await createTestUser({ phone });

      const res = await request(app)
        .post("/api/users/contacts/match")
        .set("Authorization", `Bearer ${token}`)
        .send({ contacts: [{ name: "Phone Buddy", phone }] });

      expect(res.status).toBe(200);
      expect(res.body.data.summary.matchedUsers).toBe(1);
      expect(res.body.data.matches[0].user.id).toBe(target.user.id);
      expect(res.body.data.matches[0].matchedBy).toContain("phone");
    });

    it("does not match the caller themselves", async () => {
      const { token, user } = await createTestUser();

      const res = await request(app)
        .post("/api/users/contacts/match")
        .set("Authorization", `Bearer ${token}`)
        .send({ contacts: [{ name: "Me", email: user.email }] });

      expect(res.status).toBe(200);
      expect(res.body.data.summary.matchedUsers).toBe(0);
      expect(res.body.data.matches).toEqual([]);
    });

    it("returns empty matches when nothing resolves", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/users/contacts/match")
        .set("Authorization", `Bearer ${token}`)
        .send({
          contacts: [{ name: "Ghost", email: "nobody_here@example.com" }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.matches).toEqual([]);
      expect(res.body.data.summary.matchedUsers).toBe(0);
    });

    it("rejects an empty contacts array (400)", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/users/contacts/match")
        .set("Authorization", `Bearer ${token}`)
        .send({ contacts: [] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects a contact with neither phone nor email (400)", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/users/contacts/match")
        .set("Authorization", `Bearer ${token}`)
        .send({ contacts: [{ name: "Nameless" }] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 401 when not authenticated", async () => {
      const res = await request(app)
        .post("/api/users/contacts/match")
        .send({ contacts: [{ email: "x@example.com" }] });
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/users/:id
  // ───────────────────────────────────────────────────────────────────────────
  describe("GET /api/users/:id", () => {
    it("should return user profile by id with the full envelope", async () => {
      const user1 = await createTestUser();
      const { token } = await createTestUser();

      const res = await request(app)
        .get(`/api/users/${user1.user.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      assertValidSuccessResponse(res.body, "user");
      const profile = res.body.data.user;
      expect(profile.id).toBe(user1.user.id);
      // buildUserProfileResponse always exposes these nested objects.
      expect(profile.experience).toMatchObject({
        level: expect.any(Number),
        nextLevelXp: expect.any(Number),
      });
      expect(Array.isArray(profile.role)).toBe(true);
      expect(Array.isArray(profile.bikes)).toBe(true);
      expect(profile.social).toHaveProperty("friends");
    });

    it("should return 404 for non-existent (well-formed) id", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .get(`/api/users/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("USER_NOT_FOUND");
    });

    it("returns 400 for a malformed id", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .get(`/api/users/${MALFORMED_ID}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 401 when not authenticated", async () => {
      const user1 = await createTestUser();
      const res = await request(app).get(`/api/users/${user1.user.id}`);
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PATCH /api/users/:id
  // ───────────────────────────────────────────────────────────────────────────
  describe("PATCH /api/users/:id", () => {
    it("allows a user to update their own profile", async () => {
      const { user, token } = await createTestUser();

      const res = await request(app)
        .patch(`/api/users/${user.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ bio: "Updated bio", location: "Goa" });

      expect(res.status).toBe(200);
      assertValidSuccessResponse(res.body, "user");
      expect(res.body.message).toBe("User updated successfully");
      expect(res.body.data.user.bio).toBe("Updated bio");
      expect(res.body.data.user.location).toBe("Goa");

      // DB side-effect assertion.
      const fresh = await prisma.user.findUnique({ where: { id: user.id } });
      expect(fresh?.bio).toBe("Updated bio");
      expect(fresh?.location).toBe("Goa");
    });

    it("allows an admin to update another user", async () => {
      const admin = await createAdminUser();
      const { user: target } = await createTestUser();

      const res = await request(app)
        .patch(`/api/users/${target.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ name: "Renamed By Admin" });

      expect(res.status).toBe(200);
      expect(res.body.data.user.name).toBe("Renamed By Admin");
    });

    it("forbids a non-admin from updating another user (403)", async () => {
      const { token } = await createTestUser();
      const { user: target } = await createTestUser();

      const res = await request(app)
        .patch(`/api/users/${target.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ bio: "hacked" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("rejects an invalid body (400)", async () => {
      const { user, token } = await createTestUser();

      const res = await request(app)
        .patch(`/api/users/${user.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ email: "not-an-email" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for a malformed id (params validated first)", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .patch(`/api/users/${MALFORMED_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ bio: "x" });

      expect(res.status).toBe(400);
    });

    it("returns 401 when not authenticated", async () => {
      const { user } = await createTestUser();
      const res = await request(app)
        .patch(`/api/users/${user.id}`)
        .send({ bio: "x" });
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/users/:id/roles  (admin only)
  // ───────────────────────────────────────────────────────────────────────────
  describe("GET /api/users/:id/roles", () => {
    it("admin can read a user's roles", async () => {
      const admin = await createAdminUser();
      const { user } = await createTestUser();
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, role: "RIDER" },
      });

      const res = await request(app)
        .get(`/api/users/${user.id}/roles`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      assertValidSuccessResponse(res.body, "user");
      const roleNames = res.body.data.user.roles.map((r: any) => r.role);
      expect(roleNames).toContain("RIDER");
    });

    it("forbids a non-admin (403)", async () => {
      const { token } = await createTestUser();
      const { user: target } = await createTestUser();

      const res = await request(app)
        .get(`/api/users/${target.id}/roles`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ROLE_REQUIRED");
    });

    it("returns 404 when the user does not exist (admin)", async () => {
      const admin = await createAdminUser();

      const res = await request(app)
        .get(`/api/users/${NONEXISTENT_ID}/roles`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("USER_NOT_FOUND");
    });

    it("returns 401 when not authenticated", async () => {
      const { user } = await createTestUser();
      const res = await request(app).get(`/api/users/${user.id}/roles`);
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/users/:id/roles  (admin only)
  // ───────────────────────────────────────────────────────────────────────────
  describe("POST /api/users/:id/roles", () => {
    it("admin should add a role to a user (with DB side-effect)", async () => {
      const admin = await createAdminUser();
      const { user } = await createTestUser();

      const res = await request(app)
        .post(`/api/users/${user.id}/roles`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ role: "SELLER" });

      expect(res.status).toBe(200);
      assertValidSuccessResponse(res.body, "user");
      expect(res.body.message).toBe("Role added successfully");
      const roleNames = res.body.data.user.roles.map((r: any) => r.role);
      expect(roleNames).toContain("SELLER");

      // DB side-effect assertion.
      const assignment = await prisma.userRoleAssignment.findUnique({
        where: { userId_role: { userId: user.id, role: "SELLER" } },
      });
      expect(assignment).not.toBeNull();
    });

    it("rejects a duplicate role assignment (400)", async () => {
      const admin = await createAdminUser();
      const { user } = await createTestUser();
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, role: "SELLER" },
      });

      const res = await request(app)
        .post(`/api/users/${user.id}/roles`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ role: "SELLER" });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already has this role/i);
    });

    it("rejects an invalid role enum (400) before auth check", async () => {
      const admin = await createAdminUser();
      const { user } = await createTestUser();

      const res = await request(app)
        .post(`/api/users/${user.id}/roles`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ role: "NOT_A_ROLE" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("non-admin should not add roles (403)", async () => {
      const { token } = await createTestUser();
      const { user: otherUser } = await createTestUser();

      const res = await request(app)
        .post(`/api/users/${otherUser.id}/roles`)
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "ADMIN" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ROLE_REQUIRED");
    });

    it("returns 401 when not authenticated", async () => {
      const { user } = await createTestUser();
      const res = await request(app)
        .post(`/api/users/${user.id}/roles`)
        .send({ role: "RIDER" });
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // DELETE /api/users/:id/roles/:role  (admin only)
  // ───────────────────────────────────────────────────────────────────────────
  describe("DELETE /api/users/:id/roles/:role", () => {
    it("admin removes a role (with DB side-effect)", async () => {
      const admin = await createAdminUser();
      const { user } = await createTestUser();
      await prisma.userRoleAssignment.create({
        data: { userId: user.id, role: "SELLER" },
      });

      const res = await request(app)
        .delete(`/api/users/${user.id}/roles/SELLER`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Role removed successfully");

      const assignment = await prisma.userRoleAssignment.findUnique({
        where: { userId_role: { userId: user.id, role: "SELLER" } },
      });
      expect(assignment).toBeNull();
    });

    it("returns 404 when the user does not have that role", async () => {
      const admin = await createAdminUser();
      const { user } = await createTestUser();

      const res = await request(app)
        .delete(`/api/users/${user.id}/roles/SELLER`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(404);
    });

    it("forbids a non-admin (403)", async () => {
      const { token } = await createTestUser();
      const { user: target } = await createTestUser();

      const res = await request(app)
        .delete(`/api/users/${target.id}/roles/RIDER`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ROLE_REQUIRED");
    });

    it("returns 401 when not authenticated", async () => {
      const { user } = await createTestUser();
      const res = await request(app).delete(
        `/api/users/${user.id}/roles/RIDER`,
      );
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // DELETE /api/users/:id
  // ───────────────────────────────────────────────────────────────────────────
  describe("DELETE /api/users/:id", () => {
    it("allows a user to delete their own account (with DB side-effect)", async () => {
      const { user, token } = await createTestUser();

      const res = await request(app)
        .delete(`/api/users/${user.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("User deleted successfully");

      const fresh = await prisma.user.findUnique({ where: { id: user.id } });
      expect(fresh).toBeNull();
    });

    it("allows an admin to delete another user", async () => {
      const admin = await createAdminUser();
      const { user: target } = await createTestUser();

      const res = await request(app)
        .delete(`/api/users/${target.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const fresh = await prisma.user.findUnique({ where: { id: target.id } });
      expect(fresh).toBeNull();
    });

    it("forbids a non-admin from deleting another user (403)", async () => {
      const { token } = await createTestUser();
      const { user: target } = await createTestUser();

      const res = await request(app)
        .delete(`/api/users/${target.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("returns 404 when an admin deletes a non-existent user", async () => {
      const admin = await createAdminUser();

      const res = await request(app)
        .delete(`/api/users/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("USER_NOT_FOUND");
    });

    it("returns 401 when not authenticated", async () => {
      const { user } = await createTestUser();
      const res = await request(app).delete(`/api/users/${user.id}`);
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/users/:id/rides
  // ───────────────────────────────────────────────────────────────────────────
  describe("GET /api/users/:id/rides", () => {
    it("returns the user's rides (paginated)", async () => {
      const owner = await createTestUser();
      await createTestRide(owner.user.id, { title: "Owner Ride A" });
      await createTestRide(owner.user.id, { title: "Owner Ride B" });
      const { token } = await createTestUser();

      const res = await request(app)
        .get(`/api/users/${owner.user.id}/rides`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(2);
      // Only the owner's rides should be returned.
      for (const ride of res.body.data.items) {
        expect(ride.creatorId).toBe(owner.user.id);
      }
    });

    it("filters rides by status", async () => {
      const owner = await createTestUser();
      await createTestRide(owner.user.id, {
        title: "Completed Ride",
        status: "COMPLETED",
      });
      await createTestRide(owner.user.id, {
        title: "Planned Ride",
        status: "PLANNED",
      });

      const res = await request(app)
        .get(`/api/users/${owner.user.id}/rides?status=COMPLETED`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      for (const ride of res.body.data.items) {
        expect(ride.status).toBe("COMPLETED");
      }
    });

    it("rejects an invalid status filter (400)", async () => {
      const owner = await createTestUser();

      const res = await request(app)
        .get(`/api/users/${owner.user.id}/rides?status=NOPE`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns an empty page for an unknown but well-formed id", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .get(`/api/users/${NONEXISTENT_ID}/rides`)
        .set("Authorization", `Bearer ${token}`);

      // The handler does not check user existence; it simply returns no rides.
      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    });

    it("returns 401 when not authenticated", async () => {
      const owner = await createTestUser();
      const res = await request(app).get(`/api/users/${owner.user.id}/rides`);
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/users/:id/clubs
  // ───────────────────────────────────────────────────────────────────────────
  describe("GET /api/users/:id/clubs", () => {
    it("returns clubs owned by the user (paginated)", async () => {
      const owner = await createTestUser();
      await createTestClub(owner.user.id, { name: "Owner Club One" });

      const res = await request(app)
        .get(`/api/users/${owner.user.id}/clubs`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(1);
      for (const club of res.body.data.items) {
        expect(club.ownerId).toBe(owner.user.id);
      }
    });

    it("supports search by club name", async () => {
      const owner = await createTestUser();
      await createTestClub(owner.user.id, { name: "Unique Thunder Riders" });
      await createTestClub(owner.user.id, { name: "Calm Cruisers" });

      const res = await request(app)
        .get(`/api/users/${owner.user.id}/clubs?search=Thunder`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      const names = res.body.data.items.map((c: any) => c.name);
      expect(names).toContain("Unique Thunder Riders");
      expect(names).not.toContain("Calm Cruisers");
    });

    it("returns 401 when not authenticated", async () => {
      const owner = await createTestUser();
      const res = await request(app).get(`/api/users/${owner.user.id}/clubs`);
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/users/me/bikes
  // ───────────────────────────────────────────────────────────────────────────
  describe("POST /api/users/me/bikes", () => {
    it("adds a bike to the caller's garage (201 + DB side-effect)", async () => {
      const { user, token } = await createTestUser();

      const res = await request(app)
        .post("/api/users/me/bikes")
        .set("Authorization", `Bearer ${token}`)
        .send({ make: "Royal Enfield", model: "Meteor 350", year: 2023 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Bike added to garage");
      expect(res.body.data.make).toBe("Royal Enfield");
      expect(res.body.data.userId).toBe(user.id);

      const bikes = await prisma.bike.findMany({ where: { userId: user.id } });
      expect(bikes).toHaveLength(1);
    });

    it("defaults year to current year when omitted", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/users/me/bikes")
        .set("Authorization", `Bearer ${token}`)
        .send({ make: "Yamaha", model: "R15" });

      expect(res.status).toBe(201);
      expect(res.body.data.year).toBe(new Date().getFullYear());
    });

    it("demotes other primaries when a new primary bike is added", async () => {
      const { user, token } = await createTestUser();
      await prisma.bike.create({
        data: {
          userId: user.id,
          make: "Honda",
          model: "CB350",
          year: 2021,
          isPrimary: true,
        },
      });

      const res = await request(app)
        .post("/api/users/me/bikes")
        .set("Authorization", `Bearer ${token}`)
        .send({ make: "KTM", model: "Duke 390", year: 2024, isPrimary: true });

      expect(res.status).toBe(201);
      expect(res.body.data.isPrimary).toBe(true);

      const primaries = await prisma.bike.findMany({
        where: { userId: user.id, isPrimary: true },
      });
      expect(primaries).toHaveLength(1);
      expect(primaries[0].make).toBe("KTM");
    });

    it("rejects an invalid body (missing make) with 400", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/users/me/bikes")
        .set("Authorization", `Bearer ${token}`)
        .send({ model: "Model only" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 401 when not authenticated", async () => {
      const res = await request(app)
        .post("/api/users/me/bikes")
        .send({ make: "X", model: "Y" });
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PATCH /api/users/me/bikes/:bikeId
  // ───────────────────────────────────────────────────────────────────────────
  describe("PATCH /api/users/me/bikes/:bikeId", () => {
    it("updates a bike the caller owns", async () => {
      const { user, token } = await createTestUser();
      const bike = await prisma.bike.create({
        data: { userId: user.id, make: "Honda", model: "CB350", year: 2021 },
      });

      const res = await request(app)
        .patch(`/api/users/me/bikes/${bike.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ color: "Matte Black", odo: 12000 });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Bike updated");
      expect(res.body.data.color).toBe("Matte Black");
      expect(res.body.data.odo).toBe(12000);

      const fresh = await prisma.bike.findUnique({ where: { id: bike.id } });
      expect(fresh?.color).toBe("Matte Black");
    });

    it("returns 404 when the bike is not in the caller's garage", async () => {
      const owner = await createTestUser();
      const bike = await prisma.bike.create({
        data: {
          userId: owner.user.id,
          make: "Honda",
          model: "CB350",
          year: 2021,
        },
      });
      const other = await createTestUser();

      const res = await request(app)
        .patch(`/api/users/me/bikes/${bike.id}`)
        .set("Authorization", `Bearer ${other.token}`)
        .send({ color: "Red" });

      expect(res.status).toBe(404);
    });

    it("rejects an invalid body (400)", async () => {
      const { user, token } = await createTestUser();
      const bike = await prisma.bike.create({
        data: { userId: user.id, make: "Honda", model: "CB350", year: 2021 },
      });

      const res = await request(app)
        .patch(`/api/users/me/bikes/${bike.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ year: "not-a-number" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 401 when not authenticated", async () => {
      const res = await request(app)
        .patch("/api/users/me/bikes/some-bike-id")
        .send({ color: "Blue" });
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // DELETE /api/users/me/bikes/:bikeId
  // ───────────────────────────────────────────────────────────────────────────
  describe("DELETE /api/users/me/bikes/:bikeId", () => {
    it("removes a bike the caller owns (with DB side-effect)", async () => {
      const { user, token } = await createTestUser();
      const bike = await prisma.bike.create({
        data: { userId: user.id, make: "Honda", model: "CB350", year: 2021 },
      });

      const res = await request(app)
        .delete(`/api/users/me/bikes/${bike.id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Bike removed from garage");

      const fresh = await prisma.bike.findUnique({ where: { id: bike.id } });
      expect(fresh).toBeNull();
    });

    it("returns 404 when the bike does not belong to the caller", async () => {
      const owner = await createTestUser();
      const bike = await prisma.bike.create({
        data: {
          userId: owner.user.id,
          make: "Honda",
          model: "CB350",
          year: 2021,
        },
      });
      const other = await createTestUser();

      const res = await request(app)
        .delete(`/api/users/me/bikes/${bike.id}`)
        .set("Authorization", `Bearer ${other.token}`);

      expect(res.status).toBe(404);
      // The owner's bike must still exist.
      const fresh = await prisma.bike.findUnique({ where: { id: bike.id } });
      expect(fresh).not.toBeNull();
    });

    it("returns 401 when not authenticated", async () => {
      const res = await request(app).delete("/api/users/me/bikes/some-id");
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PATCH /api/users/me/ghost-mode
  // ───────────────────────────────────────────────────────────────────────────
  describe("PATCH /api/users/me/ghost-mode", () => {
    it("enables ghost mode and stamps ghostModeSince", async () => {
      const { user, token } = await createTestUser();

      const res = await request(app)
        .patch("/api/users/me/ghost-mode")
        .set("Authorization", `Bearer ${token}`)
        .send({ enabled: true });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Ghost mode enabled");
      expect(res.body.data.ghostModeEnabled).toBe(true);
      expect(res.body.data.ghostModeSince).not.toBeNull();

      const fresh = await prisma.user.findUnique({ where: { id: user.id } });
      expect(fresh?.ghostModeEnabled).toBe(true);
      expect(fresh?.ghostModeSince).not.toBeNull();
    });

    it("disables ghost mode and clears ghostModeSince", async () => {
      const { user, token } = await createTestUser();
      // Enable first.
      await request(app)
        .patch("/api/users/me/ghost-mode")
        .set("Authorization", `Bearer ${token}`)
        .send({ enabled: true });

      const res = await request(app)
        .patch("/api/users/me/ghost-mode")
        .set("Authorization", `Bearer ${token}`)
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Ghost mode disabled");
      expect(res.body.data.ghostModeEnabled).toBe(false);
      expect(res.body.data.ghostModeSince).toBeNull();

      const fresh = await prisma.user.findUnique({ where: { id: user.id } });
      expect(fresh?.ghostModeEnabled).toBe(false);
    });

    it("treats a missing/non-true enabled flag as disabled", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .patch("/api/users/me/ghost-mode")
        .set("Authorization", `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.ghostModeEnabled).toBe(false);
    });

    it("returns 401 when not authenticated", async () => {
      const res = await request(app)
        .patch("/api/users/me/ghost-mode")
        .send({ enabled: true });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/users/:id/follow", () => {
    it("should follow a user successfully", async () => {
      const user1 = await createTestUser();
      const { token } = await createTestUser();

      const res = await request(app)
        .post(`/api/users/${user1.user.id}/follow`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it("should not allow following self", async () => {
      const { user, token } = await createTestUser();

      const res = await request(app)
        .post(`/api/users/${user.id}/follow`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("POST /api/users/:id/unfollow", () => {
    it("should unfollow a user successfully", async () => {
      const user1 = await createTestUser();
      const user2 = await createTestUser();

      await request(app)
        .post(`/api/users/${user1.user.id}/follow`)
        .set("Authorization", `Bearer ${user2.token}`);

      const res = await request(app)
        .post(`/api/users/${user1.user.id}/unfollow`)
        .set("Authorization", `Bearer ${user2.token}`);

      expect(res.status).toBe(200);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // NOT MOUNTED / NOT PRESENT — kept skipped on purpose.
  // There is no friend-request endpoint under /api/users (friendship lives
  // at /api/friends).
  // ───────────────────────────────────────────────────────────────────────────
  describe("POST /api/users/:id/friend-request", () => {
    it.skip("should send friend request successfully", async () => {
      const user1 = await createTestUser();
      const { token } = await createTestUser();

      const res = await request(app)
        .post(`/api/users/${user1.user.id}/friend-request`)
        .set("Authorization", `Bearer ${token}`)
        .send({ message: "Hey, lets be friends!" });

      expect(res.status).toBe(201);
    });

    it.skip("should reject duplicate friend request", async () => {
      const user1 = await createTestUser();
      const { token } = await createTestUser();

      await request(app)
        .post(`/api/users/${user1.user.id}/friend-request`)
        .set("Authorization", `Bearer ${token}`)
        .send({ message: "Lets be friends" });

      const res = await request(app)
        .post(`/api/users/${user1.user.id}/friend-request`)
        .set("Authorization", `Bearer ${token}`)
        .send({ message: "Lets be friends" });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("GET /api/users/:id/public (unmounted)", () => {
    it.skip("public profile route is not wired into the app", async () => {
      // src/routes/user/public.routes.ts is never imported/mounted, so this
      // path 404s via the catch-all rather than returning a public profile.
    });
  });
});
