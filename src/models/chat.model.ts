import mongoose, { Schema, Document, Types } from "mongoose";

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum ConversationType {
  DIRECT = "direct",
  RIDE = "ride",
  CLUB = "club",
  MARKETPLACE = "marketplace",
  GROUP = "group",
  CHANNEL_TEXT = "channel_text",
  CHANNEL_VOICE = "channel_voice",
}

/**
 * How long messages live in a conversation before being auto-deleted.
 * Server enforces via a Mongo TTL index on `expiresAt` (cron-free cleanup).
 * Mobile clients additionally filter expired messages from in-memory state
 * so a stale cache doesn't render content that's already gone server-side.
 */
export enum DisappearingPolicy {
  OFF = "off",
  DAY_1 = "day_1",     // 24h — default for new conversations
  WEEK_1 = "week_1",
  MONTH_1 = "month_1", // 30d — maximum retention per Phase 5 spec
}

export const POLICY_TTL_MS: Record<DisappearingPolicy, number | null> = {
  [DisappearingPolicy.OFF]: null,
  [DisappearingPolicy.DAY_1]: 24 * 60 * 60 * 1000,
  [DisappearingPolicy.WEEK_1]: 7 * 24 * 60 * 60 * 1000,
  [DisappearingPolicy.MONTH_1]: 30 * 24 * 60 * 60 * 1000,
};

export const DEFAULT_DISAPPEARING_POLICY = DisappearingPolicy.DAY_1;

export enum MessageType {
  TEXT = "text",
  IMAGE = "image",
  VOICE = "voice",
  VIDEO = "video",
  FILE = "file",
  SYSTEM = "system",
  LOCATION = "location",
}

export enum AttachmentType {
  IMAGE = "image",
  VIDEO = "video",
  AUDIO = "audio",
  FILE = "file",
  SYSTEM = "system",
}

export enum ParticipantRole {
  MEMBER = "member",
  ADMIN = "admin",
  OWNER = "owner",
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface IParticipant {
  userId: string;
  role: ParticipantRole;
  joinedAt: Date;
  nickname?: string;
  isMuted: boolean;
  suspendedUntil?: Date;
}

export interface ILastMessage {
  text: string;
  senderId: string;
  senderName: string;
  sentAt: Date;
  messageType: MessageType;
}

export interface IConversationMetadata {
  name?: string;
  avatar?: string;
  description?: string;
}

export interface IConversation extends Document {
  _id: Types.ObjectId;
  type: ConversationType;
  participants: IParticipant[];
  relatedEntityId?: string;
  parentConversationId?: Types.ObjectId;
  metadata: IConversationMetadata;
  lastMessage?: ILastMessage;
  isActive: boolean;
  createdBy: string;
  // Phase 5 retention — controls how long messages in this conversation live.
  // `disappearingPolicy` is user-controlled; `retentionMaxDays` is a hard cap
  // (default 30) that the server clamps the policy to.
  disappearingPolicy: DisappearingPolicy;
  retentionMaxDays: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAttachment {
  url: string;
  publicId?: string;
  type: AttachmentType;
  filename?: string;
  size?: number;
  duration?: number; // seconds – for voice/video
  thumbnailUrl?: string;
}

export interface ILocation {
  latitude: number;
  longitude: number;
  label?: string; // e.g. "Current location" / a place name
  address?: string;
}

export interface IReaction {
  userId: string;
  emoji: string;
  createdAt: Date;
}

export interface IReadReceipt {
  userId: string;
  readAt: Date;
}

export interface IDeliveryReceipt {
  userId: string;
  deliveredAt: Date;
}

export interface IPollOption {
  id: string;
  text: string;
  votes: string[]; // array of userIds
}

export interface IPoll {
  question: string;
  options: IPollOption[];
  multipleAnswers: boolean;
  endsAt?: Date;
}

export interface IMessage extends Document {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderId: string;
  text?: string;
  messageType: MessageType;
  attachments: IAttachment[];
  location?: ILocation | null;
  replyTo?: Types.ObjectId;
  reactions: IReaction[];
  readBy: IReadReceipt[];
  deliveredTo: IDeliveryReceipt[];
  mentions: string[];
  isPinned: boolean;
  poll?: IPoll;
  editedAt?: Date;
  deletedAt?: Date;
  // Phase 5 retention — when set, Mongo's TTL index drops the document at
  // (expiresAt + 60s ± monitor jitter). Null/undefined means "keep forever"
  // (only possible when the conversation policy is OFF).
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUnreadCount extends Document {
  _id: Types.ObjectId;
  userId: string;
  conversationId: Types.ObjectId;
  count: number;
  lastReadMessageId?: Types.ObjectId;
  lastReadAt?: Date;
  updatedAt: Date;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ParticipantSchema = new Schema<IParticipant>(
  {
    userId: { type: String, required: true },
    role: {
      type: String,
      enum: Object.values(ParticipantRole),
      default: ParticipantRole.MEMBER,
    },
    joinedAt: { type: Date, default: Date.now },
    nickname: { type: String },
    isMuted: { type: Boolean, default: false },
    suspendedUntil: { type: Date, default: null },
  },
  { _id: false },
);

const LastMessageSchema = new Schema<ILastMessage>(
  {
    text: { type: String, required: true },
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    sentAt: { type: Date, required: true },
    messageType: {
      type: String,
      enum: Object.values(MessageType),
      default: MessageType.TEXT,
    },
  },
  { _id: false },
);

const ConversationMetadataSchema = new Schema<IConversationMetadata>(
  {
    name: { type: String },
    avatar: { type: String },
    description: { type: String },
  },
  { _id: false },
);

const ConversationSchema = new Schema<IConversation>(
  {
    type: {
      type: String,
      enum: Object.values(ConversationType),
      required: true,
    },
    participants: {
      type: [ParticipantSchema],
      required: true,
      validate: {
        validator: (v: IParticipant[]) => v.length >= 2 || true, // system can create empty
        message: "A conversation requires at least 2 participants",
      },
    },
    relatedEntityId: { type: String, default: null },
    parentConversationId: { type: Schema.Types.ObjectId, ref: "Conversation", default: null },
    metadata: { type: ConversationMetadataSchema, default: {} },
    lastMessage: { type: LastMessageSchema, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: String, required: true },
    disappearingPolicy: {
      type: String,
      enum: Object.values(DisappearingPolicy),
      default: DEFAULT_DISAPPEARING_POLICY,
    },
    retentionMaxDays: { type: Number, default: 30 },
  },
  {
    timestamps: true,
    collection: "conversations",
  },
);

// ─── Conversation Indexes ────────────────────────────────────────────────────

// Fast lookup: all conversations for a user, sorted by latest activity
ConversationSchema.index(
  { "participants.userId": 1, updatedAt: -1 },
  { name: "idx_participants_updatedAt" },
);

// Prevent duplicate direct conversations between the same pair
ConversationSchema.index(
  { type: 1, "participants.userId": 1 },
  { name: "idx_type_participants" },
);

// Find conversation tied to an entity (ride, club, listing)
ConversationSchema.index(
  { relatedEntityId: 1, type: 1 },
  {
    name: "idx_relatedEntity_type",
    sparse: true,
  },
);

// Active conversations only
ConversationSchema.index({ isActive: 1 }, { name: "idx_active" });

// ─── Attachment Sub-document ─────────────────────────────────────────────────

const AttachmentSchema = new Schema<IAttachment>(
  {
    url: { type: String, required: true },
    publicId: { type: String },
    type: {
      type: String,
      enum: Object.values(AttachmentType),
      required: true,
    },
    filename: { type: String },
    size: { type: Number },
    duration: { type: Number },
    thumbnailUrl: { type: String },
  },
  { _id: false },
);

const LocationSchema = new Schema<ILocation>(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    label: { type: String },
    address: { type: String },
  },
  { _id: false },
);

const ReactionSchema = new Schema<IReaction>(
  {
    userId: { type: String, required: true },
    emoji: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const ReadReceiptSchema = new Schema<IReadReceipt>(
  {
    userId: { type: String, required: true },
    readAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const DeliveryReceiptSchema = new Schema<IDeliveryReceipt>(
  {
    userId: { type: String, required: true },
    deliveredAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const PollOptionSchema = new Schema<IPollOption>(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    votes: { type: [String], default: [] }, // array of userIds
  },
  { _id: false }
);

const PollSchema = new Schema<IPoll>(
  {
    question: { type: String, required: true },
    options: { type: [PollOptionSchema], required: true },
    multipleAnswers: { type: Boolean, default: false },
    endsAt: { type: Date, default: null },
  },
  { _id: false }
);

const MessageSchema = new Schema<IMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    senderId: { type: String, required: true },
    text: { type: String, default: null },
    messageType: {
      type: String,
      enum: Object.values(MessageType),
      default: MessageType.TEXT,
    },
    attachments: { type: [AttachmentSchema], default: [] },
    location: { type: LocationSchema, default: null },
    replyTo: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    reactions: { type: [ReactionSchema], default: [] },
    readBy: { type: [ReadReceiptSchema], default: [] },
    deliveredTo: { type: [DeliveryReceiptSchema], default: [] },
    mentions: { type: [String], default: [] },
    isPinned: { type: Boolean, default: false },
    poll: { type: PollSchema, default: null },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "messages",
  },
);

// Mongo TTL index — automatically deletes messages whose `expiresAt` has
// passed. Mongo runs the monitor every ~60s, so deletion can lag by up to
// a minute. `expireAfterSeconds: 0` means "expire exactly at the timestamp
// stored in the field". Null values are skipped (kept forever).
MessageSchema.index(
  { expiresAt: 1 },
  { name: "idx_message_ttl", expireAfterSeconds: 0 },
);

// ─── Message Indexes ─────────────────────────────────────────────────────────

// Primary query: messages in a conversation, newest first (cursor pagination)
MessageSchema.index(
  { conversationId: 1, createdAt: -1 },
  { name: "idx_conversation_createdAt" },
);

// Fetch messages since a cursor (_id-based pagination)
MessageSchema.index(
  { conversationId: 1, _id: -1 },
  { name: "idx_conversation_id_desc" },
);

// Lookup messages by sender
MessageSchema.index(
  { senderId: 1, createdAt: -1 },
  { name: "idx_sender_createdAt" },
);

// Unread message lookup optimisation
MessageSchema.index(
  { conversationId: 1, "readBy.userId": 1 },
  { name: "idx_conversation_readBy" },
);

// ─── Unread Count Schema ─────────────────────────────────────────────────────

const UnreadCountSchema = new Schema<IUnreadCount>(
  {
    userId: { type: String, required: true },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    count: { type: Number, default: 0 },
    lastReadMessageId: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    lastReadAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: "unread_counts",
  },
);

// One row per user-conversation pair
UnreadCountSchema.index(
  { userId: 1, conversationId: 1 },
  { unique: true, name: "idx_user_conversation_unique" },
);

// Total badge count for a user
UnreadCountSchema.index(
  { userId: 1, count: 1 },
  { name: "idx_user_unreadCount" },
);

// ─── Models ──────────────────────────────────────────────────────────────────

export const Conversation =
  mongoose.models.Conversation ||
  mongoose.model<IConversation>("Conversation", ConversationSchema);

export const Message =
  mongoose.models.Message || mongoose.model<IMessage>("Message", MessageSchema);

export const UnreadCount =
  mongoose.models.UnreadCount ||
  mongoose.model<IUnreadCount>("UnreadCount", UnreadCountSchema);
