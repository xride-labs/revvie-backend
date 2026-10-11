import type { AccountSecurityEventType, Prisma } from "@prisma/client";
import prisma from "./prisma.js";

/**
 * Append an audit record for an account-security action. Never pass OTP
 * values, bearer tokens, or raw destinations in `metadata`.
 */
export async function recordSecurityEvent(input: {
  type: AccountSecurityEventType;
  userId?: string | null;
  requestId?: string | null;
  actorUserId?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.accountSecurityEvent.create({
      data: {
        type: input.type,
        userId: input.userId ?? null,
        requestId: input.requestId ?? null,
        actorUserId: input.actorUserId ?? null,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    console.warn("[SECURITY] Failed to record security event:", error);
  }
}
