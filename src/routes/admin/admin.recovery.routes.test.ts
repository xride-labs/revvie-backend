import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../server";
import prisma from "../../lib/prisma.js";
import { createTestUser, createAdminUser, cleanupTestData } from "../../test/utils";
import { accountRecoveryService } from "../auth/recovery.routes.js";
import { processDueAccountRecoveries } from "../../jobs/scheduler.js";
import { RECOVERY_HOLD_MS } from "../../services/account-recovery/accountRecovery.service.js";

vi.mock("../../services/account-recovery/accountRecovery.notifications.js", () => ({
  notifyRecoveryMilestone: vi.fn(async () => undefined),
}));

const base = "/api/admin/account-recoveries";

async function giveSession(userId: string) {
  await prisma.session.create({
    data: {
      userId,
      token: `recovery-test-${userId}-${Date.now()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
}

async function createSupportAgent() {
  const agent = await createTestUser();
  const role =
    (await prisma.role.findFirst({ where: { slug: "co_admin", scope: "GLOBAL" } })) ??
    (await prisma.role.create({
      data: { name: "Co-admin", slug: "co_admin", scope: "GLOBAL", isSystem: true },
    }));
  await prisma.userRoleAssignment.create({ data: { userId: agent.user.id, roleId: role.id } });
  return agent;
}

async function createRecoveryRequest(email: string, replacement: string) {
  const challenge = await accountRecoveryService.createChallenge({
    channel: "EMAIL",
    value: replacement,
    purpose: "RECOVERY_DESTINATION",
  });
  await accountRecoveryService.verifyChallenge({
    challengeToken: challenge.challengeToken,
    code: challenge.code,
  });
  return accountRecoveryService.createRequest({
    lookup: email,
    destination: { channel: "EMAIL", value: replacement, challengeToken: challenge.challengeToken },
    explanation: "Lost every device.",
  });
}

describe("Admin account recovery review", () => {
  beforeEach(async () => {
    await prisma.accountSecurityEvent.deleteMany();
    await prisma.accountRecoveryRequest.deleteMany();
    await prisma.accountRecoveryChallenge.deleteMany();
  });

  afterEach(async () => {
    await prisma.accountSecurityEvent.deleteMany();
    await prisma.accountRecoveryRequest.deleteMany();
    await prisma.accountRecoveryChallenge.deleteMany();
    await cleanupTestData();
  });

  it("allows support to request information but only a security admin to approve", async () => {
    const rider = await createTestUser();
    const supportAgent = await createSupportAgent();
    const securityAdmin = await createAdminUser();
    const created = await createRecoveryRequest(rider.user.email, "support-flow@example.test");
    const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

    expect(
      (await request(app).post(`${base}/${created.id}/request-info`).set(auth(supportAgent)).send({ note: "Send ID" })).status,
    ).toBe(200);
    expect(
      (await request(app).post(`${base}/${created.id}/approve`).set(auth(supportAgent)).send({ retireFactors: ["EMAIL"] })).status,
    ).toBe(403);
    const approve = await request(app)
      .post(`${base}/${created.id}/approve`)
      .set(auth(securityAdmin))
      .send({ retireFactors: ["EMAIL", "PHONE", "OAUTH", "PASSKEY"] });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe("APPROVED");
    const hold = new Date(approve.body.data.releaseAt).getTime() - Date.now();
    expect(Math.abs(hold - RECOVERY_HOLD_MS)).toBeLessThan(60_000);
  });

  it("rejects approval without a retirement list and for non-admins", async () => {
    const rider = await createTestUser();
    const securityAdmin = await createAdminUser();
    const created = await createRecoveryRequest(rider.user.email, "no-list@example.test");

    const empty = await request(app)
      .post(`${base}/${created.id}/approve`)
      .set({ Authorization: `Bearer ${securityAdmin.token}` })
      .send({ retireFactors: [] });
    expect(empty.status).toBe(400);

    const asRider = await request(app)
      .get(base)
      .set({ Authorization: `Bearer ${rider.token}` });
    expect(asRider.status).toBe(403);
  });

  it("cannot approve a case that matches no account", async () => {
    const securityAdmin = await createAdminUser();
    const created = await createRecoveryRequest("ghost@example.test", "ghost-new@example.test");
    const response = await request(app)
      .post(`${base}/${created.id}/approve`)
      .set({ Authorization: `Bearer ${securityAdmin.token}` })
      .send({ retireFactors: ["EMAIL"] });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("NO_MATCHING_ACCOUNT");
  });

  it("revokes sessions once after the hold expires and not before", async () => {
    const rider = await createTestUser();
    const securityAdmin = await createAdminUser();
    await giveSession(rider.user.id);
    const created = await createRecoveryRequest(rider.user.email, "release@example.test");
    const approve = await request(app)
      .post(`${base}/${created.id}/approve`)
      .set({ Authorization: `Bearer ${securityAdmin.token}` })
      .send({ retireFactors: ["EMAIL", "PHONE", "OAUTH", "PASSKEY"] });
    const releaseAt = new Date(approve.body.data.releaseAt);

    await processDueAccountRecoveries(new Date(releaseAt.getTime() - 60_000));
    expect(await prisma.session.count({ where: { userId: rider.user.id } })).toBeGreaterThan(0);

    const after = new Date(releaseAt.getTime() + 60_000);
    expect(await processDueAccountRecoveries(after)).toEqual({ completed: 1, failed: 0 });
    expect(await processDueAccountRecoveries(after)).toEqual({ completed: 0, failed: 0 });
    expect(await prisma.session.count({ where: { userId: rider.user.id } })).toBe(0);
    expect(
      await prisma.accountSecurityEvent.count({
        where: { userId: rider.user.id, type: "RECOVERY_COMPLETED" },
      }),
    ).toBe(1);
  });

  it("does not release a case that was cancelled before the hold ended", async () => {
    const rider = await createTestUser();
    const securityAdmin = await createAdminUser();
    await giveSession(rider.user.id);
    const created = await createRecoveryRequest(rider.user.email, "cancelled@example.test");
    const approve = await request(app)
      .post(`${base}/${created.id}/approve`)
      .set({ Authorization: `Bearer ${securityAdmin.token}` })
      .send({ retireFactors: ["EMAIL"] });

    const cancel = await request(app)
      .post(`/api/account/recovery/requests/${created.id}/cancel`)
      .set({ Authorization: `Bearer ${rider.token}` });
    expect(cancel.status).toBe(200);

    const after = new Date(new Date(approve.body.data.releaseAt).getTime() + 60_000);
    expect(await processDueAccountRecoveries(after)).toEqual({ completed: 0, failed: 0 });
    expect(await processDueAccountRecoveries(after)).toEqual({ completed: 0, failed: 0 });
    expect(await prisma.session.count({ where: { userId: rider.user.id } })).toBeGreaterThan(0);
    expect(
      await prisma.accountRecoveryRequest.findUnique({ where: { id: created.id } }),
    ).toMatchObject({ status: "CANCELLED" });
  });
});
