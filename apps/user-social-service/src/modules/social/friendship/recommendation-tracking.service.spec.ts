import type { SocialGraphRepository } from './repositories/social-graph.repository';
import { RecommendationTrackingService } from './recommendation/recommendation-tracking.service';

describe('RecommendationTrackingService', () => {
  const recordRecommendationEvents = jest.fn();

  beforeEach(() => {
    recordRecommendationEvents.mockReset();
  });

  it('should record served metadata with new source modes only', async () => {
    const service = new RecommendationTrackingService({
      recordRecommendationEvents,
    } as unknown as SocialGraphRepository);

    await service.recordServedEvents(
      'viewer-1',
      [
        {
          id: 'candidate-1',
          mutualFriends: 2,
          mutualFriendIds: ['mutual-1', 'mutual-2'],
          commonGroups: 1,
          candidateSourceMode: 'hybrid',
          retrievalScore: 0.62,
          retrievalScoreVersion: 'recommendation-query-pipeline-v1',
          modelScore: 0.74,
          score: 0.81,
          reasons: ['Social graph boosted'],
          recommendationId: 'rec-1',
          recommendationRequestId: 'req-1',
        },
      ],
      3,
    );

    expect(recordRecommendationEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'viewer-1',
        candidateId: 'candidate-1',
        eventType: 'served',
        recommendationId: 'rec-1',
        recommendationRequestId: 'req-1',
        metadata: {
          mutualFriends: 2,
          commonGroups: 1,
          candidateSourceMode: 'hybrid',
          retrievalScore: 0.62,
          retrievalScoreVersion: 'recommendation-query-pipeline-v1',
          modelScore: 0.74,
          score: 0.81,
          source: 'hybrid',
          reasons: ['Social graph boosted'],
          position: 3,
        },
      }),
    ]);

    const [[events]] = recordRecommendationEvents.mock.calls;
    expect(events[0].metadata).not.toHaveProperty('precomputeScore');
    expect(events[0].metadata).not.toHaveProperty('rerankScore');
    expect(events[0].metadata).not.toHaveProperty('baseScore');
    expect(events[0].metadata).not.toHaveProperty('profileAffinityScore');
    expect(events[0].metadata).not.toHaveProperty('semanticAffinityScore');
  });
});
