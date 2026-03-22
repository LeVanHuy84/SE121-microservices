import type { GroupRecommendationCandidate } from '../../client/group/group-client.service';
import type {
  FriendRecommendation,
  FriendRecommendationAnalyticsSource,
} from '../repositories/social-graph.repository';

export interface RecommendationCandidateBundle {
  graphNextCursor: string | null;
  candidateLimit: number;
  mergedCandidates: FriendRecommendation[];
  groupCandidates: GroupRecommendationCandidate[];
  commonGroupCountsByUser: Record<string, number>;
}

export interface RecommendationFeatureVector {
  candidateId: string;
  mutualFriendsCount: number;
  mutualFriendScore: number;
  commonGroupsCount: number;
  commonGroupScore: number;
  interactionScore: number;
  groupAffinityScore: number;
  source: FriendRecommendationAnalyticsSource;
  reasons: string[];
}

export interface FeatureScoredRecommendation extends FriendRecommendation {
  featureVector: RecommendationFeatureVector;
}

export function getRecommendationSource(
  mutualFriends: number,
  commonGroups: number,
): FriendRecommendationAnalyticsSource {
  const hasMutualFriends = mutualFriends > 0;
  const hasCommonGroups = commonGroups > 0;

  if (hasMutualFriends && hasCommonGroups) {
    return 'mixed';
  }
  if (hasMutualFriends) {
    return 'mutual_only';
  }
  if (hasCommonGroups) {
    return 'group_only';
  }

  return 'fallback';
}
