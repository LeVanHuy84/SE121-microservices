import { Controller } from "@nestjs/common";
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from "@nestjs/microservices";
import {
  CursorPaginationDTO,
  GetNotificationQueryDto,
  ProactiveInterventionDto,
} from "@repo/dtos";

import { ChatPushService } from "./chat-push.service";
import { NotificationService } from "./notification.service";

@Controller("notification")
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly chatPushService: ChatPushService,
  ) {}

  @EventPattern("create_notification")
  async handleNotification(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      await this.notificationService.createAndEnqueue(
        data.createNotificationDto,
      );
      channel.ack(originalMsg);
    } catch (err) {
      console.error("Error processing notification message:", err);
      channel.nack(originalMsg, false, false);
    }
  }

  @EventPattern("proactive.intervention")
  async handleProactiveIntervention(
    @Payload() dto: ProactiveInterventionDto,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      if (dto && dto.userId) {
        let message =
          "Dành vài phút lắng lại và chăm sóc tâm trạng của bạn hôm nay.";
        if (dto.journalingPrompt) {
          message = dto.journalingPrompt;
        } else if (dto.chatbotPromptContext) {
          message = dto.chatbotPromptContext;
        } else if (dto.hotlineInfo) {
          message = `Nếu bạn cần hỗ trợ khẩn cấp, đường dây nóng ${dto.hotlineInfo.organization} (${dto.hotlineInfo.number}) luôn sẵn sàng 24/7.`;
        }

        await this.notificationService.createAndEnqueue({
          userId: dto.userId,
          type: "proactive_intervention",
          channels: [],
          payload: {
            content: message,
            userId: dto.userId,
            riskLevel: dto.riskLevel,
            riskScore: dto.riskScore,
            triggers: dto.triggers,
            suggestedAction: dto.suggestedAction,
            breathingExercise: dto.breathingExercise,
            musicSuggestions: dto.musicSuggestions,
            journalingPrompt: dto.journalingPrompt,
            chatbotPromptContext: dto.chatbotPromptContext,
            hotlineInfo: dto.hotlineInfo,
            resourceDocUrl: (dto as any).resourceDocUrl,
            timestamp: dto.timestamp ?? new Date(),
          } as any,
          meta: {
            priority: dto.riskLevel === "CRISIS" ? 1 : 2,
          },
        });
      }
      channel.ack(originalMsg);
    } catch (err) {
      console.error("Error processing proactive intervention event:", err);
      channel.nack(originalMsg, false, false);
    }
  }

  @EventPattern("send_chat_push")
  async handleSendChatPush(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      await this.chatPushService.enqueueChatPush(data.sendChatPushDto);
      channel.ack(originalMsg);
    } catch (err) {
      console.error("Error processing chat push message:", err);
      channel.nack(originalMsg, false, false);
    }
  }

  @EventPattern("send_call_push")
  async handleSendCallPush(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      await this.chatPushService.enqueueCallPush(data.sendCallPushDto);
      channel.ack(originalMsg);
    } catch (err) {
      console.error("Error processing call push message:", err);
      channel.nack(originalMsg, false, false);
    }
  }

  @EventPattern("send_call_cancel_push")
  async handleSendCallCancelPush(
    @Payload() data: any,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      await this.chatPushService.enqueueCallCancelPush(data);
      channel.ack(originalMsg);
    } catch (err) {
      console.error("Error processing call cancel push message:", err);
      channel.nack(originalMsg, false, false);
    }
  }

  @EventPattern("clear_chat_push_state")
  async handleClearChatPushState(
    @Payload() data: any,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      await this.chatPushService.clearChatPushState(data.clearChatPushStateDto);
      channel.ack(originalMsg);
    } catch (err) {
      console.error("Error clearing chat push state:", err);
      channel.nack(originalMsg, false, false);
    }
  }

  @MessagePattern("get_notifications")
  findAll(@Payload() data: { userId: string; query: GetNotificationQueryDto }) {
    return this.notificationService.findByUser(data.userId, data.query);
  }

  @MessagePattern("get_unread_count")
  getUnreadCount(@Payload() userId: string) {
    return this.notificationService.countUnread(userId);
  }

  @MessagePattern("mark_read")
  markAsRead(@Payload() id: string) {
    return this.notificationService.markRead(id);
  }

  @MessagePattern("mark_read_all")
  markAllAsRead(@Payload() userId: string) {
    return this.notificationService.markAllRead(userId);
  }

  @MessagePattern("delete_notification")
  remove(@Payload() id: string) {
    return this.notificationService.removeById(id);
  }

  @MessagePattern("delete_all_notifications")
  removeAll(@Payload() userId: string) {
    return this.notificationService.removeAll(userId);
  }
}
