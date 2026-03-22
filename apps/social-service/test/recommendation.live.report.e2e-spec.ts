import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FriendshipController } from '../src/friendship/friendship.controller';
import { FriendshipService } from '../src/friendship/friendship.service';
import { GroupClientService } from '../src/client/group/group-client.service';
import { RecommendationClientService } from '../src/client/recommendation/recommendation-client.service';
import { UserClientService } from '../src/client/user/user-client.service';
import { RecentActivityBufferService } from '../src/event/recent-activity.buffer.service';
import { CandidateSourceService } from '../src/friendship/recommendation/candidate-source.service';
import { RecommendationBaselineRankerService } from '../src/friendship/recommendation/recommendation-baseline-ranker.service';
import { RecommendationDiversityService } from '../src/friendship/recommendation/recommendation-diversity.service';
import { RecommendationFeatureService } from '../src/friendship/recommendation/recommendation-feature.service';
import { RecommendationHydrationService } from '../src/friendship/recommendation/recommendation-hydration.service';
import { RecommendationQueryService } from '../src/friendship/recommendation/recommendation-query.service';
import { RecommendationSnapshotService } from '../src/friendship/recommendation/recommendation-snapshot.service';
import { RecommendationTrackingService } from '../src/friendship/recommendation/recommendation-tracking.service';
import { SOCIAL_GRAPH_REPOSITORY } from '../src/friendship/repositories/social-graph.repository';
import {
  buildMultiUserRecommendationFixture,
  InMemoryRedis,
  resolveFixtureUsers,
} from './recommendation-test.helpers';



describe('Recommendation live ranking report', () => {
  let controller: FriendshipController;

  const recommendFriends = jest.fn();
  const summarizeCandidates = jest.fn();
  const recordRecommendationEvents = jest.fn();
  const getCommonGroupCounts = jest.fn();
  const getCommonGroupNames = jest.fn();
  const getGroupRecommendationCandidates = jest.fn();
  const getUsers = jest.fn();
  const getProfileRecommendationCandidates = jest.fn();
  const getRecentInteractionScores = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();

    const fixture = buildMultiUserRecommendationFixture();

    recommendFriends.mockResolvedValue({
      data: fixture.graphCandidates,
      nextCursor: null,
      hasNextPage: false,
    });
    summarizeCandidates.mockResolvedValue(fixture.summarizedGroupCandidates);
    getCommonGroupCounts.mockResolvedValue(fixture.commonGroupCounts);
    getCommonGroupNames.mockResolvedValue(fixture.commonGroupNames);
    getGroupRecommendationCandidates.mockResolvedValue(fixture.groupCandidates);
    getProfileRecommendationCandidates.mockResolvedValue(
      fixture.profileCandidates,
    );
    getRecentInteractionScores.mockResolvedValue(fixture.interactionScores);
    getUsers.mockImplementation((ids: string[], projection: 'base' | 'full') =>
      Promise.resolve(
        projection === 'full'
          ? resolveFixtureUsers(fixture.fullUsers, ids)
          : resolveFixtureUsers(fixture.baseUsers, ids),
      ),
    );

    const configValues = new Map<string, string | number | undefined>([
      [
        'RECOMMENDATION_SERVICE_URL',
        process.env.RECOMMENDATION_SERVICE_URL ?? 'http://127.0.0.1:4011',
      ],
      [
        'RECOMMENDATION_INTERNAL_KEY',
        process.env.INTERNAL_SERVICE_KEY ?? 'recommendation-internal-key-123',
      ],
      ['RECOMMENDATION_SERVICE_TIMEOUT_MS', 30000],
      ['FRIEND_RECOMMEND_AI_WEIGHT', '0.5'],
      ['FRIEND_RECOMMEND_AI_TOP_K', '8'],
      ['FRIEND_RECOMMEND_PROFILE_MATCH_WEIGHT', '0.15'],
      ['FRIEND_RECOMMEND_DIVERSITY_WINDOW_SIZE', '1'],
    ]);

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [FriendshipController],
      providers: [
        FriendshipService,
        CandidateSourceService,
        RecommendationBaselineRankerService,
        RecommendationDiversityService,
        RecommendationFeatureService,
        RecommendationHydrationService,
        RecommendationQueryService,
        RecommendationSnapshotService,
        RecommendationTrackingService,
        RecommendationClientService,
        {
          provide: SOCIAL_GRAPH_REPOSITORY,
          useValue: {
            recommendFriends,
            summarizeCandidates,
            recordRecommendationEvents,
          },
        },
        {
          provide: GroupClientService,
          useValue: {
            getCommonGroupCounts,
            getCommonGroupNames,
            getGroupRecommendationCandidates,
          },
        },
        {
          provide: UserClientService,
          useValue: {
            getUsers,
            getProfileRecommendationCandidates,
          },
        },
        {
          provide: RecentActivityBufferService,
          useValue: {
            getRecentInteractionScores,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: unknown) =>
              configValues.get(key) ?? defaultValue,
          },
        },
        {
          provide: getRedisConnectionToken(),
          useValue: new InMemoryRedis(),
        },
      ],
    }).compile();

    controller = moduleRef.get(FriendshipController);
  });

  it('should print a live recommendation table with real AI scores', async () => {
    const fixture = buildMultiUserRecommendationFixture();

    const result = await controller.recommendFriends({
      userId: fixture.viewerId,
      query: { limit: fixture.expectedOrder.length },
    });

    const baseRanks = new Map(
      [...result.data]
        .sort((left, right) => (right.baseScore ?? 0) - (left.baseScore ?? 0))
        .map((candidate, index) => [candidate.id, index + 1]),
    );
    const aiRanks = new Map(
      [...result.data]
        .sort((left, right) => (right.modelScore ?? 0) - (left.modelScore ?? 0))
        .map((candidate, index) => [candidate.id, index + 1]),
    );
    const rows = result.data.map((candidate, index) => ({
      rank: index + 1,
      candidateId: candidate.id,
      baseRank: baseRanks.get(candidate.id) ?? 0,
      aiRank: aiRanks.get(candidate.id) ?? 0,
      source:
        candidate.commonGroups && candidate.mutualFriends
          ? 'mixed'
          : candidate.commonGroups
            ? 'group_only'
            : candidate.mutualFriends
              ? 'mutual_only'
              : 'fallback',
      mutualFriends: candidate.mutualFriends,
      commonGroups: candidate.commonGroups ?? 0,
      profileScore: candidate.profileMatchScore ?? 0,
      sharedInterests: candidate.sharedInterestsCount ?? 0,
      profileSignals: (candidate.profileMatchedSignals ?? []).join(', '),
      baseScore: candidate.baseScore ?? 0,
      modelScore: candidate.modelScore ?? 0,
      finalScore: candidate.score ?? 0,
      reasons: candidate.reasons.join(' | '),
    }));

    console.log('\nLive recommendation report fixture');
    console.table(rows);

    expect(result.data).toHaveLength(fixture.expectedOrder.length);
    expect(rows[0].modelScore).toBeGreaterThanOrEqual(0);
    expect(rows.some((row) => row.candidateId === 'semantic-peer')).toBe(true);
    expect(recordRecommendationEvents).toHaveBeenCalled();
  });
});
