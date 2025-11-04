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
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { CreateNotificationDto, PaginationDTO } from '@repo/dtos';

@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @EventPattern('create_notification')
  create(@Payload() data: { createNotificationDto: CreateNotificationDto }) {
    return this.notificationService.create(data.createNotificationDto);
  }

  @MessagePattern('get_notifications')
  findAll(@Payload() data: { userId: string; pagination: PaginationDTO }) {
    return this.notificationService.findByUser(data.userId, data.pagination);
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
    return this.notificationService.remove(id);
  }

  @MessagePattern('delete_all_notifications')
  removeAll(@Payload() userId: string) {
    return this.notificationService.removeAll(userId);
  }
}
