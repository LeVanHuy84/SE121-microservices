import { Injectable, Logger } from '@nestjs/common';
import { NotificationService } from '@repo/common';
import { SendCallPushDto } from '@repo/dtos';
import { UserClientService } from 'src/client/user/user-client.service';
import { ConversationActivityService } from 'src/presence/conversation-activity.service';

type SendMessagePushParams = {
  senderId: string;
  conversationId: string;
  conversationName?: string;
  isGroup: boolean;
  receiverIds: string[];
  messageId: string;
  preview?: string;
};

type SendCallPushParams = Omit<SendCallPushDto, 'userId'> & {
  receiverIds: string[];
};

type SendCallCancelPushParams = {
  callId: string;
  conversationId: string;
  actorId: string;
  receiverIds: string[];
};

@Injectable()
export class ChatPushService {
  private readonly logger = new Logger(ChatPushService.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly conversationActivityService: ConversationActivityService,
    private readonly userClientService: UserClientService,
  ) {}

  async sendMessagePush(params: SendMessagePushParams) {
    try {
      const receiverIds =
        await this.conversationActivityService.filterReceiversOutsideConversation(
          params.receiverIds,
          params.conversationId,
        );

      if (!receiverIds.length) {
        return;
      }

      const sender = await this.userClientService.getUserInfo(params.senderId);
      const senderName = this.resolveSenderName(params.senderId, sender);

      await Promise.all(
        receiverIds.map((userId) =>
          this.notificationService.sendChatPush({
            userId,
            conversationId: params.conversationId,
            isGroup: params.isGroup,
            senderId: params.senderId,
            senderName,
            senderAvatar: sender?.avatarUrl,
            conversationName: params.conversationName,
            preview: params.preview,
            messageId: params.messageId,
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to dispatch chat push for conversationId=${params.conversationId}: ${error.message}`,
        error.stack,
      );
    }
  }

  async sendCallPush(params: SendCallPushParams) {
    try {
      const receiverIds =
        await this.conversationActivityService.filterReceiversOutsideConversation(
          params.receiverIds,
          params.conversationId,
        );

      if (!receiverIds.length) {
        return;
      }

      await Promise.all(
        receiverIds.map((userId) =>
          this.notificationService.sendCallPush({
            ...params,
            userId,
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to dispatch call push for conversationId=${params.conversationId}: ${error.message}`,
        error.stack,
      );
    }
  }

  async sendCallCancelPush(params: SendCallCancelPushParams) {
    try {
      const receiverIds =
        await this.conversationActivityService.filterReceiversOutsideConversation(
          params.receiverIds,
          params.conversationId,
        );

      if (!receiverIds.length) {
        return;
      }

      await Promise.all(
        receiverIds.map((userId) =>
          this.notificationService.sendCallCancelPush({
            callId: params.callId,
            conversationId: params.conversationId,
            actorId: params.actorId,
            userId,
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to dispatch call push for conversationId=${params.conversationId}: ${error.message}`,
        error.stack,
      );
    }
  }

  async clearConversationState(userId: string, conversationId: string) {
    try {
      await this.notificationService.clearChatPushState({
        userId,
        conversationId,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to clear chat push state for userId=${userId}, conversationId=${conversationId}: ${error.message}`,
      );
    }
  }

  private resolveSenderName(
    senderId: string,
    sender: { firstName?: string; lastName?: string } | null,
  ) {
    const fullName = [sender?.firstName, sender?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    return fullName || senderId;
  }
}
