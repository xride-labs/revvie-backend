import { Router } from "express";
import { requireAuth } from "../../config/auth.js";
import { validateBody, validateQuery, validateParams, asyncHandler } from "../../middlewares/validation.js";
import {
  requireConversationAccess,
  requireConversationAdmin,
} from "../../middlewares/chat.js";
import {
  createConversationSchema,
  conversationQuerySchema,
  updateConversationMetadataSchema,
  muteConversationSchema,
  setConversationPolicySchema,
  sendMessageSchema,
  editMessageSchema,
  messageQuerySchema,
  reactionSchema,
  conversationIdParamSchema,
  messageIdParamSchema,
  addParticipantSchema,
} from "../../validators/chat.schemas.js";
import {
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  addParticipant,
  removeParticipant,
  muteConversation,
  setConversationPolicy,
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  markAsRead,
  getUnreadCounts,
  pinMessage,
  votePoll,
  suspendParticipant,
  deleteConversation,
  listMessageRequests,
  acceptMessageRequest,
  ignoreMessageRequest,
} from "../../controllers/chat.controller.js";

const router = Router();

// All chat routes require authentication
router.use(requireAuth);

// ─── Unread Counts ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/chat/unread:
 *   get:
 *     summary: Get unread message counts
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread counts per conversation and total badge count
 */
router.get("/unread", asyncHandler(getUnreadCounts));

// ─── Message Requests ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/chat/requests:
 *   get:
 *     summary: List pending DM requests where you're the receiver
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending message requests
 */
router.get("/requests", asyncHandler(listMessageRequests));

/**
 * @swagger
 * /api/chat/conversations/{id}/accept:
 *   post:
 *     summary: Accept a pending message request
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Request accepted
 *       404:
 *         description: No pending request found
 */
router.post(
  "/conversations/:id/accept",
  validateParams(conversationIdParamSchema),
  requireConversationAccess,
  asyncHandler(acceptMessageRequest),
);

/**
 * @swagger
 * /api/chat/conversations/{id}/ignore:
 *   post:
 *     summary: Ignore a pending message request
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Request ignored
 *       404:
 *         description: No pending request found
 */
router.post(
  "/conversations/:id/ignore",
  validateParams(conversationIdParamSchema),
  requireConversationAccess,
  asyncHandler(ignoreMessageRequest),
);

// ─── Conversations ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/chat/conversations:
 *   get:
 *     summary: List user's conversations
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [direct, ride, club, marketplace]
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *     responses:
 *       200:
 *         description: Paginated list of conversations
 */
router.get(
  "/conversations",
  validateQuery(conversationQuerySchema),
  asyncHandler(listConversations),
);

/**
 * @swagger
 * /api/chat/conversations:
 *   post:
 *     summary: Create a new conversation
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, participantIds]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [direct, ride, club, marketplace]
 *               participantIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               relatedEntityId:
 *                 type: string
 *               metadata:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   avatar:
 *                     type: string
 *                   description:
 *                     type: string
 *     responses:
 *       201:
 *         description: Conversation created or existing returned
 */
router.post(
  "/conversations",
  validateBody(createConversationSchema),
  asyncHandler(createConversation),
);

/**
 * @swagger
 * /api/chat/conversations/{id}:
 *   get:
 *     summary: Get a single conversation
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Conversation details
 *       404:
 *         description: Not found or access denied
 */
router.get(
  "/conversations/:id",
  validateParams(conversationIdParamSchema),
  requireConversationAccess,
  asyncHandler(getConversation),
);

/**
 * @swagger
 * /api/chat/conversations/{id}:
 *   patch:
 *     summary: Update conversation metadata
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               avatar:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated conversation
 */
router.patch(
  "/conversations/:id",
  validateParams(conversationIdParamSchema),
  requireConversationAdmin,
  validateBody(updateConversationMetadataSchema),
  asyncHandler(updateConversation),
);

/**
 * @swagger
 * /api/chat/conversations/{id}/mute:
 *   post:
 *     summary: Mute or unmute a conversation
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mute]
 *             properties:
 *               mute:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Mute toggled
 */
router.post(
  "/conversations/:id/mute",
  validateParams(conversationIdParamSchema),
  requireConversationAccess,
  validateBody(muteConversationSchema),
  asyncHandler(muteConversation),
);

/**
 * @swagger
 * /api/chat/conversations/{id}:
 *   delete:
 *     summary: Delete a conversation from your own inbox (leaves it intact for other participants)
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Conversation deleted
 */
router.delete(
  "/conversations/:id",
  validateParams(conversationIdParamSchema),
  requireConversationAccess,
  asyncHandler(deleteConversation),
);

// ─── Disappearing-message policy ─────────────────────────────────────────────

/**
 * @swagger
 * /api/chat/conversations/{id}/policy:
 *   patch:
 *     summary: Set disappearing-message retention for a conversation
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [disappearingPolicy]
 *             properties:
 *               disappearingPolicy:
 *                 type: string
 *                 enum: [off, day_1, week_1, month_1]
 *     responses:
 *       200:
 *         description: Policy updated
 */
router.patch(
  "/conversations/:id/policy",
  validateParams(conversationIdParamSchema),
  requireConversationAccess,
  validateBody(setConversationPolicySchema),
  asyncHandler(setConversationPolicy),
);

// ─── Participants ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/chat/conversations/{id}/participants:
 *   post:
 *     summary: Add a participant to a group conversation
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [member, admin]
 *     responses:
 *       200:
 *         description: Participant added
 */
router.post(
  "/conversations/:id/participants",
  validateParams(conversationIdParamSchema),
  requireConversationAdmin,
  validateBody(addParticipantSchema),
  asyncHandler(addParticipant),
);

/**
 * @swagger
 * /api/chat/conversations/{id}/participants/{userId}:
 *   delete:
 *     summary: Remove a participant from a group conversation
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Participant removed
 */
router.delete(
  "/conversations/:id/participants/:userId",
  validateParams(conversationIdParamSchema),
  requireConversationAdmin,
  asyncHandler(removeParticipant),
);

// ─── Messages ────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/chat/conversations/{id}/messages:
 *   get:
 *     summary: Get paginated messages (cursor-based)
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Message ID cursor for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 30
 *       - in: query
 *         name: direction
 *         schema:
 *           type: string
 *           enum: [before, after]
 *           default: before
 *     responses:
 *       200:
 *         description: Paginated messages
 */
router.get(
  "/conversations/:id/messages",
  validateParams(conversationIdParamSchema),
  requireConversationAccess,
  validateQuery(messageQuerySchema),
  asyncHandler(getMessages),
);

/**
 * @swagger
 * /api/chat/conversations/{id}/messages:
 *   post:
 *     summary: Send a message (REST fallback)
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *               messageType:
 *                 type: string
 *                 enum: [text, image, voice, video, file]
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: object
 *               replyTo:
 *                 type: string
 *     responses:
 *       201:
 *         description: Message sent
 */
router.post(
  "/conversations/:id/messages",
  validateParams(conversationIdParamSchema),
  requireConversationAccess,
  validateBody(sendMessageSchema),
  asyncHandler(sendMessage),
);

/**
 * @swagger
 * /api/chat/conversations/{id}/messages/{messageId}:
 *   patch:
 *     summary: Edit a message
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message edited
 */
router.patch(
  "/conversations/:id/messages/:messageId",
  validateParams(messageIdParamSchema),
  requireConversationAccess,
  validateBody(editMessageSchema),
  asyncHandler(editMessage),
);

/**
 * @swagger
 * /api/chat/conversations/{id}/messages/{messageId}:
 *   delete:
 *     summary: Soft-delete a message
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Message deleted
 */
router.delete(
  "/conversations/:id/messages/:messageId",
  validateParams(messageIdParamSchema),
  requireConversationAccess,
  asyncHandler(deleteMessage),
);

// ─── Reactions ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/chat/conversations/{id}/messages/{messageId}/reactions:
 *   post:
 *     summary: Add a reaction to a message
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [emoji]
 *             properties:
 *               emoji:
 *                 type: string
 *     responses:
 *       200:
 *         description: Reaction added
 */
router.post(
  "/conversations/:id/messages/:messageId/reactions",
  validateParams(messageIdParamSchema),
  requireConversationAccess,
  validateBody(reactionSchema),
  asyncHandler(addReaction),
);

/**
 * @swagger
 * /api/chat/conversations/{id}/messages/{messageId}/reactions:
 *   delete:
 *     summary: Remove your reaction from a message
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Reaction removed
 */
router.delete(
  "/conversations/:id/messages/:messageId/reactions",
  validateParams(messageIdParamSchema),
  requireConversationAccess,
  asyncHandler(removeReaction),
);

// ─── Read Receipts ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/chat/conversations/{id}/read:
 *   post:
 *     summary: Mark all messages in a conversation as read
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Messages marked as read
 */
router.post(
  "/conversations/:id/read",
  validateParams(conversationIdParamSchema),
  requireConversationAccess,
  asyncHandler(markAsRead),
);

// ─── Discord Features ─────────────────────────────────────────────────────────

router.post(
  "/conversations/:id/messages/:messageId/pin",
  validateParams(messageIdParamSchema),
  requireConversationAdmin,
  asyncHandler(pinMessage),
);

router.post(
  "/conversations/:id/messages/:messageId/vote",
  validateParams(messageIdParamSchema),
  requireConversationAccess,
  asyncHandler(votePoll),
);

router.post(
  "/conversations/:id/suspend",
  validateParams(conversationIdParamSchema),
  requireConversationAdmin,
  asyncHandler(suspendParticipant),
);

export default router;
