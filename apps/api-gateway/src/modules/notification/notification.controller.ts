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
}
