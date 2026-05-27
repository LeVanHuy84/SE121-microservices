import { Injectable, Logger } from '@nestjs/common';
import { UserPreferenceService } from 'src/user-preference/user-preference.service';

export interface PolicyCheckResult {
  allowed: boolean;
  allowedChannels: string[];
  reason?: string;
  dailyCount?: number;
  burstCount?: number;
  suppressed?: boolean;
}

@Injectable()
export class NotificationPolicyService {
  private readonly logger = new Logger(NotificationPolicyService.name);

  constructor(private readonly userPreferenceService: UserPreferenceService) {}

  async evaluatePolicy(userId: string, type: string, requestedChannels?: string[]): Promise<PolicyCheckResult> {
    const prefs = await this.userPreferenceService.getUserPreferences(userId);
    const allowedChannels =
      requestedChannels && requestedChannels.length
        ? requestedChannels.filter((channel) =>
            prefs.allowedChannels.includes(channel),
          )
        : prefs.allowedChannels;

    if (!allowedChannels || allowedChannels.length === 0) {
      this.logger.warn(`User ${userId} has no allowed channels - skipping`);
      return { allowed: false, allowedChannels: [], suppressed: true };
    }

    const limitResult = await this.userPreferenceService.reserveNotificationSlot(
      userId,
      type,
      prefs.limits,
    );

    if (!limitResult.allowed) {
      this.logger.warn(
        `User ${userId} exceeded ${limitResult.reason} limit for notification type ${type}`,
      );
      return {
        allowed: false,
        allowedChannels: [],
        reason: limitResult.reason,
        dailyCount: limitResult.dailyCount,
        burstCount: limitResult.burstCount,
      };
    }

    return { allowed: true, allowedChannels };
  }

  async releaseSlot(userId: string, type: string) {
    const prefs = await this.userPreferenceService.getUserPreferences(userId);
    await this.userPreferenceService.releaseNotificationSlot(userId, type, prefs.limits);
  }
}
