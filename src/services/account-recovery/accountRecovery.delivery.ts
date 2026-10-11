import { sendOtpEmail } from "../../lib/mailer.js";
import { sendApitxtOtp } from "../../lib/sms/apitxt.js";
import type { RecoveryChannel } from "./accountRecovery.types.js";

/**
 * Deliver a one-time code over the chosen channel. Reuses the existing
 * transports instead of Better Auth sign-in, which would mint a session.
 * Returns false when the transport rejects the message; callers must not
 * reveal that to unauthenticated clients.
 */
export async function deliverRecoveryCode(
  channel: RecoveryChannel,
  destination: string,
  code: string,
): Promise<boolean> {
  try {
    if (channel === "EMAIL") {
      return await sendOtpEmail({ to: destination, otp: code, name: null, isNewUser: false });
    }
    const result = await sendApitxtOtp({ mobile: destination, otp: code });
    return result.success;
  } catch (error) {
    console.warn("[RECOVERY] Code delivery failed:", error instanceof Error ? error.message : error);
    return false;
  }
}
