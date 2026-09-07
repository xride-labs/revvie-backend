import crypto from "crypto";
import prisma from "./prisma.js";
import { normalizePhoneNumber, sendApitxtOtp } from "./sms/apitxt.js";

const OTP_TTL_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS = 5;

export interface SendPhoneOtpResult {
  success: boolean;
  message: string;
  expiresAt: Date;
  normalizedPhone: string;
}

export interface VerifyPhoneOtpResult {
  success: boolean;
  message: string;
  normalizedPhone: string;
}

/**
 * Generate a random 6-digit OTP string.
 */
export function generateNumericOtp(length = 6): string {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length);
  return crypto.randomInt(min, max).toString();
}

/**
 * Initiates an OTP verification sequence for the given phone number.
 * Enforces a resend cooldown and stores the code in the Verification table.
 */
export async function initiatePhoneVerification(phone: string): Promise<SendPhoneOtpResult> {
  const normalizedPhone = normalizePhoneNumber(phone);
  const identifier = `phone:${normalizedPhone}`;

  // Check existing verification for cooldown
  const existing = await prisma.verification.findFirst({
    where: { identifier },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();

  if (existing && existing.createdAt) {
    const elapsedSeconds = (now.getTime() - new Date(existing.createdAt).getTime()) / 1000;
    if (elapsedSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
      const waitTime = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
      throw new Error(`Please wait ${waitTime}s before requesting a new verification code.`);
    }
  }

  const otp = generateNumericOtp(6);
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000);

  // Store in format "code:attempts" (e.g., "123456:0")
  const valuePayload = `${otp}:0`;

  if (existing) {
    await prisma.verification.update({
      where: { id: existing.id },
      data: {
        value: valuePayload,
        expiresAt,
        createdAt: now,
      },
    });
  } else {
    await prisma.verification.create({
      data: {
        identifier,
        value: valuePayload,
        expiresAt,
        createdAt: now,
      },
    });
  }

  // Send via APITxT
  const smsResult = await sendApitxtOtp({
    mobile: normalizedPhone,
    otp,
  });

  if (!smsResult.success) {
    throw new Error(smsResult.message || "Failed to deliver SMS verification code.");
  }

  return {
    success: true,
    message: "Verification code sent successfully via SMS.",
    expiresAt,
    normalizedPhone,
  };
}

/**
 * Validates the OTP provided by the user against the record in the Verification table.
 */
export async function validatePhoneOtp(
  phone: string,
  inputOtp: string,
): Promise<VerifyPhoneOtpResult> {
  const normalizedPhone = normalizePhoneNumber(phone);
  const identifier = `phone:${normalizedPhone}`;
  const trimmedOtp = inputOtp.trim();

  const record = await prisma.verification.findFirst({
    where: { identifier },
    orderBy: { createdAt: "desc" },
  });

  if (!record) {
    throw new Error("No verification code was requested for this phone number. Please request one.");
  }

  const now = new Date();
  if (record.expiresAt < now) {
    await prisma.verification.delete({ where: { id: record.id } }).catch(() => {});
    throw new Error("Verification code has expired. Please request a new code.");
  }

  // Parse "code:attempts"
  const parts = record.value.split(":");
  const storedOtp = parts[0];
  const attempts = parseInt(parts[1] || "0", 10);

  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    await prisma.verification.delete({ where: { id: record.id } }).catch(() => {});
    throw new Error("Too many incorrect attempts. Please request a new verification code.");
  }

  if (storedOtp !== trimmedOtp) {
    // Increment failed attempts
    const nextAttempts = attempts + 1;
    await prisma.verification.update({
      where: { id: record.id },
      data: {
        value: `${storedOtp}:${nextAttempts}`,
      },
    });
    const remaining = MAX_VERIFY_ATTEMPTS - nextAttempts;
    throw new Error(
      remaining > 0
        ? `Incorrect verification code. ${remaining} attempt${remaining > 1 ? "s" : ""} remaining.`
        : "Too many incorrect attempts. Please request a new verification code.",
    );
  }

  // OTP verified successfully - consume/delete the verification record
  await prisma.verification.delete({ where: { id: record.id } }).catch(() => {});

  return {
    success: true,
    message: "Phone number verified successfully.",
    normalizedPhone,
  };
}
