import {
  ConversationType,
  MessageType,
  IAttachment,
  ILocation,
  IParticipant,
  IConversation,
} from "../../models/chat.model.js";

export interface HydratedParticipant extends Omit<IParticipant, "nickname"> {
  nickname?: string;
  displayName?: string;
  avatar?: string | null;
  username?: string | null;
}

export interface HydratedConversation extends Omit<IConversation, "participants"> {
  participants: HydratedParticipant[];
}

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

type BaseMessageInput = {
  conversationId: string;
  senderId: string;
  senderName: string;
  replyTo?: string;
  mentions?: string[];
};

export type SendMessageInput = BaseMessageInput & (
  | { messageType?: MessageType.TEXT; text: string; attachments?: never; location?: never; poll?: never }
  | { messageType: MessageType.IMAGE | MessageType.VIDEO | MessageType.FILE; attachments: IAttachment[]; text?: string; location?: never; poll?: never }
  | { messageType: MessageType.VOICE; attachments: IAttachment[]; text?: never; location?: never; poll?: never }
  | { messageType: MessageType.LOCATION; location: ILocation; text?: string; attachments?: never; poll?: never }
  | { messageType: MessageType.SYSTEM; text: string; attachments?: never; location?: never; poll?: never }
  | { 
      messageType: any; 
      poll: {
        question: string;
        options: { id: string; text: string; votes: string[] }[];
        multipleAnswers: boolean;
        endsAt?: Date;
      };
      text?: string;
      attachments?: never;
      location?: never;
    }
);

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
