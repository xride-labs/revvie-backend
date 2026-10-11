import prisma from "../../lib/prisma.js";
import { sendAlertEmail } from "../../lib/mailer.js";
import { notifyUsers } from "../../lib/notifications.js";

type RecoveryAlertKind = "APPROVED" | "COMPLETED";

/**
 * Warn every reachable existing factor about a recovery milestone: email to the
 * address on file, and an in-app/push alert for riders with an active session.
 * Never includes codes, tokens, or the replacement destination itself.
 * Failures are swallowed — an alert outage must not block the state machine.
 */
export async function notifyRecoveryMilestone(
  userId: string,
  kind: RecoveryAlertKind,
  releaseAt?: Date | null,
  fallbackEmail?: string | null,
): Promise<void> {
  const subject =
    kind === "APPROVED"
      ? "Account recovery approved for your Revvie account"
      : "Your Revvie account was recovered";
  const message =
    kind === "APPROVED"
      ? `Someone asked to recover access to your account and support approved it. Sign-in methods will be replaced on ${releaseAt?.toUTCString() ?? "the scheduled date"}. If this was not you, sign in and cancel the request under Settings > Account access before then.`
      : "Your account was recovered and you were signed out of every device. If this was not you, contact support immediately.";

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    const recipients = new Set<string>();
    if (user?.email && user.emailVerified) recipients.add(user.email);
    if (fallbackEmail) recipients.add(fallbackEmail);
    for (const to of recipients) {
      await sendAlertEmail({ to, subject, message });
    }
    if (kind === "APPROVED") {
      const hasActiveSession = await prisma.session.count({
        where: { userId, expiresAt: { gt: new Date() } },
      });
      if (hasActiveSession) {
        await notifyUsers([userId], {
          type: "SYSTEM_ALERT",
          title: subject,
          message,
          relatedType: "ACCOUNT_RECOVERY",
        });
      }
    }
  } catch (error) {
    console.warn("[RECOVERY] Failed to send security alert:", error instanceof Error ? error.message : error);
  }
}
