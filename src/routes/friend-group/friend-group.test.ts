/**
 * FRIEND GROUP ROUTES TESTS - COMPREHENSIVE AUTOMATION SUITE
 * Tests for friend group endpoints mounted at /api/friends/groups
 * (routes live in src/routes/friend-group/friend-group.routes.ts).
 *
 * Coverage targets every endpoint in friend-group.routes.ts (8 total):
 *   - GET    /                         list user's groups (paginated, search)
 *   - GET    /:id                      group detail (creator/member gated, 201)
 *   - POST   /                         create group (creator auto-membered)
 *   - PATCH  /:id                      update group (creator/staff only)
 *   - DELETE /:id                      delete group (creator/staff only)
 *   - POST   /:id/members              add members (creator/staff, { userIds })
 *   - DELETE /:id/members/:userId      remove member (creator or self)
 *   - POST   /:id/rides                create ride from group (member only)
 *
 * Behavioural notes derived from the route source (NOT assumed):
 *   - None of the :id routes use param validation, so a malformed/short id is
 *     NOT a 400 — it flows into findUnique and yields 404 (or 403 once found).
 *     The ONLY 400s in this router are: missing `name` (POST /), missing
 *     `userIds` (POST /:id/members), and removing the creator (DELETE member).
 *   - GET /:id intentionally responds 201 via ApiResponse.created with { group }.
 *   - The add-members endpoint takes { userIds: string[] } (array), returns
 *     { added: <count> }, and silently SKIPS users already in the group (so a
 *     "duplicate" add returns added: 0 — there is no 409 path in this router).
 *   - There are NO friend-group join-request HTTP endpoints in this router
 *     (the FriendGroupJoinRequest model exists but is unused here), so the
 *     join-request flow is not exercisable and is intentionally not tested.
 */

import request from "supertest";
import { app } from "../../server";
import prisma from "../../lib/prisma";
import {
  createTestUser,
  createAdminUser,
  cleanupTestData,
  assertValidSuccessResponse,
  assertValidErrorResponse,
} from "../../test/utils";

// A syntactically valid (24-char) id that does not exist -> drives 404s on the
// :id routes (which have no param validation, so this is the only "bad id"
// shape that matters here).
const NONEXISTENT_ID = "clnonexistent0000000abcd";

/**
 * Friend groups (and their member/join-request children) are NOT touched by
 * cleanupTestData(). Delete FK children first, then the groups, BEFORE the
 * shared cleanup wipes rides/users. Rides created via POST /:id/rides reference
 * the group with onDelete: SetNull, so deleting groups here never FK-blocks;
 * cleanupTestData() removes the rides themselves afterwards.
 */
async function cleanupFriendGroups() {
  await prisma.friendGroupJoinRequest.deleteMany({});
  await prisma.friendGroupMember.deleteMany({});
  await prisma.friendGroup.deleteMany({});
}

/** Create a friend group owned by `creatorId` with the creator auto-membered. */
async function createTestFriendGroup(
  creatorId: string,
  data?: Partial<{ name: string; description: string; image: string }>,
) {
  return prisma.friendGroup.create({
    data: {
      name: data?.name ?? "Test Squad",
      description: data?.description ?? null,
      image: data?.image ?? null,
      creatorId,
      members: { create: [{ userId: creatorId }] },
    },
    include: { members: true },
  });
}

/** Add an existing user as a member of a group. */
async function addGroupMember(groupId: string, userId: string) {
  return prisma.friendGroupMember.create({ data: { groupId, userId } });
}

describe("Friend Group Routes - Comprehensive Tests", () => {
  afterEach(async () => {
    await cleanupFriendGroups();
    await cleanupTestData();
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/friends/groups — List
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/friends/groups", () => {
    it("should list user's friend groups (paginated envelope)", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .get("/api/friends/groups")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Friend groups list is paginated: data is { items, pagination }.
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toMatchObject({
        page: expect.any(Number),
        limit: expect.any(Number),
        total: expect.any(Number),
        totalPages: expect.any(Number),
      });
    });

    it("should return only groups the user creates or belongs to", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const outsider = await createTestUser();

      const ownGroup = await createTestFriendGroup(owner.user.id, {
        name: "Owner Squad",
      });
      const memberGroup = await createTestFriendGroup(member.user.id, {
        name: "Member Squad",
      });
      await addGroupMember(memberGroup.id, owner.user.id);
      // A group the owner has nothing to do with -> must NOT appear.
      await createTestFriendGroup(outsider.user.id, { name: "Outsider Squad" });

      const res = await request(app)
        .get("/api/friends/groups")
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((g: { id: string }) => g.id);
      expect(ids).toContain(ownGroup.id);
      expect(ids).toContain(memberGroup.id);
      expect(res.body.data.items.length).toBe(2);
    });

    it("should include creator, members and _count in each item", async () => {
      const owner = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app)
        .get("/api/friends/groups")
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      const found = res.body.data.items.find(
        (g: { id: string }) => g.id === group.id,
      );
      expect(found).toBeDefined();
      expect(found.creator).toMatchObject({ id: owner.user.id });
      expect(Array.isArray(found.members)).toBe(true);
      expect(found._count).toMatchObject({
        members: expect.any(Number),
        rides: expect.any(Number),
      });
    });

    it("should filter by search term (name)", async () => {
      const owner = await createTestUser();
      await createTestFriendGroup(owner.user.id, { name: "Sunday Tourers" });
      await createTestFriendGroup(owner.user.id, { name: "Track Day Crew" });

      const res = await request(app)
        .get("/api/friends/groups")
        .query({ search: "Tourers" })
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      const names = res.body.data.items.map((g: { name: string }) => g.name);
      expect(names).toContain("Sunday Tourers");
      expect(names).not.toContain("Track Day Crew");
    });

    it("should honour pagination params", async () => {
      const owner = await createTestUser();
      await createTestFriendGroup(owner.user.id, { name: "A Squad" });
      await createTestFriendGroup(owner.user.id, { name: "B Squad" });
      await createTestFriendGroup(owner.user.id, { name: "C Squad" });

      const res = await request(app)
        .get("/api/friends/groups")
        .query({ page: 1, limit: 2 })
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.pagination).toMatchObject({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it("should reject invalid pagination query with 400", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .get("/api/friends/groups")
        .query({ limit: "-5" })
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      assertValidErrorResponse(res.body, 400);
    });

    it("should return 401 without auth", async () => {
      const res = await request(app).get("/api/friends/groups");
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/friends/groups — Create
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/friends/groups", () => {
    it("should create a friend group and auto-member the creator", async () => {
      const { token, user } = await createTestUser();

      const res = await request(app)
        .post("/api/friends/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Weekend Riders", description: "Casual cruises" });

      expect(res.status).toBe(201);
      assertValidSuccessResponse(res.body, "group");
      const group = res.body.data.group;
      expect(group).toMatchObject({
        name: "Weekend Riders",
        description: "Casual cruises",
        creatorId: user.id,
      });
      // Creator is always added as a member.
      const memberIds = group.members.map((m: { userId: string }) => m.userId);
      expect(memberIds).toContain(user.id);

      // DB side-effect: row + creator membership actually persisted.
      const dbGroup = await prisma.friendGroup.findUnique({
        where: { id: group.id },
        include: { members: true },
      });
      expect(dbGroup).not.toBeNull();
      expect(dbGroup!.members.some((m) => m.userId === user.id)).toBe(true);
    });

    it("should create with extra memberIds (creator never duplicated)", async () => {
      const owner = await createTestUser();
      const friendA = await createTestUser();
      const friendB = await createTestUser();

      const res = await request(app)
        .post("/api/friends/groups")
        .set("Authorization", `Bearer ${owner.token}`)
        .send({
          name: "Invite Squad",
          memberIds: [friendA.user.id, friendB.user.id, owner.user.id],
        });

      expect(res.status).toBe(201);
      const group = res.body.data.group;
      const memberIds: string[] = group.members.map(
        (m: { userId: string }) => m.userId,
      );
      // owner + 2 friends, with owner present exactly once (not duplicated).
      expect(memberIds).toContain(owner.user.id);
      expect(memberIds).toContain(friendA.user.id);
      expect(memberIds).toContain(friendB.user.id);
      expect(memberIds.filter((id) => id === owner.user.id).length).toBe(1);
      expect(group._count.members).toBe(3);
    });

    it("should return 400 when name is missing", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post("/api/friends/groups")
        .set("Authorization", `Bearer ${token}`)
        .send({ description: "no name here" });

      expect(res.status).toBe(400);
      assertValidErrorResponse(res.body, 400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 401 without auth", async () => {
      const res = await request(app)
        .post("/api/friends/groups")
        .send({ name: "Nope" });
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // GET /api/friends/groups/:id — Detail
  // ───────────────────────────────────────────────────────────────────────
  describe("GET /api/friends/groups/:id", () => {
    it("should return a group for its creator (201 + { group })", async () => {
      const owner = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app)
        .get(`/api/friends/groups/${group.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      // The handler returns 201 via ApiResponse.created (not 200).
      expect(res.status).toBe(201);
      assertValidSuccessResponse(res.body, "group");
      expect(res.body.data.group.id).toBe(group.id);
      expect(Array.isArray(res.body.data.group.members)).toBe(true);
      expect(Array.isArray(res.body.data.group.rides)).toBe(true);
    });

    it("should return a group for a non-creator member", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);
      await addGroupMember(group.id, member.user.id);

      const res = await request(app)
        .get(`/api/friends/groups/${group.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(res.status).toBe(201);
      expect(res.body.data.group.id).toBe(group.id);
    });

    it("should return 403 for a non-member", async () => {
      const owner = await createTestUser();
      const outsider = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app)
        .get(`/api/friends/groups/${group.id}`)
        .set("Authorization", `Bearer ${outsider.token}`);

      expect(res.status).toBe(403);
      assertValidErrorResponse(res.body, 403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("should return 404 for a non-existent group", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .get(`/api/friends/groups/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      assertValidErrorResponse(res.body, 404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("should return 401 without auth", async () => {
      const owner = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app).get(`/api/friends/groups/${group.id}`);
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // PATCH /api/friends/groups/:id — Update
  // ───────────────────────────────────────────────────────────────────────
  describe("PATCH /api/friends/groups/:id", () => {
    it("should update a group as its creator (200 + persisted)", async () => {
      const owner = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id, {
        name: "Old Name",
      });

      const res = await request(app)
        .patch(`/api/friends/groups/${group.id}`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ name: "New Name", description: "Refreshed" });

      expect(res.status).toBe(200);
      assertValidSuccessResponse(res.body, "group");
      expect(res.body.data.group).toMatchObject({
        name: "New Name",
        description: "Refreshed",
      });

      const dbGroup = await prisma.friendGroup.findUnique({
        where: { id: group.id },
      });
      expect(dbGroup!.name).toBe("New Name");
      expect(dbGroup!.description).toBe("Refreshed");
    });

    it("should allow staff (admin) to update a group they don't own", async () => {
      const owner = await createTestUser();
      const admin = await createAdminUser();
      const group = await createTestFriendGroup(owner.user.id, {
        name: "Owner Only",
      });

      const res = await request(app)
        .patch(`/api/friends/groups/${group.id}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ name: "Admin Edited" });

      expect(res.status).toBe(200);
      expect(res.body.data.group.name).toBe("Admin Edited");
    });

    it("should return 403 for a non-creator non-staff (member included)", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);
      await addGroupMember(group.id, member.user.id);

      const res = await request(app)
        .patch(`/api/friends/groups/${group.id}`)
        .set("Authorization", `Bearer ${member.token}`)
        .send({ name: "Hacked Name" });

      expect(res.status).toBe(403);
      assertValidErrorResponse(res.body, 403);
      expect(res.body.error.code).toBe("FORBIDDEN");

      // Side-effect check: the name must be unchanged.
      const dbGroup = await prisma.friendGroup.findUnique({
        where: { id: group.id },
      });
      expect(dbGroup!.name).not.toBe("Hacked Name");
    });

    it("should return 404 for a non-existent group", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .patch(`/api/friends/groups/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Whatever" });

      expect(res.status).toBe(404);
      assertValidErrorResponse(res.body, 404);
    });

    it("should return 401 without auth", async () => {
      const owner = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app)
        .patch(`/api/friends/groups/${group.id}`)
        .send({ name: "Nope" });
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // DELETE /api/friends/groups/:id — Delete
  // ───────────────────────────────────────────────────────────────────────
  describe("DELETE /api/friends/groups/:id", () => {
    it("should delete a group as its creator (200 + row removed)", async () => {
      const owner = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app)
        .delete(`/api/friends/groups/${group.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbGroup = await prisma.friendGroup.findUnique({
        where: { id: group.id },
      });
      expect(dbGroup).toBeNull();
      // Member rows cascade-delete with the group.
      const members = await prisma.friendGroupMember.findMany({
        where: { groupId: group.id },
      });
      expect(members.length).toBe(0);
    });

    it("should allow staff (admin) to delete a group they don't own", async () => {
      const owner = await createTestUser();
      const admin = await createAdminUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app)
        .delete(`/api/friends/groups/${group.id}`)
        .set("Authorization", `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      const dbGroup = await prisma.friendGroup.findUnique({
        where: { id: group.id },
      });
      expect(dbGroup).toBeNull();
    });

    it("should return 403 for a non-creator non-staff member", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);
      await addGroupMember(group.id, member.user.id);

      const res = await request(app)
        .delete(`/api/friends/groups/${group.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(res.status).toBe(403);
      assertValidErrorResponse(res.body, 403);

      // Group must still exist.
      const dbGroup = await prisma.friendGroup.findUnique({
        where: { id: group.id },
      });
      expect(dbGroup).not.toBeNull();
    });

    it("should return 404 for a non-existent group", async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .delete(`/api/friends/groups/${NONEXISTENT_ID}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      assertValidErrorResponse(res.body, 404);
    });

    it("should return 401 without auth", async () => {
      const owner = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app).delete(`/api/friends/groups/${group.id}`);
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/friends/groups/:id/members — Add members
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/friends/groups/:id/members", () => {
    it("should add new members as the creator (200 + { added })", async () => {
      const owner = await createTestUser();
      const friendA = await createTestUser();
      const friendB = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app)
        .post(`/api/friends/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userIds: [friendA.user.id, friendB.user.id] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.added).toBe(2);

      // DB side-effect: both memberships now exist.
      const members = await prisma.friendGroupMember.findMany({
        where: { groupId: group.id },
        select: { userId: true },
      });
      const ids = members.map((m) => m.userId);
      expect(ids).toContain(friendA.user.id);
      expect(ids).toContain(friendB.user.id);
    });

    it("should skip users already in the group (added counts only new)", async () => {
      const owner = await createTestUser();
      const existing = await createTestUser();
      const fresh = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);
      await addGroupMember(group.id, existing.user.id);

      const res = await request(app)
        .post(`/api/friends/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${owner.token}`)
        // existing.user.id is already a member -> must be skipped, not 409.
        .send({ userIds: [existing.user.id, fresh.user.id] });

      expect(res.status).toBe(200);
      expect(res.body.data.added).toBe(1);

      // No duplicate membership row was created for the existing user.
      const dupCount = await prisma.friendGroupMember.count({
        where: { groupId: group.id, userId: existing.user.id },
      });
      expect(dupCount).toBe(1);
    });

    it("should return added: 0 when all userIds are already members", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);
      await addGroupMember(group.id, member.user.id);

      const res = await request(app)
        .post(`/api/friends/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${owner.token}`)
        // creator + existing member: both already in -> nothing added.
        .send({ userIds: [owner.user.id, member.user.id] });

      expect(res.status).toBe(200);
      expect(res.body.data.added).toBe(0);
    });

    it("should return 400 when userIds is missing or empty", async () => {
      const owner = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const missing = await request(app)
        .post(`/api/friends/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({});
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe("VALIDATION_ERROR");

      const empty = await request(app)
        .post(`/api/friends/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userIds: [] });
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 403 for a non-creator non-staff member", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const target = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);
      await addGroupMember(group.id, member.user.id);

      const res = await request(app)
        .post(`/api/friends/groups/${group.id}/members`)
        .set("Authorization", `Bearer ${member.token}`)
        .send({ userIds: [target.user.id] });

      expect(res.status).toBe(403);
      assertValidErrorResponse(res.body, 403);

      // No membership added for the target.
      const count = await prisma.friendGroupMember.count({
        where: { groupId: group.id, userId: target.user.id },
      });
      expect(count).toBe(0);
    });

    it("should return 404 for a non-existent group (checked before body)", async () => {
      const owner = await createTestUser();
      const friend = await createTestUser();

      const res = await request(app)
        .post(`/api/friends/groups/${NONEXISTENT_ID}/members`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ userIds: [friend.user.id] });

      expect(res.status).toBe(404);
      assertValidErrorResponse(res.body, 404);
    });

    it("should return 401 without auth", async () => {
      const owner = await createTestUser();
      const friend = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app)
        .post(`/api/friends/groups/${group.id}/members`)
        .send({ userIds: [friend.user.id] });
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // DELETE /api/friends/groups/:id/members/:userId — Remove member
  // ───────────────────────────────────────────────────────────────────────
  describe("DELETE /api/friends/groups/:id/members/:userId", () => {
    it("should let the creator remove another member (200 + row gone)", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);
      await addGroupMember(group.id, member.user.id);

      const res = await request(app)
        .delete(`/api/friends/groups/${group.id}/members/${member.user.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const count = await prisma.friendGroupMember.count({
        where: { groupId: group.id, userId: member.user.id },
      });
      expect(count).toBe(0);
    });

    it("should let a member remove themselves (200 + row gone)", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);
      await addGroupMember(group.id, member.user.id);

      const res = await request(app)
        .delete(`/api/friends/groups/${group.id}/members/${member.user.id}`)
        .set("Authorization", `Bearer ${member.token}`);

      expect(res.status).toBe(200);
      const count = await prisma.friendGroupMember.count({
        where: { groupId: group.id, userId: member.user.id },
      });
      expect(count).toBe(0);
    });

    it("should return 400 when trying to remove the creator", async () => {
      const owner = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app)
        .delete(`/api/friends/groups/${group.id}/members/${owner.user.id}`)
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(400);
      assertValidErrorResponse(res.body, 400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");

      // Creator membership untouched.
      const count = await prisma.friendGroupMember.count({
        where: { groupId: group.id, userId: owner.user.id },
      });
      expect(count).toBe(1);
    });

    it("should return 403 when a non-creator removes someone else", async () => {
      const owner = await createTestUser();
      const memberA = await createTestUser();
      const memberB = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);
      await addGroupMember(group.id, memberA.user.id);
      await addGroupMember(group.id, memberB.user.id);

      const res = await request(app)
        .delete(`/api/friends/groups/${group.id}/members/${memberB.user.id}`)
        .set("Authorization", `Bearer ${memberA.token}`);

      expect(res.status).toBe(403);
      assertValidErrorResponse(res.body, 403);

      // memberB still present.
      const count = await prisma.friendGroupMember.count({
        where: { groupId: group.id, userId: memberB.user.id },
      });
      expect(count).toBe(1);
    });

    it("should return 404 for a non-existent group", async () => {
      const owner = await createTestUser();
      const target = await createTestUser();

      const res = await request(app)
        .delete(
          `/api/friends/groups/${NONEXISTENT_ID}/members/${target.user.id}`,
        )
        .set("Authorization", `Bearer ${owner.token}`);

      expect(res.status).toBe(404);
      assertValidErrorResponse(res.body, 404);
    });

    it("should return 401 without auth", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);
      await addGroupMember(group.id, member.user.id);

      const res = await request(app).delete(
        `/api/friends/groups/${group.id}/members/${member.user.id}`,
      );
      expect(res.status).toBe(401);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/friends/groups/:id/rides — Create ride from group
  // ───────────────────────────────────────────────────────────────────────
  describe("POST /api/friends/groups/:id/rides", () => {
    it("should create a ride as a group member (201 + auto-participants)", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);
      await addGroupMember(group.id, member.user.id);

      const res = await request(app)
        .post(`/api/friends/groups/${group.id}/rides`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({
          title: "Squad Sunday Run",
          startLocation: "Clubhouse",
          endLocation: "Coast Road",
          distance: 120,
          duration: 240,
        });

      expect(res.status).toBe(201);
      assertValidSuccessResponse(res.body, "ride");
      const ride = res.body.data.ride;
      expect(ride).toMatchObject({
        title: "Squad Sunday Run",
        startLocation: "Clubhouse",
        creatorId: owner.user.id,
        friendGroupId: group.id,
      });

      // DB side-effect: all group members auto-added as ride participants.
      const participants = await prisma.rideParticipant.findMany({
        where: { rideId: ride.id },
        select: { userId: true },
      });
      const pIds = participants.map((p) => p.userId);
      expect(pIds).toContain(owner.user.id);
      expect(pIds).toContain(member.user.id);
      expect(pIds.length).toBe(2);
    });

    it("should return 400 when title or startLocation is missing", async () => {
      const owner = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const noTitle = await request(app)
        .post(`/api/friends/groups/${group.id}/rides`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ startLocation: "Somewhere" });
      expect(noTitle.status).toBe(400);
      expect(noTitle.body.error.code).toBe("VALIDATION_ERROR");

      const noStart = await request(app)
        .post(`/api/friends/groups/${group.id}/rides`)
        .set("Authorization", `Bearer ${owner.token}`)
        .send({ title: "Missing Start" });
      expect(noStart.status).toBe(400);
      expect(noStart.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 403 for a non-member", async () => {
      const owner = await createTestUser();
      const outsider = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app)
        .post(`/api/friends/groups/${group.id}/rides`)
        .set("Authorization", `Bearer ${outsider.token}`)
        .send({ title: "Intruder Ride", startLocation: "Gate" });

      expect(res.status).toBe(403);
      assertValidErrorResponse(res.body, 403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("should return 403 for a non-existent group (membership check first)", async () => {
      // No membership row exists for a non-existent group, so the member gate
      // returns 403 before any not-found check.
      const { token } = await createTestUser();

      const res = await request(app)
        .post(`/api/friends/groups/${NONEXISTENT_ID}/rides`)
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "Ghost Ride", startLocation: "Nowhere" });

      expect(res.status).toBe(403);
      assertValidErrorResponse(res.body, 403);
    });

    it("should return 401 without auth", async () => {
      const owner = await createTestUser();
      const group = await createTestFriendGroup(owner.user.id);

      const res = await request(app)
        .post(`/api/friends/groups/${group.id}/rides`)
        .send({ title: "Nope", startLocation: "Nowhere" });
      expect(res.status).toBe(401);
    });
  });
});
