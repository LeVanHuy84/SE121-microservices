import { ConfigService } from '@nestjs/config';

export interface FriendRecommendationScoringConfig {
  mutualFriendWeight: number;
  commonGroupWeight: number;
  mutualFriendCap: number;
  commonGroupCap: number;
}

export const DEFAULT_FRIEND_RECOMMENDATION_SCORING: FriendRecommendationScoringConfig =
  {
    mutualFriendWeight: 10,
    commonGroupWeight: 6,
    mutualFriendCap: 5,
    commonGroupCap: 3,
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

export function loadFriendRecommendationScoringConfig(
  configService: ConfigService,
): FriendRecommendationScoringConfig {
  return {
    mutualFriendWeight: parsePositiveInt(
      configService.get<string>('FRIEND_RECOMMEND_MUTUAL_FRIEND_WEIGHT'),
      DEFAULT_FRIEND_RECOMMENDATION_SCORING.mutualFriendWeight,
    ),
    commonGroupWeight: parsePositiveInt(
      configService.get<string>('FRIEND_RECOMMEND_COMMON_GROUP_WEIGHT'),
      DEFAULT_FRIEND_RECOMMENDATION_SCORING.commonGroupWeight,
    ),
    mutualFriendCap: parsePositiveInt(
      configService.get<string>('FRIEND_RECOMMEND_MUTUAL_FRIEND_CAP'),
      DEFAULT_FRIEND_RECOMMENDATION_SCORING.mutualFriendCap,
    ),
    commonGroupCap: parsePositiveInt(
      configService.get<string>('FRIEND_RECOMMEND_COMMON_GROUP_CAP'),
      DEFAULT_FRIEND_RECOMMENDATION_SCORING.commonGroupCap,
    ),
  };
}
