import { ConfigService } from '@nestjs/config';

export interface FriendRecommendationScoringConfig {
  mutualFriendCap: number;
  commonGroupCap: number;
  aiWeight: number;
  aiTopK: number;
  diversityWindowSize: number;
  sharedMutualFriendPenalty: number;
  sourceRepeatPenalty: number;
}

export const DEFAULT_FRIEND_RECOMMENDATION_SCORING: FriendRecommendationScoringConfig =
  {
    mutualFriendCap: 5,
    commonGroupCap: 3,
    aiWeight: 0.5,
    aiTopK: 15,
    diversityWindowSize: 3,
    sharedMutualFriendPenalty: 4,
    sourceRepeatPenalty: 1,
  };

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveNumber(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadFriendRecommendationScoringConfig(
  configService: ConfigService,
): FriendRecommendationScoringConfig {
  return {
    mutualFriendCap: parsePositiveInt(
      configService.get<string>('FRIEND_RECOMMEND_MUTUAL_FRIEND_CAP'),
      DEFAULT_FRIEND_RECOMMENDATION_SCORING.mutualFriendCap,
    ),
    commonGroupCap: parsePositiveInt(
      configService.get<string>('FRIEND_RECOMMEND_COMMON_GROUP_CAP'),
      DEFAULT_FRIEND_RECOMMENDATION_SCORING.commonGroupCap,
    ),
    aiWeight: parsePositiveNumber(
      configService.get<string>('FRIEND_RECOMMEND_AI_WEIGHT'),
      DEFAULT_FRIEND_RECOMMENDATION_SCORING.aiWeight,
    ),
    aiTopK: parsePositiveInt(
      configService.get<string>('FRIEND_RECOMMEND_AI_TOP_K'),
      DEFAULT_FRIEND_RECOMMENDATION_SCORING.aiTopK,
    ),
    diversityWindowSize: parsePositiveInt(
      configService.get<string>('FRIEND_RECOMMEND_DIVERSITY_WINDOW_SIZE'),
      DEFAULT_FRIEND_RECOMMENDATION_SCORING.diversityWindowSize,
    ),
    sharedMutualFriendPenalty: parsePositiveInt(
      configService.get<string>('FRIEND_RECOMMEND_SHARED_MUTUAL_FRIEND_PENALTY'),
      DEFAULT_FRIEND_RECOMMENDATION_SCORING.sharedMutualFriendPenalty,
    ),
    sourceRepeatPenalty: parsePositiveInt(
      configService.get<string>('FRIEND_RECOMMEND_SOURCE_REPEAT_PENALTY'),
      DEFAULT_FRIEND_RECOMMENDATION_SCORING.sourceRepeatPenalty,
    ),
  };
}
