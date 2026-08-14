import { Controller } from "@nestjs/common";
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from "@nestjs/microservices";
import { CursorPaginationDTO, GetNotificationQueryDto } from "@repo/dtos";

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
