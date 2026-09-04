import { ConversationService } from "./chat/conversation.service.js";
import { MessageService } from "./chat/message.service.js";
import { ReactionService } from "./chat/reaction.service.js";

// Re-export types that might be needed externally
export * from "./chat/chat.types.js";

export const hydrateParticipants = ConversationService.hydrateParticipants.bind(ConversationService);
export const hydrateConversation = ConversationService.hydrateConversation.bind(ConversationService);
export const computeMessageExpiresAt = MessageService.computeMessageExpiresAt.bind(MessageService);

/**
 * Facade for the Chat domain.
 * This class delegates all operations to smaller, specialized domain services
 * (ConversationService, MessageService, ReactionService) while keeping the API
 * intact for the rest of the codebase.
 */
export class ChatService {
  // ─── Conversations ──────────────────────────────────────────────────────────

  static findOrCreateDirectConversation = ConversationService.findOrCreateDirectConversation.bind(ConversationService);
  static createGroupConversation = ConversationService.createGroupConversation.bind(ConversationService);
  static createConversation = ConversationService.createConversation.bind(ConversationService);
  static getConversationById = ConversationService.getConversationById.bind(ConversationService);
  static getConversationByEntity = ConversationService.getConversationByEntity.bind(ConversationService);
  static listConversations = ConversationService.listConversations.bind(ConversationService);
  static addParticipant = ConversationService.addParticipant.bind(ConversationService);
  static removeParticipant = ConversationService.removeParticipant.bind(ConversationService);
  static suspendParticipant = ConversationService.suspendParticipant.bind(ConversationService);
  static isParticipant = ConversationService.isParticipant.bind(ConversationService);
  static updateMetadata = ConversationService.updateMetadata.bind(ConversationService);
  static muteConversation = ConversationService.muteConversation.bind(ConversationService);
  static setDisappearingPolicy = ConversationService.setDisappearingPolicy.bind(ConversationService);
  static archiveConversation = ConversationService.archiveConversation.bind(ConversationService);
  static hideConversationForUser = ConversationService.hideForParticipant.bind(ConversationService);
  static listMessageRequests = ConversationService.listMessageRequests.bind(ConversationService);
  static respondToMessageRequest = ConversationService.respondToMessageRequest.bind(ConversationService);
  static enrichWithClubInfo = ConversationService.enrichWithClubInfo.bind(ConversationService);

  // ─── Messages ───────────────────────────────────────────────────────────────

  static sendMessage = MessageService.sendMessage.bind(MessageService);
  static getMessages = MessageService.getMessages.bind(MessageService);
  static setPinMessage = MessageService.setPinMessage.bind(MessageService);
  static votePoll = MessageService.votePoll.bind(MessageService);
  static editMessage = MessageService.editMessage.bind(MessageService);
  static deleteMessage = MessageService.deleteMessage.bind(MessageService);
  static sendSystemMessage = MessageService.sendSystemMessage.bind(MessageService);

  // ─── Reactions & Receipts ───────────────────────────────────────────────────

  static addReaction = ReactionService.addReaction.bind(ReactionService);
  static removeReaction = ReactionService.removeReaction.bind(ReactionService);
  static markAsRead = ReactionService.markAsRead.bind(ReactionService);
  static markAsDelivered = ReactionService.markAsDelivered.bind(ReactionService);
  static getUnreadCounts = ReactionService.getUnreadCounts.bind(ReactionService);
  static getTotalUnreadCount = ReactionService.getTotalUnreadCount.bind(ReactionService);
}
