import { AttachmentDTO } from '../message';

export enum ChatMessageEventType {
  MESSAGE_CREATED = 'chat.message.created',
  MESSAGE_DELIVERED = 'chat.message.delivered',
  MESSAGE_READ = 'chat.message.read',
}
export interface ChatMessageEventPayloads {
  [ChatMessageEventType.MESSAGE_CREATED]: {
    messageId: string;
    conversationId: string;
    senderId: string;
    content?: string;
    attachments?: any[];
    replyTo?: string;
    createdAt: Date;
  };
  [ChatMessageEventType.MESSAGE_DELIVERED]: {
    messageId: string;
    conversationId: string;
    userId: string;
    deliveredAt: Date;
  };
  [ChatMessageEventType.MESSAGE_READ]: {
    conversationId: string;
    userId: string;
    lastSeenMessageId: string;
    readAt: number;
  };
}
