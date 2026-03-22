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

type RecommendationRow = {
  rank: number;
  candidateId: string;
  profileScore: number;
  semanticScore: number;
  baseScore: number;
  modelScore: number;
  finalScore: number;
};

const liveDescribe =
  process.env.RUN_LIVE_SOCIAL_RECOMMENDATION_COMPARE === '1'
    ? describe
    : describe.skip;

liveDescribe('Recommendation live baseline vs AI comparison', () => {
  const fixture = buildMultiUserRecommendationFixture();

  const createController = async (
    useLiveRecommendationClient: boolean,
  ): Promise<FriendshipController> => {
    const recommendFriends = jest.fn().mockResolvedValue({
      data: fixture.graphCandidates,
      nextCursor: null,
      hasNextPage: false,
    });
    const summarizeCandidates = jest
      .fn()
      .mockResolvedValue(fixture.summarizedGroupCandidates);
    const recordRecommendationEvents = jest.fn();
    const getCommonGroupCounts = jest
      .fn()
      .mockResolvedValue(fixture.commonGroupCounts);
    const getCommonGroupNames = jest
      .fn()
      .mockResolvedValue(fixture.commonGroupNames);
    const getGroupRecommendationCandidates = jest
      .fn()
      .mockResolvedValue(fixture.groupCandidates);
    const getProfileRecommendationCandidates = jest
      .fn()
      .mockResolvedValue(fixture.profileCandidates);
    const getSemanticRecommendationCandidates = jest
      .fn()
      .mockResolvedValue(fixture.semanticCandidates);
    const getUsers = jest.fn().mockImplementation(
      (ids: string[], projection: 'base' | 'full') =>
        Promise.resolve(
          projection === 'full'
            ? resolveFixtureUsers(fixture.fullUsers, ids)
            : resolveFixtureUsers(fixture.baseUsers, ids),
        ),
    );
    const addRecentActivity = jest.fn().mockResolvedValue(undefined);
    const clearActivity = jest.fn().mockResolvedValue(undefined);
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
        useLiveRecommendationClient
          ? RecommendationClientService
          : {
              provide: RecommendationClientService,
              useValue: {
                rerankCandidates: jest.fn().mockResolvedValue({}),
              },
            },
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
            getSemanticRecommendationCandidates,
          },
        },
        {
          provide: RecentActivityBufferService,
          useValue: {
            addRecentActivity,
            clearActivity,
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

    return moduleRef.get(FriendshipController);
  };

  const toRows = (data: Array<any>): RecommendationRow[] =>
    data.map((candidate, index) => ({
      rank: index + 1,
      candidateId: candidate.id,
      profileScore: candidate.profileMatchScore ?? 0,
      semanticScore: candidate.semanticMatchScore ?? 0,
      baseScore: candidate.baseScore ?? 0,
      modelScore: candidate.modelScore ?? 0,
      finalScore: candidate.score ?? 0,
    }));

  it('should compare baseline-only ranking with live AI ranking on the same fixture', async () => {
    const baselineController = await createController(false);
    const liveController = await createController(true);

    const baseline = await baselineController.recommendFriends({
      userId: fixture.viewerId,
      query: { limit: fixture.expectedOrder.length },
    });
    const live = await liveController.recommendFriends({
      userId: fixture.viewerId,
      query: { limit: fixture.expectedOrder.length },
    });

    const baselineRows = toRows(baseline.data);
    const liveRows = toRows(live.data);
    const baselineRanks = new Map(
      baselineRows.map((row) => [row.candidateId, row.rank]),
    );
    const comparisonRows = liveRows.map((row) => ({
      candidateId: row.candidateId,
      baselineRank: baselineRanks.get(row.candidateId) ?? 0,
      finalRank: row.rank,
      deltaRank: (baselineRanks.get(row.candidateId) ?? 0) - row.rank,
      profileScore: row.profileScore,
      semanticScore: row.semanticScore,
      baseScore: row.baseScore,
      modelScore: row.modelScore,
      finalScore: row.finalScore,
    }));

    console.log('\nBaseline vs live AI comparison');
    console.table(comparisonRows);

    const changedCandidates = comparisonRows.filter(
      (row) => row.deltaRank !== 0,
    );
    const semanticPeer = comparisonRows.find(
      (row) => row.candidateId === 'semantic-peer',
    );
    const deepGraph = comparisonRows.find(
      (row) => row.candidateId === 'deep-graph',
    );

    expect(comparisonRows).toHaveLength(fixture.expectedOrder.length);
    expect(changedCandidates.length).toBeGreaterThan(0);
    expect(liveRows.some((row) => row.modelScore > 0)).toBe(true);
    expect(semanticPeer).toBeDefined();
    expect(deepGraph).toBeDefined();
    expect((semanticPeer?.modelScore ?? 0) > (deepGraph?.modelScore ?? 0)).toBe(
      true,
    );
  });
});
