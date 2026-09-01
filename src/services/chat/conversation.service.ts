import { Types } from "mongoose";
import prisma from "../../lib/prisma.js";
import {
  Conversation,
  UnreadCount,
  ConversationType,
  ParticipantRole,
  DisappearingPolicy,
  IConversation,
  IParticipant,
} from "../../models/chat.model.js";
import {
  HydratedParticipant,
  HydratedConversation,
  CreateConversationInput,
  ConversationListOptions,
} from "./chat.types.js";

export class ConversationService {
  static async hydrateParticipants<
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
          nickname: p.nickname || displayName || undefined,
          displayName: displayName ?? undefined,
          avatar: u?.avatar ?? u?.image ?? null,
          username: u?.username ?? null,
        } as HydratedParticipant;
      }),
    })) as any;
  }

  static async hydrateConversation<
    T extends { participants: IParticipant[] | HydratedParticipant[] },
  >(conversation: T | null): Promise<(T & { participants: HydratedParticipant[] }) | null> {
    if (!conversation) return null;
    const [hydrated] = await this.hydrateParticipants([conversation]);
    return hydrated;
  }

  static async findOrCreateDirectConversation(
    userIdA: string,
    userIdB: string,
    createdBy: string,
  ): Promise<IConversation> {
    // Check privacy settings for the receiver
    const receiverId = userIdA === createdBy ? userIdB : userIdA;
    const receiverPrefs = await prisma.userPreferences.findUnique({
      where: { userId: receiverId },
      select: { allowDMsFrom: true },
    });

    const allowDMsFrom = receiverPrefs?.allowDMsFrom || "everyone";

    if (allowDMsFrom === "none") {
      throw new Error("This user does not accept direct messages");
    }

    if (allowDMsFrom === "friends") {
      const isFriend = await prisma.friendship.findFirst({
        where: {
          OR: [
            { senderId: createdBy, receiverId, status: "ACCEPTED" },
            { senderId: receiverId, receiverId: createdBy, status: "ACCEPTED" },
          ],
        },
      });
      
      if (!isFriend) {
        throw new Error("This user only accepts direct messages from friends");
      }
    }

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

  static async createGroupConversation(
    input: CreateConversationInput,
  ): Promise<IConversation> {
    if (input.relatedEntityId) {
      const existing = await Conversation.findOne({
        type: input.type,
        relatedEntityId: input.relatedEntityId,
        isActive: true,
      });
      if (existing) return existing;
    }

    const participants = input.participantIds.map((userId) => ({
      userId,
      role: userId === input.createdBy ? ParticipantRole.OWNER : ParticipantRole.MEMBER,
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

  static async createConversation(
    input: CreateConversationInput,
  ): Promise<IConversation> {
    if (input.type === ConversationType.DIRECT && input.participantIds.length === 2) {
      return this.findOrCreateDirectConversation(
        input.participantIds[0],
        input.participantIds[1],
        input.createdBy,
      );
    }
    return this.createGroupConversation(input);
  }

  static async getConversationById(
    conversationId: string,
  ): Promise<IConversation | null> {
    if (!Types.ObjectId.isValid(conversationId)) return null;
    return Conversation.findById(conversationId);
  }

  static async getConversationByEntity(
    type: ConversationType,
    relatedEntityId: string,
  ): Promise<IConversation | null> {
    return Conversation.findOne({ type, relatedEntityId, isActive: true });
  }

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
    const results = hasMore ? conversations.slice(0, clampedLimit) : conversations;
    const nextCursor = hasMore ? results[results.length - 1].updatedAt.toISOString() : null;

    return { conversations: results as unknown as IConversation[], nextCursor };
  }

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

  static async removeParticipant(
    conversationId: string,
    userId: string,
  ): Promise<IConversation | null> {
    const result = await Conversation.findByIdAndUpdate(
      conversationId,
      { $pull: { participants: { userId } } },
      { new: true },
    );

    await UnreadCount.deleteOne({
      userId,
      conversationId: new Types.ObjectId(conversationId),
    });

    return result;
  }

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

  static async updateMetadata(
    conversationId: string,
    metadata: Partial<{ name: string; avatar: string; description: string }>,
  ): Promise<IConversation | null> {
    const updates: Record<string, any> = {};
    if (metadata.name !== undefined) updates["metadata.name"] = metadata.name;
    if (metadata.avatar !== undefined) updates["metadata.avatar"] = metadata.avatar;
    if (metadata.description !== undefined) updates["metadata.description"] = metadata.description;

    return Conversation.findByIdAndUpdate(
      conversationId,
      { $set: updates },
      { new: true },
    );
  }

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

  static async setDisappearingPolicy(
    conversationId: string,
    policy: DisappearingPolicy,
  ): Promise<void> {
    await Conversation.findByIdAndUpdate(new Types.ObjectId(conversationId), {
      $set: { disappearingPolicy: policy },
    });
  }

  static async archiveConversation(
    conversationId: string,
  ): Promise<IConversation | null> {
    return Conversation.findByIdAndUpdate(
      conversationId,
      { $set: { isActive: false } },
      { new: true },
    );
  }
}
