import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from '@nestjs/microservices';
import { CursorPaginationDTO, PaginationDTO } from '@repo/dtos';

@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @EventPattern('create_notification')
  async handleNotification(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    try {
      await this.notificationService.create(data.createNotificationDto);
      console.log('✅ Done processing — should ACK now');
      channel.ack(originalMsg); // <-- phải nằm ở đây
    } catch (err) {
      console.error('❌ Error processing message:', err);
      channel.nack(originalMsg, false, false); // bỏ hoặc requeue tùy ý
    }
  }

  @MessagePattern('get_notifications')
  findAll(@Payload() data: { userId: string; query: CursorPaginationDTO }) {
    return this.notificationService.findByUser(data.userId, data.query);
  }

  @MessagePattern('mark_read')
  markAsRead(@Payload() id: string) {
    return this.notificationService.markRead(id);
  }

  @MessagePattern('mark_read_all')
  markAllAsRead(@Payload() userId: string) {
    return this.notificationService.markAllRead(userId);
  }

  @MessagePattern('delete_notification')
  remove(@Payload() id: string) {
    return this.notificationService.removeById(id);
  }

  @MessagePattern('delete_all_notifications')
  removeAll(@Payload() userId: string) {
    return this.notificationService.removeAll(userId);
  }
}
