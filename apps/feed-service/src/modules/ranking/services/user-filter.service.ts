import { Injectable, Logger } from '@nestjs/common';
import { RankingCandidate } from '../interfaces/ranking-strategy.interface';
import { EmotionPreference } from '../interfaces/emotion-profile.interface';

/**
 * Service filter candidates theo user preference
 * - Filter avoidedEmotions
 * - Apply hard rules
 */
@Injectable()
export class UserFilterService {
  private readonly logger = new Logger(UserFilterService.name);

  /**
   * Filter candidates theo emotion preference
   */
  filterByPreference(
    candidates: RankingCandidate[],
    preference: EmotionPreference | null,
  ): RankingCandidate[] {
    if (!preference || !preference.avoidedEmotions?.length) {
      return candidates; // no filtering needed
    }

    const filtered = candidates.filter((candidate) => {
      const emotion = candidate.snapshot.emotionFeature?.label;

      // Nếu không có emotion → allow
      if (!emotion) return true;

      // Nếu emotion trong avoided list → reject
      if (preference.avoidedEmotions.includes(emotion)) {
        this.logger.debug(
          `Filtered out post ${candidate.postId}: emotion ${emotion} is avoided`,
        );
        return false;
      }

      return true;
    });

    const filteredCount = candidates.length - filtered.length;
    if (filteredCount > 0) {
      this.logger.log(
        `Filtered ${filteredCount}/${candidates.length} posts by user preference`,
      );
    }

    return filtered;
  }

  /**
   * Boost preferred emotions (optional, có thể dùng trong ranking)
   */
  shouldBoostCandidate(
    candidate: RankingCandidate,
    preference: EmotionPreference | null,
  ): boolean {
    if (!preference || !preference.preferredEmotions?.length) return false;

    const emotion = candidate.snapshot.emotionFeature?.label;
    if (!emotion) return false;

    return preference.preferredEmotions.includes(emotion);
  }
}
