import { Injectable, Logger } from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';

@Injectable()
export class ProfileProcessor {
  private readonly logger = new Logger(ProfileProcessor.name);

  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly profileService: ProfileService,
  ) {}

  async upsertUserProfile(
    userId: string,
    referenceTime: Date = new Date(),
  ): Promise<{ success: boolean; userId: string }> {
    try {
      const profile = await this.profileRepository.getByUserId(userId);

      const windowEvents =
        await this.profileRepository.getAggregatesByUserAfter(
          userId,
          profile?.lastEventAt,
          referenceTime,
        );

      if (windowEvents.length === 0) {
        return { success: true, userId };
      }

      const updateResult = this.profileService.applyEventLevelUpdate(
        profile?.emotionVectorEMA,
        profile?.recentNegativityScore ?? 0,
        windowEvents,
        profile?.negativeEventStreak ?? 0,
        profile?.lastEventAt,
        profile?.lastStrongNegativeAt,
        profile?.emotionMomentum ?? 0,
      );

      await this.profileRepository.upsert(userId, {
        userId,
        emotionVectorEMA: updateResult.emotionVectorEMA,
        recentNegativityScore: updateResult.recentNegativityScore,
        negativeEventStreak: updateResult.negativeEventStreak,
        lastEventAt: updateResult.lastEventAt,
        lastStrongNegativeAt: updateResult.lastStrongNegativeAt,
        emotionMomentum: updateResult.emotionMomentum,
        updatedAt: referenceTime,
      });

      return { success: true, userId };
    } catch (error) {
      this.logger.error(
        `Failed to upsert profile for user=${userId}`,
        error instanceof Error ? error.stack : String(error),
      );

      return { success: false, userId };
    }
  }
}
