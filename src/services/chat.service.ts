import { Types } from "mongoose";
import prisma from "../lib/prisma.js";
import { recordClubMessageActivity } from "./clubActivity.service.js";
import {
  Conversation,
  Message,
  UnreadCount,
  ConversationType,
  MessageType,
  ParticipantRole,
  DisappearingPolicy,
  POLICY_TTL_MS,
  DEFAULT_DISAPPEARING_POLICY,
  IConversation,
  IMessage,
  IAttachment,
  ILocation,
  IParticipant,
} from "../models/chat.model.js";

// ─── Participant Hydration ──────────────────────────────────────────────────
//
// Conversations live in MongoDB but Users live in Postgres, so participants
// are stored as bare userIds. Mobile lists conversations using whichever
// participant isn't the viewer — without hydrated names this falls back to
// rendering raw cuids as conversation titles. These helpers do a single
// batched Prisma lookup per response and merge name/avatar onto each
// participant in-memory before serialising.

export interface HydratedParticipant extends Omit<IParticipant, "nickname"> {
  nickname?: string;
  displayName?: string;
  avatar?: string | null;
  username?: string | null;
}

export interface HydratedConversation extends Omit<IConversation, "participants"> {
  participants: HydratedParticipant[];
}

export async function hydrateParticipants<
  T extends { participants: IParticipant[] | HydratedParticipant[] },
>(conversations: T[]): Promise<(T & { participants: HydratedParticipant[] })[]> {
  if (!conversations.length) return conversations as any;

  const ids = new Set<string>();
  for (const c of conversations) {
    for (const p of c.participants) {
      if (p?.userId && p.userId !== "system") ids.add(p.userId);
    }
  }
  if (!ids.size) return conversations as any;

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(ids) } },
    select: { id: true, name: true, username: true, avatar: true, image: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return conversations.map((c) => ({
    ...c,
    participants: c.participants.map((p: IParticipant | HydratedParticipant) => {
      const u = byId.get(p.userId);
      const displayName = u?.name ?? u?.username ?? null;
      return {
        ...p,
        // Keep `nickname` populated for mobile clients whose `getDisplayName`
        // already falls back to it — this means the fix lands without a
        // mobile release.
        nickname: p.nickname || displayName || undefined,
        displayName: displayName ?? undefined,
        avatar: u?.avatar ?? u?.image ?? null,
        username: u?.username ?? null,
      } as HydratedParticipant;
    }),
  })) as any;
}

export async function hydrateConversation<
  T extends { participants: IParticipant[] | HydratedParticipant[] },
>(conversation: T | null): Promise<(T & { participants: HydratedParticipant[] }) | null> {
  if (!conversation) return null;
  const [hydrated] = await hydrateParticipants([conversation]);
  return hydrated;
}

/**
 * Compute when a message should expire given a conversation's policy and
 * the global retention cap. The cap clamps the policy so a misconfigured
 * retentionMaxDays can't keep messages around longer than legal/policy
 * allows. Returns null when retention is disabled (OFF policy).
 */
export function computeMessageExpiresAt(
  policy: DisappearingPolicy,
  retentionMaxDays: number,
): Date | null {
  const policyMs = POLICY_TTL_MS[policy];
  if (policyMs == null) return null;
  const capMs = Math.max(0, retentionMaxDays) * 24 * 60 * 60 * 1000;
  const ttlMs = capMs > 0 ? Math.min(policyMs, capMs) : policyMs;
  return new Date(Date.now() + ttlMs);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateConversationInput {
  type: ConversationType;
  participantIds: string[];
  relatedEntityId?: string;
  metadata?: {
    name?: string;
    avatar?: string;
    description?: string;
  };
  parentConversationId?: string;
  createdBy: string;
}

export interface SendMessageInput {
  conversationId: string;
  senderId: string;
  senderName: string;
  text?: string;
  messageType?: MessageType;
  attachments?: IAttachment[];
  location?: ILocation | null;
  replyTo?: string;
  mentions?: string[];
  poll?: {
    question: string;
    options: { id: string; text: string; votes: string[] }[];
    multipleAnswers: boolean;
    endsAt?: Date;
  };
}

export interface CursorPaginationOptions {
  cursor?: string; // message _id
  limit?: number;
  direction?: "before" | "after";
}

export interface ConversationListOptions {
  userId: string;
  type?: ConversationType;
  cursor?: string; // updatedAt ISO string
  limit?: number;
}

// ─── Conversation Service ────────────────────────────────────────────────────

export class ChatService {
  // ── Create or get existing direct conversation ──────────────────────────

  static async findOrCreateDirectConversation(
    userIdA: string,
    userIdB: string,
    createdBy: string,
  ): Promise<IConversation> {
    // Check for existing direct conversation between these two users
    const existing = await Conversation.findOne({
      type: ConversationType.DIRECT,
      "participants.userId": { $all: [userIdA, userIdB] },
      participants: { $size: 2 },
      isActive: true,
    });

    if (existing) return existing;

    return Conversation.create({
      type: ConversationType.DIRECT,
      participants: [
        { userId: userIdA, role: ParticipantRole.MEMBER },
        { userId: userIdB, role: ParticipantRole.MEMBER },
      ],
      createdBy,
    });
  }

  // ── Create group conversation (ride, club, marketplace) ─────────────────

  static async createGroupConversation(
    input: CreateConversationInput,
  ): Promise<IConversation> {
    // For entity-linked chats, prevent duplicates
    if (input.relatedEntityId) {
      const existing = await Conversation.findOne({
        type: input.type,
        relatedEntityId: input.relatedEntityId,
        isActive: true,
      });
      if (existing) return existing;
    }

    const participants = input.participantIds.map((userId, i) => ({
      userId,
      role:
        userId === input.createdBy
          ? ParticipantRole.OWNER
          : ParticipantRole.MEMBER,
    }));

    return Conversation.create({
      type: input.type,
      participants,
      relatedEntityId: input.relatedEntityId ?? null,
      parentConversationId: input.parentConversationId ?? null,
      metadata: input.metadata ?? {},
      createdBy: input.createdBy,
    });
  }

  // ── Create any conversation (dispatcher) ────────────────────────────────

  static async createConversation(
    input: CreateConversationInput,
  ): Promise<IConversation> {
    if (
      input.type === ConversationType.DIRECT &&
      input.participantIds.length === 2
    ) {
      return this.findOrCreateDirectConversation(
        input.participantIds[0],
        input.participantIds[1],
        input.createdBy,
      );
    }
    return this.createGroupConversation(input);
  }

  // ── Get conversation by ID ──────────────────────────────────────────────

  static async getConversationById(
    conversationId: string,
  ): Promise<IConversation | null> {
    if (!Types.ObjectId.isValid(conversationId)) return null;
    return Conversation.findById(conversationId);
  }

  // ── Get conversation by related entity ──────────────────────────────────

  static async getConversationByEntity(
    type: ConversationType,
    relatedEntityId: string,
  ): Promise<IConversation | null> {
    return Conversation.findOne({ type, relatedEntityId, isActive: true });
  }

  // ── List conversations for a user ───────────────────────────────────────

  static async listConversations(
    options: ConversationListOptions,
  ): Promise<{ conversations: IConversation[]; nextCursor: string | null }> {
    const { userId, type, limit = 25 } = options;
    const clampedLimit = Math.min(limit, 50);

    const filter: any = {
      "participants.userId": userId,
      isActive: true,
    };

    if (type) filter.type = type;

    if (options.cursor) {
      filter.updatedAt = { $lt: new Date(options.cursor) };
    }

    const conversations = await Conversation.find(filter)
      .sort({ updatedAt: -1 })
      .limit(clampedLimit + 1)
      .lean();

    const hasMore = conversations.length > clampedLimit;
    const results = hasMore
      ? conversations.slice(0, clampedLimit)
      : conversations;
    const nextCursor = hasMore
      ? results[results.length - 1].updatedAt.toISOString()
      : null;

    return { conversations: results as unknown as IConversation[], nextCursor };
  }

  // ── Add participant to a conversation ───────────────────────────────────

  static async addParticipant(
    conversationId: string,
    userId: string,
    role: ParticipantRole = ParticipantRole.MEMBER,
  ): Promise<IConversation | null> {
    return Conversation.findByIdAndUpdate(
      conversationId,
      {
        $addToSet: {
          participants: { userId, role, joinedAt: new Date(), isMuted: false },
        },
      },
      { new: true },
    );
  }

  // ── Remove participant from a conversation ──────────────────────────────

  static async removeParticipant(
    conversationId: string,
    userId: string,
  ): Promise<IConversation | null> {
    const result = await Conversation.findByIdAndUpdate(
      conversationId,
      { $pull: { participants: { userId } } },
      { new: true },
    );

    // Clean up unread count
    await UnreadCount.deleteOne({
      userId,
      conversationId: new Types.ObjectId(conversationId),
    });

    return result;
  }

  // ── Suspend participant ──────────────────────────────────────────────────
  static async suspendParticipant(
    conversationId: string,
    userId: string,
    suspendedUntil: Date,
  ): Promise<void> {
    await Conversation.updateOne(
      {
        _id: new Types.ObjectId(conversationId),
        "participants.userId": userId,
      },
      { $set: { "participants.$.suspendedUntil": suspendedUntil } }
    );
  }

  // ── Check if user is participant ────────────────────────────────────────

  static async isParticipant(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const count = await Conversation.countDocuments({
      _id: new Types.ObjectId(conversationId),
      "participants.userId": userId,
      isActive: true,
    });
    return count > 0;
  }

  // ── Update conversation metadata ────────────────────────────────────────

  static async updateMetadata(
    conversationId: string,
    metadata: Partial<{ name: string; avatar: string; description: string }>,
  ): Promise<IConversation | null> {
    const updates: Record<string, any> = {};
    if (metadata.name !== undefined) updates["metadata.name"] = metadata.name;
    if (metadata.avatar !== undefined)
      updates["metadata.avatar"] = metadata.avatar;
    if (metadata.description !== undefined)
      updates["metadata.description"] = metadata.description;

    return Conversation.findByIdAndUpdate(
      conversationId,
      { $set: updates },
      { new: true },
    );
  }

  // ── Mute / unmute conversation for a user ───────────────────────────────

  static async muteConversation(
    conversationId: string,
    userId: string,
    mute: boolean,
  ): Promise<void> {
    await Conversation.updateOne(
      {
        _id: new Types.ObjectId(conversationId),
        "participants.userId": userId,
      },
      { $set: { "participants.$.isMuted": mute } },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Message Service
  // ─────────────────────────────────────────────────────────────────────────

  // ── Send a message ──────────────────────────────────────────────────────

  /**
   * Update a conversation's disappearing-message policy. Only affects
   * messages sent *after* the change — existing messages keep their
   * original expiresAt so users don't unexpectedly lose history when a
   * stricter policy is selected.
   */
  static async setDisappearingPolicy(
    conversationId: string,
    policy: DisappearingPolicy,
  ): Promise<void> {
    await Conversation.findByIdAndUpdate(new Types.ObjectId(conversationId), {
      $set: { disappearingPolicy: policy },
    });
  }

  static async sendMessage(input: SendMessageInput): Promise<IMessage> {
    const conversationOid = new Types.ObjectId(input.conversationId);

    // Resolve the conversation's disappearing policy *before* the insert so
    // the message lands with the correct expiresAt. Reading from a single
    // findById is fine here — the unread-count updates below already require
    // a fetch anyway.
    const convForPolicy = (await Conversation.findById(conversationOid)
      .select("disappearingPolicy retentionMaxDays")
      .lean()) as unknown as Pick<IConversation, "disappearingPolicy" | "retentionMaxDays"> | null;

    const expiresAt = computeMessageExpiresAt(
      convForPolicy?.disappearingPolicy ?? DEFAULT_DISAPPEARING_POLICY,
      convForPolicy?.retentionMaxDays ?? 30,
    );

    const message = await Message.create({
      conversationId: conversationOid,
      senderId: input.senderId,
      text: input.text ?? null,
      messageType: input.messageType ?? MessageType.TEXT,
      attachments: input.attachments ?? [],
      location: input.location ?? null,
      replyTo: input.replyTo ? new Types.ObjectId(input.replyTo) : null,
      mentions: input.mentions ?? [],
      poll: input.poll ?? null,
      readBy: [{ userId: input.senderId, readAt: new Date() }],
      deliveredTo: [{ userId: input.senderId, deliveredAt: new Date() }],
      expiresAt,
    });

    // Update lastMessage on conversation
    const displayText =
      input.text ??
      (input.location
        ? "📍 Location"
        : input.attachments?.length
          ? `Sent ${input.attachments[0].type}`
          : "Message");

    await Conversation.findByIdAndUpdate(conversationOid, {
      $set: {
        lastMessage: {
          text: displayText.slice(0, 200),
          senderId: input.senderId,
          senderName: input.senderName,
          sentAt: message.createdAt,
          messageType: input.messageType ?? MessageType.TEXT,
        },
        updatedAt: new Date(),
      },
    });

    // Increment unread count for all OTHER participants
    const conversation = (await Conversation.findById(
      conversationOid,
    ).lean()) as unknown as IConversation | null;
    if (conversation) {
      const otherParticipants = conversation.participants.filter(
        (p: IParticipant) => p.userId !== input.senderId,
      );
      const bulkOps = otherParticipants.map((p: IParticipant) => ({
        updateOne: {
          filter: { userId: p.userId, conversationId: conversationOid },
          update: { $inc: { count: 1 }, $set: { updatedAt: new Date() } },
          upsert: true,
        },
      }));
      if (bulkOps.length) await UnreadCount.bulkWrite(bulkOps);
    }

    // Fire-and-forget club activity tracking (no-op for non-club chats).
    void recordClubMessageActivity(input.conversationId, input.senderId);

    return message;
  }

  // ── Get messages with cursor-based pagination ───────────────────────────

  static async getMessages(
    conversationId: string,
    options: CursorPaginationOptions = {},
  ): Promise<{ messages: IMessage[]; nextCursor: string | null }> {
    const { limit = 30, direction = "before" } = options;
    const clampedLimit = Math.min(limit, 50);
    const conversationOid = new Types.ObjectId(conversationId);

    const filter: any = {
      conversationId: conversationOid,
      deletedAt: null,
    };

    if (options.cursor && Types.ObjectId.isValid(options.cursor)) {
      const cursorOid = new Types.ObjectId(options.cursor);
      filter._id =
        direction === "before" ? { $lt: cursorOid } : { $gt: cursorOid };
    }

    const sortDir = direction === "before" ? -1 : 1;

    const messages = await Message.find(filter)
      .sort({ _id: sortDir })
      .limit(clampedLimit + 1)
      .populate("replyTo", "senderId text messageType")
      .lean();

    const hasMore = messages.length > clampedLimit;
    const results = hasMore ? messages.slice(0, clampedLimit) : messages;

    // If we fetched "after" we need to reverse to chronological order
    if (direction === "after") results.reverse();

    const nextCursor = hasMore
      ? (results[results.length - 1]._id as Types.ObjectId).toString()
      : null;

    return { messages: messages as unknown as IMessage[], nextCursor };
  }

  // ── Pin message ─────────────────────────────────────────────────────────

  static async setPinMessage(messageId: string, isPinned: boolean): Promise<IMessage | null> {
    return Message.findByIdAndUpdate(
      messageId,
      { $set: { isPinned } },
      { new: true }
    );
  }

  // ── Vote Poll ───────────────────────────────────────────────────────────

  static async votePoll(messageId: string, optionId: string, userId: string): Promise<IMessage | null> {
    const message = await Message.findById(messageId);
    if (!message || !message.poll) return null;

    if (!message.poll.multipleAnswers) {
      // Remove user's vote from all options
      message.poll.options.forEach((opt: any) => {
        opt.votes = opt.votes.filter((v: string) => v !== userId);
      });
    }

    const option = message.poll.options.find((o: any) => o.id === optionId);
    if (option) {
      if (!option.votes.includes(userId)) {
        option.votes.push(userId);
      } else {
        option.votes = option.votes.filter((v: string) => v !== userId); // toggle vote
      }
    }

    // Must mark modified to save nested array
    message.markModified('poll');
    await message.save();
    return message;
  }

  // ── Edit a message ──────────────────────────────────────────────────────

  static async editMessage(
    messageId: string,
    senderId: string,
    newText: string,
  ): Promise<IMessage | null> {
    return Message.findOneAndUpdate(
      {
        _id: new Types.ObjectId(messageId),
        senderId,
        deletedAt: null,
      },
      { $set: { text: newText, editedAt: new Date() } },
      { new: true },
    );
  }

  // ── Soft-delete a message ───────────────────────────────────────────────

  static async deleteMessage(
    messageId: string,
    senderId: string,
  ): Promise<IMessage | null> {
    return Message.findOneAndUpdate(
      {
        _id: new Types.ObjectId(messageId),
        senderId,
        deletedAt: null,
      },
      {
        $set: {
          deletedAt: new Date(),
          text: null,
          attachments: [],
        },
      },
      { new: true },
    );
  }

  // ── Add reaction ────────────────────────────────────────────────────────

  static async addReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<IMessage | null> {
    // Remove existing reaction by this user first, then add new one
    await Message.updateOne(
      { _id: new Types.ObjectId(messageId) },
      { $pull: { reactions: { userId } } },
    );

    return Message.findByIdAndUpdate(
      messageId,
      {
        $push: {
          reactions: { userId, emoji, createdAt: new Date() },
        },
      },
      { new: true },
    );
  }

  // ── Remove reaction ─────────────────────────────────────────────────────

  static async removeReaction(
    messageId: string,
    userId: string,
  ): Promise<IMessage | null> {
    return Message.findByIdAndUpdate(
      messageId,
      { $pull: { reactions: { userId } } },
      { new: true },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Read Receipts & Unread Counts
  // ─────────────────────────────────────────────────────────────────────────

  // ── Mark messages as read ───────────────────────────────────────────────

  static async markAsRead(
    conversationId: string,
    userId: string,
  ): Promise<{ modifiedCount: number }> {
    const conversationOid = new Types.ObjectId(conversationId);

    // Add read receipt to all unread messages in this conversation
    const result = await Message.updateMany(
      {
        conversationId: conversationOid,
        senderId: { $ne: userId },
        "readBy.userId": { $ne: userId },
        deletedAt: null,
      },
      {
        $push: { readBy: { userId, readAt: new Date() } },
      },
    );

    // Get the latest message id for this conversation
    const latestMessage = (await Message.findOne({
      conversationId: conversationOid,
    })
      .sort({ _id: -1 })
      .select("_id")
      .lean()) as unknown as { _id: Types.ObjectId } | null;

    // Reset unread count
    await UnreadCount.findOneAndUpdate(
      { userId, conversationId: conversationOid },
      {
        $set: {
          count: 0,
          lastReadAt: new Date(),
          lastReadMessageId: latestMessage?._id ?? null,
        },
      },
      { upsert: true },
    );

    return { modifiedCount: result.modifiedCount };
  }

  // ── Mark message as delivered ───────────────────────────────────────────

  static async markAsDelivered(
    messageId: string,
    userId: string,
  ): Promise<void> {
    await Message.updateOne(
      {
        _id: new Types.ObjectId(messageId),
        "deliveredTo.userId": { $ne: userId },
      },
      {
        $push: { deliveredTo: { userId, deliveredAt: new Date() } },
      },
    );
  }

  // ── Get unread counts for a user ────────────────────────────────────────

  static async getUnreadCounts(
    userId: string,
  ): Promise<{ conversationId: string; count: number }[]> {
    const counts = await UnreadCount.find({ userId, count: { $gt: 0 } })
      .select("conversationId count")
      .lean();

    return counts.map((c) => ({
      conversationId: c.conversationId.toString(),
      count: c.count,
    }));
  }

  // ── Get total unread badge count ────────────────────────────────────────

  static async getTotalUnreadCount(userId: string): Promise<number> {
    const result = await UnreadCount.aggregate([
      { $match: { userId, count: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: "$count" } } },
    ]);
    return result[0]?.total ?? 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Cleanup & Admin
  // ─────────────────────────────────────────────────────────────────────────

  // ── Archive / deactivate a conversation ─────────────────────────────────

  static async archiveConversation(
    conversationId: string,
  ): Promise<IConversation | null> {
    return Conversation.findByIdAndUpdate(
      conversationId,
      { $set: { isActive: false } },
      { new: true },
    );
  }

  // ── Send a system message ───────────────────────────────────────────────

  static async sendSystemMessage(
    conversationId: string,
    text: string,
  ): Promise<IMessage> {
    return this.sendMessage({
      conversationId,
      senderId: "system",
      senderName: "System",
      text,
      messageType: MessageType.SYSTEM,
    });
  }
}
