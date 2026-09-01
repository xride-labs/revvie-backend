import { Types } from "mongoose";
import {
  Conversation,
  Message,
  UnreadCount,
  MessageType,
  DisappearingPolicy,
  POLICY_TTL_MS,
  DEFAULT_DISAPPEARING_POLICY,
  IConversation,
  IMessage,
  IParticipant,
} from "../../models/chat.model.js";
import { SendMessageInput, CursorPaginationOptions } from "./chat.types.js";
import { recordClubMessageActivity } from "../club/activity.service.js";

export class MessageService {
  static computeMessageExpiresAt(
    policy: DisappearingPolicy,
    retentionMaxDays: number,
  ): Date | null {
    const policyMs = POLICY_TTL_MS[policy];
    if (policyMs == null) return null;
    const capMs = Math.max(0, retentionMaxDays) * 24 * 60 * 60 * 1000;
    const ttlMs = capMs > 0 ? Math.min(policyMs, capMs) : policyMs;
    return new Date(Date.now() + ttlMs);
  }

  static async sendMessage(input: SendMessageInput): Promise<IMessage> {
    const conversationOid = new Types.ObjectId(input.conversationId);

    const convForPolicy = (await Conversation.findById(conversationOid)
      .select("disappearingPolicy retentionMaxDays")
      .lean()) as unknown as Pick<IConversation, "disappearingPolicy" | "retentionMaxDays"> | null;

    const expiresAt = this.computeMessageExpiresAt(
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

    void recordClubMessageActivity(input.conversationId, input.senderId);

    return message;
  }

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
      filter._id = direction === "before" ? { $lt: cursorOid } : { $gt: cursorOid };
    }

    const sortDir = direction === "before" ? -1 : 1;

    const messages = await Message.find(filter)
      .sort({ _id: sortDir })
      .limit(clampedLimit + 1)
      .populate("replyTo", "senderId text messageType")
      .lean();

    const hasMore = messages.length > clampedLimit;
    const results = hasMore ? messages.slice(0, clampedLimit) : messages;

    if (direction === "after") results.reverse();

    const nextCursor = hasMore
      ? (results[results.length - 1]._id as Types.ObjectId).toString()
      : null;

    return { messages: messages as unknown as IMessage[], nextCursor };
  }

  static async setPinMessage(messageId: string, isPinned: boolean): Promise<IMessage | null> {
    return Message.findByIdAndUpdate(
      messageId,
      { $set: { isPinned } },
      { new: true }
    );
  }

  static async votePoll(messageId: string, optionId: string, userId: string): Promise<IMessage | null> {
    const message = await Message.findById(messageId);
    if (!message || !message.poll) return null;

    if (!message.poll.multipleAnswers) {
      message.poll.options.forEach((opt: any) => {
        opt.votes = opt.votes.filter((v: string) => v !== userId);
      });
    }

    const option = message.poll.options.find((o: any) => o.id === optionId);
    if (option) {
      if (!option.votes.includes(userId)) {
        option.votes.push(userId);
      } else {
        option.votes = option.votes.filter((v: string) => v !== userId);
      }
    }

    message.markModified('poll');
    await message.save();
    return message;
  }

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
