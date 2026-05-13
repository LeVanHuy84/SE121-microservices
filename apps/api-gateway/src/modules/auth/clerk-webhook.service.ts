import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ClerkWebhookService {
  private readonly logger = new Logger(ClerkWebhookService.name);

  constructor(
    @Inject(MICROSERVICES_CLIENTS.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(MICROSERVICES_CLIENTS.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy
  ) {}

  /**
   * Handle user created event
   * Sync Clerk user to user-service profile store
   */
  async handleUserCreated(data: any) {
    try {
      const userId = data?.id;
      const email = this.extractPrimaryEmail(data);

      if (!userId || !email) {
        this.logger.warn('User created event missing id or email');
        return;
      }

      await firstValueFrom(
        this.userClient.send('createUser', {
          id: userId,
          email,
          firstName: data?.first_name ?? '',
          lastName: data?.last_name ?? '',
          avatarUrl: data?.image_url ?? undefined,
        })
      );

      this.logger.log(`Synced created user ${userId} to user-service`);
    } catch (error) {
      if (this.isAlreadyExistsError(error)) {
        this.logger.warn('User already exists in user-service, skip create');
        return;
      }

      this.logger.error('Error handling user created:', error);
    }
  }

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

  private extractPrimaryEmail(data: any): string | null {
    const emailAddresses = Array.isArray(data?.email_addresses)
      ? data.email_addresses
      : [];

    const primaryEmailAddressId = data?.primary_email_address_id;

    const primaryEmail = emailAddresses.find(
      (item: any) => item?.id === primaryEmailAddressId
    );

    if (typeof primaryEmail?.email_address === 'string') {
      return primaryEmail.email_address;
    }

    const fallbackEmail = emailAddresses.find(
      (item: any) => typeof item?.email_address === 'string'
    );

    return fallbackEmail?.email_address ?? null;
  }

  private isAlreadyExistsError(error: unknown): boolean {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');

    const normalized = message.toLowerCase();
    return (
      normalized.includes('duplicate') ||
      normalized.includes('already exists') ||
      normalized.includes('unique constraint') ||
      normalized.includes('23505')
    );
  }
}
