import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../server";
import prisma from "../../lib/prisma.js";
import { createTestUser, cleanupTestData } from "../../test/utils";
import { validateAuthEnvironment } from "../../config/authEnvironment.js";

const delivered = vi.hoisted(() => ({ codes: new Map<string, string>() }));

vi.mock("../../services/account-recovery/accountRecovery.delivery.js", () => ({
  deliverRecoveryCode: vi.fn(async (_channel: string, destination: string, code: string) => {
    delivered.codes.set(destination.trim().toLowerCase(), code);
    return true;
  }),
}));

async function verifiedChallenge(channel: "EMAIL" | "PHONE", value: string) {
  const challengeRes = await request(app)
    .post("/api/auth/recovery/challenge")
    .send({ channel, value });
  expect(challengeRes.status).toBe(202);
  const { challengeToken } = challengeRes.body.data;
  const code = delivered.codes.get(value.trim().toLowerCase())!;
  const verifyRes = await request(app)
    .post("/api/auth/recovery/challenge/verify")
    .send({ challengeToken, code });
  expect(verifyRes.status).toBe(200);
  return challengeToken as string;
}

describe("Account recovery and factor routes", () => {
  beforeEach(async () => {
    delivered.codes.clear();
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

  it("returns the same accepted response for known and unknown recovery lookups", async () => {
    const { user } = await createTestUser();
    const knownToken = await verifiedChallenge("EMAIL", "known-replacement@example.test");
    const unknownToken = await verifiedChallenge("EMAIL", "unknown-replacement@example.test");

    const known = await request(app)
      .post("/api/auth/recovery/requests")
      .send({
        lookup: user.email,
        destination: { channel: "EMAIL", value: "known-replacement@example.test", challengeToken: knownToken },
        explanation: "Lost access while changing phones.",
      });
    const unknown = await request(app)
      .post("/api/auth/recovery/requests")
      .send({
        lookup: "nobody-at-all@example.test",
        destination: { channel: "EMAIL", value: "unknown-replacement@example.test", challengeToken: unknownToken },
        explanation: "Lost access while changing phones.",
      });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body.message).toBe(unknown.body.message);
    expect(Object.keys(known.body.data).sort()).toEqual(Object.keys(unknown.body.data).sort());
  });

  it("requires the receipt token to read request status", async () => {
    const token = await verifiedChallenge("EMAIL", "receipt@example.test");
    const created = await request(app)
      .post("/api/auth/recovery/requests")
      .send({
        lookup: "someone@example.test",
        destination: { channel: "EMAIL", value: "receipt@example.test", challengeToken: token },
      });
    const { id, receiptToken } = created.body.data;

    expect((await request(app).get(`/api/auth/recovery/requests/${id}`)).status).toBe(404);
    const ok = await request(app)
      .get(`/api/auth/recovery/requests/${id}`)
      .set("X-Recovery-Receipt", receiptToken);
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe("PENDING_REVIEW");
  });

  it("rejects a request whose destination was never verified", async () => {
    const challenge = await request(app)
      .post("/api/auth/recovery/challenge")
      .send({ channel: "EMAIL", value: "unverified@example.test" });
    const response = await request(app)
      .post("/api/auth/recovery/requests")
      .send({
        lookup: "someone@example.test",
        destination: {
          channel: "EMAIL",
          value: "unverified@example.test",
          challengeToken: challenge.body.data.challengeToken,
        },
      });
    expect(response.status).toBe(400);
  });

  it("rejects linking a phone owned by another rider without modifying either user", async () => {
    const first = await createTestUser({ phone: "919876500111", phoneVerified: true });
    const second = await createTestUser({ phone: null, phoneVerified: false });
    const auth = { Authorization: `Bearer ${second.token}` };

    const challenge = await request(app)
      .post("/api/account/factors/phone/challenge")
      .set(auth)
      .send({ value: "+919876500111" });
    expect(challenge.status).toBe(200);
    const code = delivered.codes.get("+919876500111")!;

    const response = await request(app)
      .post("/api/account/factors/phone/verify")
      .set(auth)
      .send({ value: "+919876500111", challengeToken: challenge.body.data.challengeToken, code });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("FACTOR_ALREADY_LINKED");
    expect(await prisma.user.findUnique({ where: { id: first.user.id } })).toMatchObject({
      phone: "919876500111",
    });
    expect(await prisma.user.findUnique({ where: { id: second.user.id } })).toMatchObject({
      phone: null,
    });
    expect(
      await prisma.accountSecurityEvent.count({
        where: { userId: second.user.id, type: "FACTOR_LINK_REJECTED" },
      }),
    ).toBe(1);
  });

  it("links an unused verified phone to the signed-in rider", async () => {
    const rider = await createTestUser({ phone: null, phoneVerified: false });
    const auth = { Authorization: `Bearer ${rider.token}` };
    const challenge = await request(app)
      .post("/api/account/factors/phone/challenge")
      .set(auth)
      .send({ value: "+919876500222" });
    const code = delivered.codes.get("+919876500222")!;

    const response = await request(app)
      .post("/api/account/factors/phone/verify")
      .set(auth)
      .send({ value: "+919876500222", challengeToken: challenge.body.data.challengeToken, code });

    expect(response.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: rider.user.id } })).toMatchObject({
      phone: "919876500222",
      phoneVerified: true,
    });
  });

  it("does not let a different rider redeem someone else's factor challenge", async () => {
    const owner = await createTestUser({ phone: null, phoneVerified: false });
    const other = await createTestUser({ phone: null, phoneVerified: false });
    const challenge = await request(app)
      .post("/api/account/factors/phone/challenge")
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ value: "+919876500333" });
    const code = delivered.codes.get("+919876500333")!;

    const response = await request(app)
      .post("/api/account/factors/phone/verify")
      .set({ Authorization: `Bearer ${other.token}` })
      .send({ value: "+919876500333", challengeToken: challenge.body.data.challengeToken, code });

    expect(response.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: other.user.id } })).toMatchObject({ phone: null });
  });

  it("requires authentication to cancel a recovery request", async () => {
    const response = await request(app).post("/api/account/recovery/requests/anything/cancel");
    expect(response.status).toBe(401);
  });
});

describe("Auth environment validation", () => {
  it("requires passkey RP settings outside development", () => {
    expect(validateAuthEnvironment({ NODE_ENV: "production" })).toEqual(
      expect.arrayContaining(["PASSKEY_RP_ID", "PASSKEY_ORIGINS"]),
    );
  });

  it("accepts a fully configured production environment", () => {
    expect(
      validateAuthEnvironment({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "x".repeat(32),
        PASSKEY_RP_ID: "revvie.xride-labs.in",
        PASSKEY_ORIGINS: "https://revvie.xride-labs.in",
      }),
    ).toEqual([]);
  });

  it("flags a half-configured Apple provider and ignores development", () => {
    expect(
      validateAuthEnvironment({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "s",
        PASSKEY_RP_ID: "a",
        PASSKEY_ORIGINS: "b",
        AUTH_APPLE_ID: "id",
      }),
    ).toEqual(["AUTH_APPLE_SECRET"]);
    expect(validateAuthEnvironment({ NODE_ENV: "development" })).toEqual([]);
  });
});
