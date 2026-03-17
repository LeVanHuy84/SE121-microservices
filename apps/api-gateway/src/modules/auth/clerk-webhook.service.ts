import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ClerkWebhookService {
  private readonly logger = new Logger(ClerkWebhookService.name);

  constructor(
    @Inject(MICROSERVICES_CLIENTS.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy
  ) {}

  /**
   * Handle session ended event
   * Clean up device tokens when user's session ends
   */
  async handleSessionEnded(data: any) {
    try {
      const userId = data?.user_id;
      if (!userId) {
        this.logger.warn('Session ended event missing user_id');
        return;
      }

      // Note: This will remove ALL device tokens for the user
      // If you want to keep tokens across sessions, skip this
      // const result = await firstValueFrom(
      //   this.notificationClient.send('remove_all_user_tokens', userId)
      // );

      this.logger.log(`Session ended for user ${userId}`);
      // Optionally clean up device tokens here
    } catch (error) {
      this.logger.error('Error handling session ended:', error);
    }
  }

  /**
   * Handle user deleted event
   * Clean up all data when user account is deleted
   */
  async handleUserDeleted(data: any) {
    try {
      const userId = data?.id;
      if (!userId) {
        this.logger.warn('User deleted event missing id');
        return;
      }

      // Remove all device tokens
      await firstValueFrom(
        this.notificationClient.send('remove_all_user_tokens', userId)
      );

      // Remove all notifications
      await firstValueFrom(
        this.notificationClient.send('delete_all_notifications', userId)
      );

      this.logger.log(`Cleaned up data for deleted user ${userId}`);
    } catch (error) {
      this.logger.error('Error handling user deleted:', error);
    }
  }
}
