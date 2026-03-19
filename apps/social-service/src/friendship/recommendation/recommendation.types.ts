import type { GroupRecommendationCandidate } from '../../client/group/group-client.service';
import type { FriendRecommendation } from '../repositories/social-graph.repository';

export interface RecommendationCandidateBundle {
  graphHasNextPage: boolean;
  candidateLimit: number;
  mergedCandidates: FriendRecommendation[];
  groupCandidates: GroupRecommendationCandidate[];
  commonGroupCountsByUser: Record<string, number>;
}
