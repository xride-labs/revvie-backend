import { Types } from "mongoose";
import prisma from "../../lib/prisma.js";
import {
  Conversation,
  UnreadCount,
  ConversationType,
  ParticipantRole,
  IConversation,
} from "../../models/chat.model.js";
import { ChatService } from "../chat.service.js";

/**
 * Every club FriendGroup (including the auto-created "Announcements" group)
 * is backed by exactly one Mongo "group" Conversation, bound via
 * relatedEntityId = friendGroup.id and mirrored back onto
 * FriendGroup.conversationId.
 *
 * This module is the single place that keeps the Postgres group and its
 * Mongo chat in sync: lazy create + link, membership mirroring, metadata
 * mirroring, and join/leave system messages. Routes should call these
 * helpers instead of touching Conversation directly so the two stores never
 * drift.
 */

type GroupForConversation = {
  id: string;
  name: string;
  image: string | null;
  description: string | null;
  creatorId: string;
  conversationId: string | null;
  members: { userId: string }[];
};

async function loadGroup(groupId: string): Promise<GroupForConversation> {
  const group = await prisma.friendGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      image: true,
      description: true,
      creatorId: true,
      conversationId: true,
      members: { select: { userId: true } },
    },
  });
  if (!group) throw new Error("Friend group not found");
  return group as GroupForConversation;
}

/**
 * Resolve (and lazily create + link) the Conversation for a group. Safe to
 * call repeatedly — it reuses an existing linked/entity-bound conversation
 * and only writes the FriendGroup.conversationId column when it changes.
 */
export async function ensureGroupConversation(
  groupId: string,
): Promise<string> {
  const group = await loadGroup(groupId);

  if (group.conversationId && Types.ObjectId.isValid(group.conversationId)) {
    const existing = await Conversation.findById(group.conversationId).select(
      "_id",
    );
    if (existing) return group.conversationId;
  }

  // Reuse a conversation already bound to this entity (created before the
  // conversationId column existed) before minting a new one.
  let convo: IConversation | null = await Conversation.findOne({
    type: ConversationType.GROUP,
    relatedEntityId: group.id,
  });

  if (!convo) {
    const memberIds = new Set<string>(group.members.map((m) => m.userId));
    memberIds.add(group.creatorId);
    convo = await Conversation.create({
      type: ConversationType.GROUP,
      relatedEntityId: group.id,
      participants: Array.from(memberIds).map((userId) => ({
        userId,
        role:
          userId === group.creatorId
            ? ParticipantRole.OWNER
            : ParticipantRole.MEMBER,
      })),
      metadata: {
        name: group.name,
        avatar: group.image ?? undefined,
        description: group.description ?? undefined,
      },
      createdBy: group.creatorId,
    });
  }

  const conversationId = (convo!._id as Types.ObjectId).toString();
  if (group.conversationId !== conversationId) {
    await prisma.friendGroup.update({
      where: { id: group.id },
      data: { conversationId },
    });
  }
  return conversationId;
}

/** Add a member to the group's chat (idempotent). */
export async function addGroupParticipant(
  groupId: string,
  userId: string,
  role: ParticipantRole = ParticipantRole.MEMBER,
): Promise<string> {
  const conversationId = await ensureGroupConversation(groupId);
  await Conversation.updateOne(
    {
      _id: new Types.ObjectId(conversationId),
      "participants.userId": { $ne: userId },
    },
    {
      $push: {
        participants: { userId, role, joinedAt: new Date(), isMuted: false },
      },
    },
  );
  return conversationId;
}

/** Remove a member from the group's chat. No-op if not yet linked. */
export async function removeGroupParticipant(
  groupId: string,
  userId: string,
): Promise<void> {
  const group = await prisma.friendGroup.findUnique({
    where: { id: groupId },
    select: { conversationId: true },
  });
  if (!group?.conversationId) return;
  await Conversation.updateOne(
    { _id: new Types.ObjectId(group.conversationId) },
    { $pull: { participants: { userId } } },
  );
}

/** Deactivate a group's chat when the group is deleted. */
export async function archiveGroupConversation(
  conversationId: string,
): Promise<void> {
  await ChatService.archiveConversation(conversationId);
}

/** Mirror name/avatar/description changes onto the chat. */
export async function syncGroupMetadata(groupId: string): Promise<void> {
  const group = await prisma.friendGroup.findUnique({
    where: { id: groupId },
    select: {
      conversationId: true,
      name: true,
      image: true,
      description: true,
    },
  });
  if (!group?.conversationId) return;
  await ChatService.updateMetadata(group.conversationId, {
    name: group.name,
    avatar: group.image ?? undefined,
    description: group.description ?? undefined,
  });
}

/**
 * Post a system line ("Alex joined the group") into the group's chat.
 * Best-effort: never throws into the calling route.
 */
export async function postGroupSystemMessage(
  groupId: string,
  text: string,
): Promise<void> {
  try {
    const conversationId = await ensureGroupConversation(groupId);
    await ChatService.sendSystemMessage(conversationId, text);
  } catch (err) {
    console.error("[clubGroupChat] system message failed:", err);
  }
}

export interface GroupChatSummary {
  conversationId: string;
  lastMessage: {
    text: string;
    senderId: string;
    senderName: string;
    sentAt: Date;
    messageType: string;
  } | null;
  unreadCount: number;
  isMuted: boolean;
  disappearingPolicy: string;
}

/**
 * Batched chat metadata for a set of groups, for the community-home list
 * (avatar · name · last text · unread · mute). Ensures a conversation for
 * any group that doesn't have one yet so the list is never half-wired.
 */
export async function getGroupChatSummaries(
  groupIds: string[],
  userId: string,
): Promise<Record<string, GroupChatSummary>> {
  const out: Record<string, GroupChatSummary> = {};
  if (!groupIds.length) return out;

  // Lazily link any group missing a conversation (bounded by page size).
  await Promise.all(
    groupIds.map((gid) =>
      ensureGroupConversation(gid).catch((e) =>
        console.error(`[clubGroupChat] ensure ${gid} failed:`, e),
      ),
    ),
  );

  const convos = (await Conversation.find({
    type: ConversationType.GROUP,
    relatedEntityId: { $in: groupIds },
  })
    .select("relatedEntityId lastMessage participants disappearingPolicy")
    .lean()) as any[];

  const convoIds = convos.map((c) => c._id);
  const unread = (await UnreadCount.find({
    userId,
    conversationId: { $in: convoIds },
    count: { $gt: 0 },
  })
    .select("conversationId count")
    .lean()) as any[];
  const unreadByConvo = new Map(
    unread.map((u) => [u.conversationId.toString(), u.count as number]),
  );

  for (const c of convos) {
    const cid = c._id.toString();
    const mine = (c.participants || []).find(
      (p: any) => p.userId === userId,
    );
    out[c.relatedEntityId] = {
      conversationId: cid,
      lastMessage: c.lastMessage ?? null,
      unreadCount: unreadByConvo.get(cid) ?? 0,
      isMuted: !!mine?.isMuted,
      disappearingPolicy: c.disappearingPolicy ?? "day_1",
    };
  }
  return out;
}

// ─── Default "Announcements" group ───────────────────────────────────────────
//
// Every club has exactly one isAnnouncement FriendGroup, post-locked to
// admins (postPolicy = "ADMINS_ONLY"), that every club member belongs to.
// This is the WhatsApp-Community "Announcements" channel. It is created
// lazily so pre-existing clubs are backfilled on first community open.

export const ANNOUNCEMENTS_GROUP_NAME = "Announcements";

/**
 * Ensure the club's Announcements group + chat exist and contain every
 * current club member. Idempotent and race-tolerant (a rare double-create
 * collapses to the oldest row on the next call).
 */
export async function ensureAnnouncementsGroup(
  clubId: string,
): Promise<{ groupId: string; conversationId: string }> {
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: {
      id: true,
      name: true,
      image: true,
      ownerId: true,
      members: { select: { userId: true } },
    },
  });
  if (!club) throw new Error("Club not found");

  const memberIds = Array.from(
    new Set<string>([club.ownerId, ...club.members.map((m) => m.userId)]),
  );

  let group = await prisma.friendGroup.findFirst({
    where: { clubId, isAnnouncement: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!group) {
    group = await prisma.friendGroup.create({
      data: {
        clubId,
        name: ANNOUNCEMENTS_GROUP_NAME,
        description: `Official announcements for ${club.name}.`,
        image: club.image,
        isAnnouncement: true,
        postPolicy: "ADMINS_ONLY",
        joinApprovalRequired: false,
        creatorId: club.ownerId,
        members: { create: memberIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
  } else {
    // Backfill any club members missing from an already-existing group.
    const present = await prisma.friendGroupMember.findMany({
      where: { groupId: group.id },
      select: { userId: true },
    });
    const presentIds = new Set(present.map((m) => m.userId));
    const missing = memberIds.filter((uid) => !presentIds.has(uid));
    if (missing.length) {
      await prisma.friendGroupMember.createMany({
        data: missing.map((userId) => ({ groupId: group!.id, userId })),
        skipDuplicates: true,
      });
    }
  }

  const conversationId = await ensureGroupConversation(group.id);
  return { groupId: group.id, conversationId };
}

/** Add a freshly-joined club member to the Announcements group + chat. */
export async function addClubMemberToAnnouncements(
  clubId: string,
  userId: string,
): Promise<void> {
  try {
    const { groupId } = await ensureAnnouncementsGroup(clubId);
    await prisma.friendGroupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId },
      update: {},
    });
    await addGroupParticipant(groupId, userId);
  } catch (err) {
    console.error("[clubGroupChat] addClubMemberToAnnouncements failed:", err);
  }
}

/** Mute/unmute a member across every club group chat (read-only enforcement). */
export async function muteClubMemberEverywhere(
  clubId: string,
  userId: string,
  mute: boolean,
): Promise<void> {
  try {
    const groups = await prisma.friendGroup.findMany({
      where: { clubId, conversationId: { not: null } },
      select: { conversationId: true },
    });
    const ids = groups
      .map((g) => g.conversationId!)
      .filter(Boolean)
      .map((c) => new Types.ObjectId(c));
    if (!ids.length) return;
    await Conversation.updateMany(
      { _id: { $in: ids }, "participants.userId": userId },
      { $set: { "participants.$.isMuted": mute } },
    );
  } catch (err) {
    console.error("[clubGroupChat] muteClubMemberEverywhere failed:", err);
  }
}

/**
 * Block/unblock a member from posting in any club group by removing/re-adding
 * them as a chat participant. FriendGroupMember rows are kept so unblocking
 * cleanly restores access (announcements always restored on unblock).
 */
export async function setClubChatPostingBlocked(
  clubId: string,
  userId: string,
  blocked: boolean,
): Promise<void> {
  try {
    const groups = await prisma.friendGroup.findMany({
      where: { clubId },
      select: { id: true, conversationId: true },
    });
    if (blocked) {
      for (const g of groups) {
        if (g.conversationId) await removeGroupParticipant(g.id, userId);
      }
      return;
    }
    // Unblock: re-add to every group they're still a member of.
    const memberships = await prisma.friendGroupMember.findMany({
      where: { groupId: { in: groups.map((g) => g.id) }, userId },
      select: { groupId: true },
    });
    for (const m of memberships) {
      await addGroupParticipant(m.groupId, userId);
    }
  } catch (err) {
    console.error("[clubGroupChat] setClubChatPostingBlocked failed:", err);
  }
}

/**
 * When a member leaves / is removed from a club, drop them from every club
 * group's membership + chat (Announcements included).
 */
export async function removeClubMemberFromClubChats(
  clubId: string,
  userId: string,
): Promise<void> {
  try {
    const groups = await prisma.friendGroup.findMany({
      where: { clubId },
      select: { id: true, conversationId: true, creatorId: true },
    });
    for (const g of groups) {
      // The creator stays as conversation owner even if removed as a club
      // member, to avoid orphaning the chat.
      if (g.creatorId === userId) continue;
      await prisma.friendGroupMember
        .deleteMany({ where: { groupId: g.id, userId } })
        .catch(() => {});
      if (g.conversationId) await removeGroupParticipant(g.id, userId);
    }
  } catch (err) {
    console.error("[clubGroupChat] removeClubMemberFromClubChats failed:", err);
  }
}
