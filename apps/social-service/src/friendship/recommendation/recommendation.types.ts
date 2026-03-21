import type { GroupRecommendationCandidate } from '../../client/group/group-client.service';
import type {
  FriendRecommendation,
  FriendRecommendationAnalyticsSource,
} from '../repositories/social-graph.repository';

export interface RecommendationCandidateBundle {
  graphHasNextPage: boolean;
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
  similarityScore: number;
  sharedInterestCount: number;
  source: FriendRecommendationAnalyticsSource;
  reasons: string[];
}

export interface FeatureScoredRecommendation extends FriendRecommendation {
  featureVector: RecommendationFeatureVector;
}
