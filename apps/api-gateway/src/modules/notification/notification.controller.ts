import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { UserPreferenceSettingsDto, GetNotificationQueryDto } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

interface RegisterDeviceTokenDto {
  token: string;
  platform: 'ios' | 'android' | 'web';
  provider?: 'fcm';
  appId?: string;
  deviceId?: string;
  deviceName?: string;
}

@Controller('notifications')
export class NotificationController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.CONTENT_FEED_SERVICE)
    private readonly client: ClientProxy,
  ) {}

  @Get()
  getNotifications(
    @CurrentUserId() userId: string,
    @Query() query: GetNotificationQueryDto,
  ) {
    return this.client.send('get_notifications', { userId, query });
  }

  @Get('unread-count')
  getUnreadCount(@CurrentUserId() userId: string) {
    return this.client.send('get_unread_count', userId);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string) {
    return this.client.send('mark_read', id);
  }

  @Patch('read-all')
  markAllAsRead(@CurrentUserId() userId: string) {
    return this.client.send('mark_read_all', userId);
  }

  @Delete('delete/:id')
  deleteNotification(@Param('id') id: string) {
    return this.client.send('delete_notification', id);
  }

  @Delete()
  deleteAllNotifications(@CurrentUserId() userId: string) {
    return this.client.send('delete_all_notifications', userId);
  }

  // Preferences endpoints
  @Get('preferences')
  getUserPreferences(@CurrentUserId() userId: string) {
    return this.client.send('get_user_preference', { userId });
  }

  @Patch('preferences')
  updateUserPreferences(
    @CurrentUserId() userId: string,
    @Body('settings') settings: UserPreferenceSettingsDto,
  ) {
    return this.client.send('update_user_preference', { userId, settings });
  }

  // Device token endpoints
  @Post('device-tokens')
  registerDeviceToken(
    @CurrentUserId() userId: string,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.client.send('register_device_token', { userId, ...dto });
  }

  @Delete('device-tokens/:token')
  removeDeviceToken(
    @CurrentUserId() userId: string,
    @Param('token') token: string,
  ) {
    return this.client.send('remove_device_token', { userId, token });
  }

  @Get('device-tokens')
  getUserDeviceTokens(@CurrentUserId() userId: string) {
    return this.client.send('get_user_tokens', userId);
  }

  @Delete('device-tokens')
  removeAllDeviceTokens(@CurrentUserId() userId: string) {
    return this.client.send('remove_all_user_tokens', userId);
  }
}
