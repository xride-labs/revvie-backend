import { Types } from "mongoose";
import { Message, UnreadCount, IMessage } from "../../models/chat.model.js";

export class ReactionService {
  static async addReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<IMessage | null> {
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

  static async markAsRead(
    conversationId: string,
    userId: string,
  ): Promise<{ modifiedCount: number }> {
    const conversationOid = new Types.ObjectId(conversationId);

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

    const latestMessage = (await Message.findOne({
      conversationId: conversationOid,
    })
      .sort({ _id: -1 })
      .select("_id")
      .lean()) as unknown as { _id: Types.ObjectId } | null;

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

  static async getTotalUnreadCount(userId: string): Promise<number> {
    const result = await UnreadCount.aggregate([
      { $match: { userId, count: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: "$count" } } },
    ]);
    return result[0]?.total ?? 0;
  }
}
