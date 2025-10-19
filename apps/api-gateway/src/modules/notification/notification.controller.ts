import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PaginationDTO } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('notifications')
export class NotificationController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.NOTIFICATION_SERVICE)
    private readonly client: ClientProxy
  ) {}
  @Get()
  getNotifications(
    @CurrentUserId() userId: string,
    @Query() pagination: PaginationDTO
  ) {
    return this.client.send('get_notifications', { userId, pagination });
  }

  @Get('mark-read/:id')
  markAsRead(@Param('id') id: string) {
    return this.client.send('mark_read', id);
  }

  @Get('mark-read-all')
  markAllAsRead(@CurrentUserId() userId: string) {
    return this.client.send('mark_read_all', userId);
  }

  @Get('delete/:id')
  deleteNotification(@Param('id') id: string) {
    return this.client.send('delete_notification', id);
  }

  @Get('delete-all')
  deleteAllNotifications(@CurrentUserId() userId: string) {
    return this.client.send('delete_all_notifications', userId);
  }
}
