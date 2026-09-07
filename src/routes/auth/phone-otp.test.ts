import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../../server.js";
import prisma from "../../lib/prisma.js";
import { normalizePhoneNumber } from "../../lib/sms/apitxt.js";
import {
  initiatePhoneVerification,
  validatePhoneOtp,
} from "../../lib/phoneVerification.js";
import { createTestUser, cleanupTestData } from "../../test/utils.js";

describe("Phone OTP Verification (APITxT)", () => {
  beforeEach(async () => {
    await prisma.verification.deleteMany({
      where: { identifier: { startsWith: "phone:" } },
    });
  });

  afterEach(async () => {
    await prisma.verification.deleteMany({
      where: { identifier: { startsWith: "phone:" } },
    });
    await cleanupTestData();
  });

  describe("Phone number normalization", () => {
    it("should strip '+' and non-digit characters", () => {
      expect(normalizePhoneNumber("+91 98765 43210")).toBe("919876543210");
      expect(normalizePhoneNumber("+1 (555) 123-4567")).toBe("15551234567");
    });

    it("should prepend default country code 91 for 10-digit Indian numbers", () => {
      expect(normalizePhoneNumber("9876543210")).toBe("919876543210");
    });
  });

  describe("Phone verification library logic", () => {
    it("should initiate verification and store OTP in database", async () => {
      const testPhone = "+919876500001";
      const normalizedPhone = "919876500001";
      const identifier = `phone:${normalizedPhone}`;

      const res = await initiatePhoneVerification(testPhone);
      expect(res.success).toBe(true);
      expect(res.normalizedPhone).toBe(normalizedPhone);

      const record = await prisma.verification.findFirst({
        where: { identifier },
      });
      expect(record).not.toBeNull();
      expect(record?.identifier).toBe(identifier);
      expect(record?.value).toMatch(/^\d{6}:0$/);
    });

    it("should enforce cooldown on rapid re-requests", async () => {
      const testPhone = "+919876500002";
      await initiatePhoneVerification(testPhone);
      await expect(initiatePhoneVerification(testPhone)).rejects.toThrow(
        /Please wait \d+s before requesting a new verification code/i,
      );
    });

    it("should successfully validate correct OTP and consume the record", async () => {
      const testPhone = "+919876500003";
      const normalizedPhone = "919876500003";
      const identifier = `phone:${normalizedPhone}`;

      await initiatePhoneVerification(testPhone);
      const record = await prisma.verification.findFirst({
        where: { identifier },
      });
      const storedOtp = record?.value.split(":")[0]!;

      const verifyRes = await validatePhoneOtp(testPhone, storedOtp);
      expect(verifyRes.success).toBe(true);

      // Record should be deleted after successful verification
      const afterRecord = await prisma.verification.findFirst({
        where: { identifier },
      });
      expect(afterRecord).toBeNull();
    });

    it("should increment attempt count and reject incorrect OTP", async () => {
      const testPhone = "+919876500004";
      const normalizedPhone = "919876500004";
      const identifier = `phone:${normalizedPhone}`;

      await initiatePhoneVerification(testPhone);

      await expect(validatePhoneOtp(testPhone, "000000")).rejects.toThrow(
        /Incorrect verification code\. 4 attempts remaining/i,
      );

      const record = await prisma.verification.findFirst({
        where: { identifier },
      });
      expect(record?.value).toMatch(/^\d{6}:1$/);
    });
  });

  describe("Account Phone Endpoints", () => {
    it("POST /api/account/phone/send-otp should require authentication", async () => {
      const res = await request(app)
        .post("/api/account/phone/send-otp")
        .send({ phone: "+919876512345" });

      expect(res.status).toBe(401);
    });

    it("POST /api/account/phone/send-otp and verify-otp should update phone on user", async () => {
      const { user, token } = await createTestUser();
      const testPhone = "+919876512399";
      const normalizedPhone = "919876512399";

      // 1. Send OTP
      const sendRes = await request(app)
        .post("/api/account/phone/send-otp")
        .set("Authorization", `Bearer ${token}`)
        .send({ phone: testPhone });

      expect(sendRes.status).toBe(200);
      expect(sendRes.body.success).toBe(true);

      // Read stored OTP
      const record = await prisma.verification.findFirst({
        where: { identifier: `phone:${normalizedPhone}` },
      });
      const otp = record?.value.split(":")[0]!;

      // 2. Verify OTP
      const verifyRes = await request(app)
        .post("/api/account/phone/verify-otp")
        .set("Authorization", `Bearer ${token}`)
        .send({ phone: testPhone, otp });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.data.phoneVerified).toBe(true);
      expect(verifyRes.body.data.phone).toBe(normalizedPhone);

      // Verify in DB
      const updatedUser = await prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(updatedUser?.phoneVerified).toBe(true);
      expect(updatedUser?.phone).toBe(normalizedPhone);
    });
  });

  describe("Public Phone Auth Endpoints", () => {
    it("POST /api/auth/phone/send-otp and verify-otp should sign up or log in user", async () => {
      const publicPhone = "+919876599887";
      const normalized = "919876599887";

      // 1. Send OTP publicly
      const sendRes = await request(app)
        .post("/api/auth/phone/send-otp")
        .send({ phone: publicPhone });

      expect(sendRes.status).toBe(200);
      expect(sendRes.body.success).toBe(true);

      // Read stored OTP
      const record = await prisma.verification.findFirst({
        where: { identifier: `phone:${normalized}` },
      });
      const otp = record?.value.split(":")[0]!;

      // 2. Verify OTP publicly
      const verifyRes = await request(app)
        .post("/api/auth/phone/verify-otp")
        .send({ phone: publicPhone, otp });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.data.token).toBeDefined();
      expect(verifyRes.body.data.user.phone).toBe(normalized);
      expect(verifyRes.body.data.user.phoneVerified).toBe(true);
    });
  });
});
