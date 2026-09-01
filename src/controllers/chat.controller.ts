import type { Request, Response } from "express";
import {
  ChatService,
  hydrateParticipants,
  hydrateConversation,
} from "../services/chat.service.js";
import { ConversationType, MessageType } from "../models/chat.model.js";
import { ApiResponse, ErrorCode } from "../lib/utils/apiResponse.js";
import { fanoutNewMessage } from "../lib/socket.js";
import prisma from "../lib/prisma.js";

// ─── Conversations ───────────────────────────────────────────────────────────

/**
 * GET /api/chat/conversations
 * List authenticated user's conversations.
 */
export async function listConversations(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = req.session!.user.id;
    const { type, cursor, limit } = req.query as Record<string, string>;

    const result = await ChatService.listConversations({
      userId,
      type: type as ConversationType | undefined,
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    const conversations = await hydrateParticipants(result.conversations);

    ApiResponse.success(res, {
      conversations,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    ApiResponse.internalError(
      res,
      "Failed to list conversations",
      error as Error,
    );
  }
}

/**
 * GET /api/chat/conversations/:id
 * Get a single conversation (requireConversationAccess pre-validates).
 */
export async function getConversation(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const conversation = (req as any).conversation;
    const hydrated = await hydrateConversation(conversation);
    ApiResponse.success(res, hydrated);
  } catch (error) {
    ApiResponse.internalError(
      res,
      "Failed to get conversation",
      error as Error,
    );
  }
}

/**
 * POST /api/chat/conversations
 * Create a new conversation.
 */
export async function createConversation(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = req.session!.user.id;
    const { type, participantIds, relatedEntityId, metadata } = req.body;

    const allParticipants = Array.from(new Set([userId, ...participantIds]));

    const conversation = await ChatService.createConversation({
      type,
      participantIds: allParticipants,
      relatedEntityId,
      metadata,
      createdBy: userId,
    });

    const hydrated = await hydrateConversation(conversation.toObject ? conversation.toObject() : conversation);
    ApiResponse.created(res, hydrated, "Conversation created");
  } catch (error: any) {
    if (error.message.includes("accepts direct messages")) {
      ApiResponse.error(res, error.message, 400, ErrorCode.INVALID_INPUT);
    } else {
      ApiResponse.internalError(
        res,
        "Failed to create conversation",
        error as Error,
      );
    }
  }
}

/**
 * PATCH /api/chat/conversations/:id
 * Update conversation metadata (name, avatar, description).
 */
export async function updateConversation(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { id } = req.params;
    const conversation = await ChatService.updateMetadata(id, req.body);

    if (!conversation) {
      ApiResponse.notFound(res, "Conversation not found", ErrorCode.NOT_FOUND);
      return;
    }

    ApiResponse.success(res, conversation, "Conversation updated");
  } catch (error) {
    ApiResponse.internalError(
      res,
      "Failed to update conversation",
      error as Error,
    );
  }
}

/**
 * POST /api/chat/conversations/:id/participants
 * Add a participant to a group conversation.
 */
export async function addParticipant(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { id } = req.params;
    const { userId, role } = req.body;

    const conversation = await ChatService.addParticipant(id, userId, role);
    if (!conversation) {
      ApiResponse.notFound(res, "Conversation not found", ErrorCode.NOT_FOUND);
      return;
    }

    // Send system message
    await ChatService.sendSystemMessage(id, `A new member has joined the chat`);

    ApiResponse.success(res, conversation, "Participant added");
  } catch (error) {
    ApiResponse.internalError(res, "Failed to add participant", error as Error);
  }
}

/**
 * DELETE /api/chat/conversations/:id/participants/:userId
 * Remove a participant from a group conversation.
 */
export async function removeParticipant(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { id, userId } = req.params;

    const conversation = await ChatService.removeParticipant(id, userId);
    if (!conversation) {
      ApiResponse.notFound(res, "Conversation not found", ErrorCode.NOT_FOUND);
      return;
    }

    await ChatService.sendSystemMessage(id, `A member has left the chat`);

    ApiResponse.success(res, conversation, "Participant removed");
  } catch (error) {
    ApiResponse.internalError(
      res,
      "Failed to remove participant",
      error as Error,
    );
  }
}

/**
 * PATCH /api/chat/conversations/:id/policy
 * Update the conversation's disappearing-message retention policy. Affects
 * future messages only. Existing messages keep their original expiresAt.
 */
export async function setConversationPolicy(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { id } = req.params;
    const { disappearingPolicy } = req.body as {
      disappearingPolicy: "off" | "day_1" | "week_1" | "month_1";
    };
    await ChatService.setDisappearingPolicy(
      id,
      disappearingPolicy as any,
    );
    ApiResponse.success(res, { disappearingPolicy }, "Policy updated");
  } catch (error) {
    ApiResponse.internalError(
      res,
      "Failed to update retention policy",
      error as Error,
    );
  }
}

/**
 * POST /api/chat/conversations/:id/mute
 * Mute or unmute a conversation for the current user.
 */
export async function muteConversation(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.session!.user.id;
    const { mute } = req.body;

    await ChatService.muteConversation(id, userId, mute);
    ApiResponse.success(
      res,
      null,
      mute ? "Conversation muted" : "Conversation unmuted",
    );
  } catch (error) {
    ApiResponse.internalError(
      res,
      "Failed to mute conversation",
      error as Error,
    );
  }
}

// ─── Messages ────────────────────────────────────────────────────────────────

/**
 * GET /api/chat/conversations/:id/messages
 * Retrieve paginated messages for a conversation (cursor-based).
 */
export async function getMessages(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { cursor, limit, direction } = req.query as Record<string, string>;

    const result = await ChatService.getMessages(id, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      direction: (direction as "before" | "after") ?? "before",
    });

    ApiResponse.success(res, {
      messages: result.messages,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    ApiResponse.internalError(res, "Failed to get messages", error as Error);
  }
}

/**
 * POST /api/chat/conversations/:id/messages
 * Send a message (REST fallback when WebSocket is unavailable).
 */
export async function sendMessage(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.session!.user.id;
    const userName = req.session!.user.name ?? "Unknown";
    const { text, messageType, attachments, location, replyTo } = req.body;

    const message = await ChatService.sendMessage({
      conversationId: id,
      senderId: userId,
      senderName: userName,
      text,
      messageType: (messageType as MessageType) ?? MessageType.TEXT,
      attachments,
      location,
      replyTo,
    } as import("../services/chat/chat.types.js").SendMessageInput);

    // Real-time broadcast + push so a REST-sent message reaches the
    // recipient even when the sender's socket is down (otherwise it would
    // only appear in-app on the sender's side until a manual refetch).
    await fanoutNewMessage({
      conversationId: id,
      senderId: userId,
      senderName: userName,
      message,
      text,
      messageType,
      attachments,
    }).catch((err) =>
      console.error("[chat] fanoutNewMessage failed:", err),
    );

    ApiResponse.created(res, message, "Message sent");
  } catch (error) {
    ApiResponse.internalError(res, "Failed to send message", error as Error);
  }
}

/**
 * PATCH /api/chat/conversations/:id/messages/:messageId
 * Edit a message.
 */
export async function editMessage(req: Request, res: Response): Promise<void> {
  try {
    const { messageId } = req.params;
    const userId = req.session!.user.id;
    const { text } = req.body;

    const message = await ChatService.editMessage(messageId, userId, text);
    if (!message) {
      ApiResponse.notFound(
        res,
        "Message not found or you are not the sender",
        ErrorCode.NOT_FOUND,
      );
      return;
    }

    ApiResponse.success(res, message, "Message edited");
  } catch (error) {
    ApiResponse.internalError(res, "Failed to edit message", error as Error);
  }
}

/**
 * DELETE /api/chat/conversations/:id/messages/:messageId
 * Soft-delete a message.
 */
export async function deleteMessage(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { messageId } = req.params;
    const userId = req.session!.user.id;

    const message = await ChatService.deleteMessage(messageId, userId);
    if (!message) {
      ApiResponse.notFound(
        res,
        "Message not found or you are not the sender",
        ErrorCode.NOT_FOUND,
      );
      return;
    }

    ApiResponse.success(res, null, "Message deleted");
  } catch (error) {
    ApiResponse.internalError(res, "Failed to delete message", error as Error);
  }
}

// ─── Reactions ───────────────────────────────────────────────────────────────

/**
 * POST /api/chat/conversations/:id/messages/:messageId/reactions
 */
export async function addReaction(req: Request, res: Response): Promise<void> {
  try {
    const { messageId } = req.params;
    const userId = req.session!.user.id;
    const { emoji } = req.body;

    const message = await ChatService.addReaction(messageId, userId, emoji);
    if (!message) {
      ApiResponse.notFound(res, "Message not found", ErrorCode.NOT_FOUND);
      return;
    }

    ApiResponse.success(res, message.reactions, "Reaction added");
  } catch (error) {
    ApiResponse.internalError(res, "Failed to add reaction", error as Error);
  }
}

/**
 * DELETE /api/chat/conversations/:id/messages/:messageId/reactions
 */
export async function removeReaction(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const { messageId } = req.params;
    const userId = req.session!.user.id;

    const message = await ChatService.removeReaction(messageId, userId);
    if (!message) {
      ApiResponse.notFound(res, "Message not found", ErrorCode.NOT_FOUND);
      return;
    }

    ApiResponse.success(res, message.reactions, "Reaction removed");
  } catch (error) {
    ApiResponse.internalError(res, "Failed to remove reaction", error as Error);
  }
}

// ─── Read Receipts & Unread ──────────────────────────────────────────────────

/**
 * POST /api/chat/conversations/:id/read
 * Mark all messages in a conversation as read.
 */
export async function markAsRead(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.session!.user.id;

    const result = await ChatService.markAsRead(id, userId);
    ApiResponse.success(res, result, "Messages marked as read");
  } catch (error) {
    ApiResponse.internalError(res, "Failed to mark as read", error as Error);
  }
}

/**
 * GET /api/chat/unread
 * Get unread counts for all conversations.
 */
export async function getUnreadCounts(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = req.session!.user.id;
    const counts = await ChatService.getUnreadCounts(userId);
    const total = await ChatService.getTotalUnreadCount(userId);

    ApiResponse.success(res, { counts, total });
  } catch (error) {
    ApiResponse.internalError(
      res,
      "Failed to get unread counts",
      error as Error,
    );
  }
}

// ─── Extensions ─────────────────────────────────────────────────────

export async function pinMessage(req: Request, res: Response): Promise<void> {
  try {
    const { messageId } = req.params;
    const { isPinned } = req.body;
    const message = await ChatService.setPinMessage(messageId, isPinned);
    if (!message) {
      ApiResponse.notFound(res, "Message not found", ErrorCode.NOT_FOUND);
      return;
    }
    ApiResponse.success(res, message, `Message ${isPinned ? 'pinned' : 'unpinned'}`);
  } catch (error) {
    ApiResponse.internalError(res, "Failed to pin message", error as Error);
  }
}

export async function votePoll(req: Request, res: Response): Promise<void> {
  try {
    const { messageId } = req.params;
    const { optionId } = req.body;
    const userId = req.session!.user.id;
    const message = await ChatService.votePoll(messageId, optionId, userId);
    if (!message) {
      ApiResponse.notFound(res, "Poll not found", ErrorCode.NOT_FOUND);
      return;
    }
    ApiResponse.success(res, message, "Vote cast successfully");
  } catch (error) {
    ApiResponse.internalError(res, "Failed to vote on poll", error as Error);
  }
}

export async function suspendParticipant(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { userId, suspendedUntil } = req.body;
    await ChatService.suspendParticipant(id, userId, new Date(suspendedUntil));
    ApiResponse.success(res, null, "Participant suspended");
  } catch (error) {
    ApiResponse.internalError(res, "Failed to suspend participant", error as Error);
  }
}
