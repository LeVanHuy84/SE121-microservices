import { Injectable, Logger } from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';

import { TimeDecayCalculator } from '../analytics/time-decay.calculator';

@Injectable()
export class ProfileProcessor {
  private readonly logger = new Logger(ProfileProcessor.name);

  constructor(
    private readonly profileRepository: ProfileRepository,
    private readonly profileService: ProfileService,
    private readonly timeDecayCalculator: TimeDecayCalculator,
  ) {}

  async processDailyDecaySweep(): Promise<{ processedCount: number }> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const inactiveProfiles =
      await this.profileRepository.findInactiveProfiles(cutoff);

    let processedCount = 0;
    const now = new Date();

    for (const profile of inactiveProfiles) {
      try {
        const lastTime = profile.lastEventAt || profile.updatedAt || cutoff;
        const elapsedHours =
          (now.getTime() - new Date(lastTime).getTime()) / (1000 * 60 * 60);

        const currentScore =
          profile.recentNegativityScore ??
          (profile as any).decayedNegativityScore ??
          0;

        const newDecayedScore = this.timeDecayCalculator.calculateDecayedScore(
          currentScore,
          elapsedHours,
        );

        await this.profileRepository.upsert(profile.userId, {
          userId: profile.userId,
          recentNegativityScore: newDecayedScore,
          consecutiveNegativeDays: Math.max(
            0,
            (profile.consecutiveNegativeDays ?? 0) - 1,
          ),
          updatedAt: now,
        });

        processedCount++;
      } catch (err) {
        this.logger.error(`Failed decay sweep for user=${profile.userId}`, err);
      }
    }

    return { processedCount };
  }

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

      const previousNegativity =
        profile?.recentNegativityScore ??
        (profile as any)?.decayedNegativityScore ??
        0;

      const updateResult = this.profileService.applyEventLevelUpdate(
        profile?.emotionVectorEMA,
        previousNegativity,
        windowEvents,
        profile?.consecutiveNegativeDays ?? 0,
        profile?.lastEventAt,
        profile?.lastStrongNegativeAt,
        profile?.emotionMomentum ?? 0,
      );

      await this.profileRepository.upsert(userId, {
        userId,
        emotionVectorEMA: updateResult.emotionVectorEMA,
        recentNegativityScore: updateResult.recentNegativityScore,
        consecutiveNegativeDays: updateResult.negativeEventStreak,
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
