import prisma from "../../lib/prisma.js";
import { createNotification } from "../../lib/notifications.js";
import {
  muteClubMemberEverywhere,
  setClubChatPostingBlocked,
  removeClubMemberFromClubChats,
  addClubMemberToAnnouncements,
  ensureAnnouncementsGroup,
  postGroupSystemMessage,
} from "./groupChat.service.js";

export type ModerationAction =
  | "PROMOTE"
  | "DEMOTE"
  | "MUTE"
  | "UNMUTE"
  | "SUSPEND"
  | "UNSUSPEND"
  | "BAN"
  | "UNBAN"
  | "KICK";

export type EffectiveStatus = "ACTIVE" | "MUTED" | "SUSPENDED" | "BANNED";

// Permanent ban == bannedUntil far in the future, so the same expiry check
// works for both timed and permanent bans.
const PERMANENT_MS = 100 * 365 * 24 * 60 * 60 * 1000;

interface MemberModFields {
  status: string;
  mutedUntil: Date | null;
  suspendedUntil: Date | null;
  bannedUntil: Date | null;
}

/**
 * Effective status with lazy expiry: a timed mute/suspend/ban whose deadline
 * has passed reads as ACTIVE (no cron needed). Writers also reset the row on
 * the next moderation action.
 */
export function effectiveStatus(m: MemberModFields): EffectiveStatus {
  const now = Date.now();
  if (m.status === "BANNED")
    return m.bannedUntil && m.bannedUntil.getTime() <= now
      ? "ACTIVE"
      : "BANNED";
  if (m.status === "SUSPENDED")
    return m.suspendedUntil && m.suspendedUntil.getTime() <= now
      ? "ACTIVE"
      : "SUSPENDED";
  if (m.status === "MUTED")
    return m.mutedUntil && m.mutedUntil.getTime() <= now ? "ACTIVE" : "MUTED";
  return "ACTIVE";
}

/** Is this member currently banned (timed bans auto-expire)? */
export function isBanned(m: MemberModFields | null | undefined): boolean {
  return !!m && effectiveStatus(m) === "BANNED";
}

/** Ensure + post a line into the club's Announcements channel. */
async function postClubSystem(clubId: string, text: string): Promise<void> {
  try {
    const { groupId } = await ensureAnnouncementsGroup(clubId);
    await postGroupSystemMessage(groupId, text);
  } catch (err) {
    console.error("[clubModeration] system message failed:", err);
  }
}

interface ApplyArgs {
  clubId: string;
  actorId: string;
  actorName: string;
  targetUserId: string;
  action: ModerationAction;
  expiresInMs?: number;
  reason?: string;
}

export interface ModerationResult {
  status: EffectiveStatus;
  role: string;
  removed: boolean;
}

/**
 * Apply a moderation action: mutate ClubMember state, enforce it on the
 * club's group chats, write the audit row, drop a system message, and
 * notify the target. Throws Error("...") on guard violations — the route
 * maps the message to a 400/403/404.
 */
export async function applyModeration(
  args: ApplyArgs,
): Promise<ModerationResult> {
  const { clubId, actorId, actorName, targetUserId, action, reason } = args;

  if (actorId === targetUserId) {
    throw new Error("You can't moderate yourself");
  }

  const member = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId: targetUserId } },
  });
  if (!member) throw new Error("Member not found");
  if (member.role === "FOUNDER") {
    throw new Error("The club founder can't be moderated");
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { name: true },
  });
  const name = target?.name || "A member";
  const expiresAt = args.expiresInMs
    ? new Date(Date.now() + args.expiresInMs)
    : null;

  let result: ModerationResult = {
    status: "ACTIVE",
    role: member.role,
    removed: false,
  };
  let systemLine = "";

  switch (action) {
    case "PROMOTE": {
      const updated = await prisma.clubMember.update({
        where: { clubId_userId: { clubId, userId: targetUserId } },
        data: { role: "ADMIN" },
      });
      result = { status: effectiveStatus(updated), role: updated.role, removed: false };
      systemLine = `${name} was promoted to admin by ${actorName}`;
      break;
    }
    case "DEMOTE": {
      const updated = await prisma.clubMember.update({
        where: { clubId_userId: { clubId, userId: targetUserId } },
        data: { role: "MEMBER" },
      });
      result = { status: effectiveStatus(updated), role: updated.role, removed: false };
      systemLine = `${name} is no longer an admin`;
      break;
    }
    case "MUTE": {
      await prisma.clubMember.update({
        where: { clubId_userId: { clubId, userId: targetUserId } },
        data: { status: "MUTED", mutedUntil: expiresAt },
      });
      await muteClubMemberEverywhere(clubId, targetUserId, true);
      result.status = "MUTED";
      systemLine = `${name} was muted${
        expiresAt ? ` until ${expiresAt.toLocaleString()}` : ""
      }`;
      break;
    }
    case "UNMUTE": {
      await prisma.clubMember.update({
        where: { clubId_userId: { clubId, userId: targetUserId } },
        data: { status: "ACTIVE", mutedUntil: null },
      });
      await muteClubMemberEverywhere(clubId, targetUserId, false);
      result.status = "ACTIVE";
      systemLine = `${name} was unmuted`;
      break;
    }
    case "SUSPEND": {
      await prisma.clubMember.update({
        where: { clubId_userId: { clubId, userId: targetUserId } },
        data: { status: "SUSPENDED", suspendedUntil: expiresAt },
      });
      await setClubChatPostingBlocked(clubId, targetUserId, true);
      result.status = "SUSPENDED";
      systemLine = `${name} was suspended${
        expiresAt ? ` until ${expiresAt.toLocaleString()}` : ""
      }`;
      break;
    }
    case "UNSUSPEND": {
      await prisma.clubMember.update({
        where: { clubId_userId: { clubId, userId: targetUserId } },
        data: { status: "ACTIVE", suspendedUntil: null },
      });
      await setClubChatPostingBlocked(clubId, targetUserId, false);
      result.status = "ACTIVE";
      systemLine = `${name}'s suspension was lifted`;
      break;
    }
    case "BAN": {
      await prisma.clubMember.update({
        where: { clubId_userId: { clubId, userId: targetUserId } },
        data: {
          status: "BANNED",
          bannedUntil: expiresAt ?? new Date(Date.now() + PERMANENT_MS),
        },
      });
      // Banned == removed from every group + chat (membership kept as the
      // BANNED ClubMember row so re-join is blocked until the ban lifts).
      await removeClubMemberFromClubChats(clubId, targetUserId);
      result.status = "BANNED";
      systemLine = `${name} was banned${
        expiresAt ? ` until ${expiresAt.toLocaleString()}` : " permanently"
      }`;
      break;
    }
    case "UNBAN": {
      await prisma.clubMember.update({
        where: { clubId_userId: { clubId, userId: targetUserId } },
        data: { status: "ACTIVE", bannedUntil: null },
      });
      await addClubMemberToAnnouncements(clubId, targetUserId);
      result.status = "ACTIVE";
      systemLine = `${name}'s ban was removed`;
      break;
    }
    case "KICK": {
      await prisma.clubMember.delete({
        where: { clubId_userId: { clubId, userId: targetUserId } },
      });
      await removeClubMemberFromClubChats(clubId, targetUserId);
      await prisma.club
        .update({
          where: { id: clubId },
          data: { memberCount: { decrement: 1 } },
        })
        .catch(() => {});
      result.removed = true;
      systemLine = `${name} was removed from the community`;
      break;
    }
    default:
      throw new Error("Unknown moderation action");
  }

  await prisma.clubModerationAction.create({
    data: {
      clubId,
      targetUserId,
      actorId,
      action,
      reason: reason || null,
      expiresAt,
    },
  });

  await postClubSystem(clubId, systemLine);

  // Tell the target what happened (skip pure role demotes — noisy).
  if (action !== "DEMOTE") {
    await createNotification({
      userId: targetUserId,
      type: action === "PROMOTE" ? "CLUB_INVITE" : "SYSTEM_ALERT",
      title: systemLine,
      message: reason || undefined,
      relatedType: "club",
      relatedId: clubId,
    }).catch(() => {});
  }

  return result;
}
