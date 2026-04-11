import type { GroupRecommendationCandidate } from '../../client/group/group-client.service';
import type {
  FriendRecommendation,
  FriendRecommendationAnalyticsSource,
} from '../repositories/social-graph.repository';

export interface RecommendationCandidateBundle {
  graphNextCursor: string | null;
  candidateLimit: number;
  sourceMode: RecommendationCandidateSourceMode;
  mergedCandidates: FriendRecommendation[];
  groupCandidates: GroupRecommendationCandidate[];
  commonGroupCountsByUser: Record<string, number>;
}

export type RecommendationCandidateSourceMode =
  | 'precomputed'
  | 'online'
  | 'graph_continuation';

export interface RecommendationFeatureVector {
  candidateId: string;
  mutualFriendsCount: number;
  mutualFriendScore: number;
  commonGroupsCount: number;
  commonGroupScore: number;
  groupAffinityScore: number;
  profileAffinityScore: number;
  semanticAffinityScore: number;
  candidateSourceMode: RecommendationCandidateSourceMode;
  source: FriendRecommendationAnalyticsSource;
  reasons: string[];
}

export interface FeatureScoredRecommendation extends FriendRecommendation {
  featureVector: RecommendationFeatureVector;
}

export function getRecommendationSource(
  mutualFriends: number,
  commonGroups: number,
  profileAffinityScore = 0,
  semanticAffinityScore = 0,
): FriendRecommendationAnalyticsSource {
  const hasMutualFriends = mutualFriends > 0;
  const hasCommonGroups = commonGroups > 0;
  const hasSemanticMatch = semanticAffinityScore > 0;
  const hasProfileMatch = profileAffinityScore > 0;

  if (hasMutualFriends && hasCommonGroups) {
    return 'mixed';
  }
  if (hasMutualFriends) {
    return 'mutual_only';
  }
  if (hasCommonGroups) {
    return 'group_only';
  }
  if (hasSemanticMatch) {
    return 'semantic_only';
  }
  if (hasProfileMatch) {
    return 'profile_only';
  }

  return 'fallback';
}
