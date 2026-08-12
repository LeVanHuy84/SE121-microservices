import { Injectable, Logger } from '@nestjs/common';
import { UserPreferenceService } from '../../user-preference/user-preference.service';

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  dailyCount?: number;
  burstCount?: number;
  suppressed?: boolean;
}

@Injectable()
export class NotificationPolicyService {
  private readonly logger = new Logger(NotificationPolicyService.name);

  constructor(private readonly userPreferenceService: UserPreferenceService) {}

  private isDndActive(dnd: any): boolean {
    if (!dnd || !dnd.enabled) return false;
    const now = new Date();
    // Assuming server time or timezone handled here
    const currentAbs = now.getHours() * 60 + now.getMinutes();

    const parseTime = (t: string) => {
      if (!t) return 0;
      const [h, m] = t.split(':').map(Number);
      return h * 60 + (m || 0);
    };
    const from = parseTime(dnd.from);
    const to = parseTime(dnd.to);

    if (from <= to) {
      return currentAbs >= from && currentAbs <= to;
    } else {
      return currentAbs >= from || currentAbs <= to;
    }
  }

  async checkPreferencesOnly(userId: string, type: string): Promise<{ allowed: boolean, reason?: string }> {
    const prefs = await this.userPreferenceService.getUserPreferences(userId);
    
    if (prefs.settings) {
      if (this.isDndActive(prefs.settings.doNotDisturb) && type !== 'SYSTEM_ALERT') {
        return { allowed: false, reason: 'DND' };
      }

      if (type === 'chat_message') {
        if (prefs.settings.pushMessages === false) {
          return { allowed: false, reason: 'PREF_PUSH_MESSAGES' };
        }
      }

      if (type === 'group_message') {
        if (prefs.settings.pushGroupMessages === false) {
          return { allowed: false, reason: 'PREF_PUSH_GROUP_MESSAGES' };
        }
      }

      if (type === 'friend_request_received' || type === 'friend_request_accepted') {
        if (prefs.settings.pushFriendRequests === false) {
          return { allowed: false, reason: 'PREF_FRIEND_REQUESTS' };
        }
      }

      if (type.includes('mention')) {
        if (prefs.settings.pushMentions === false) {
          return { allowed: false, reason: 'PREF_MENTIONS' };
        }
      }
    }
    
    return { allowed: true };
  }

  async evaluatePolicy(userId: string, type: string): Promise<PolicyCheckResult> {
    const prefCheck = await this.checkPreferencesOnly(userId, type);
    if (!prefCheck.allowed) {
      this.logger.debug(`User ${userId} suppressed by policy for type ${type} (${prefCheck.reason})`);
      return { allowed: false, suppressed: true, reason: prefCheck.reason };
    }

    const prefs = await this.userPreferenceService.getUserPreferences(userId);

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
        reason: limitResult.reason,
        dailyCount: limitResult.dailyCount,
        burstCount: limitResult.burstCount,
      };
    }

    return { allowed: true };
  }

  async releaseSlot(userId: string, type: string) {
    const prefs = await this.userPreferenceService.getUserPreferences(userId);
    await this.userPreferenceService.releaseNotificationSlot(userId, type, prefs.limits);
  }
}
