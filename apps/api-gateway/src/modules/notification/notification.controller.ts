import { Controller, Delete, Get, Inject, Param, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CursorPaginationDTO, PaginationDTO } from '@repo/dtos';
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
    @Query() query: CursorPaginationDTO
  ) {
    return this.client.send('get_notifications', { userId, query });
  }

  @Delete('delete/:id')
  deleteNotification(@Param('id') id: string) {
    return this.client.send('delete_notification', id);
  }

  @Delete()
  deleteAllNotifications(@CurrentUserId() userId: string) {
    return this.client.send('delete_all_notifications', userId);
  }
}
