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

describe('Recommendation ranking report', () => {
  let controller: FriendshipController;

  const recommendFriends = jest.fn();
  const summarizeCandidates = jest.fn();
  const recordRecommendationEvents = jest.fn();
  const getCommonGroupCounts = jest.fn();
  const getCommonGroupNames = jest.fn();
  const getGroupRecommendationCandidates = jest.fn();
  const rerankCandidates = jest.fn();
  const getUsers = jest.fn();
  const getProfileRecommendationCandidates = jest.fn();
  const getSemanticRecommendationCandidates = jest.fn();
  const addRecentActivity = jest.fn();
  const clearActivity = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    getSemanticRecommendationCandidates.mockResolvedValue([]);

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
          provide: RecommendationClientService,
          useValue: {
            rerankCandidates,
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
            get: (key: string) => {
              switch (key) {
                case 'FRIEND_RECOMMEND_AI_WEIGHT':
                  return '0.5';
                case 'FRIEND_RECOMMEND_AI_TOP_K':
                  return '8';
                case 'FRIEND_RECOMMEND_PROFILE_MATCH_WEIGHT':
                  return '0.15';
                case 'FRIEND_RECOMMEND_DIVERSITY_WINDOW_SIZE':
                  return '1';
                default:
                  return undefined;
              }
            },
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

  it('should print a readable recommendation table for a larger fixture', async () => {
    const fixture = buildMultiUserRecommendationFixture();

    recommendFriends.mockResolvedValue({
      data: fixture.graphCandidates,
      nextCursor: null,
      hasNextPage: false,
    });
    getGroupRecommendationCandidates.mockResolvedValue(fixture.groupCandidates);
    summarizeCandidates.mockResolvedValue(fixture.summarizedGroupCandidates);
    getCommonGroupCounts.mockResolvedValue(fixture.commonGroupCounts);
    getCommonGroupNames.mockResolvedValue(fixture.commonGroupNames);
    rerankCandidates.mockResolvedValue(fixture.aiScores);
    getProfileRecommendationCandidates.mockResolvedValue(
      fixture.profileCandidates,
    );
    getSemanticRecommendationCandidates.mockResolvedValue(
      fixture.semanticCandidates,
    );
    getUsers.mockImplementation((ids: string[], projection: 'base' | 'full') =>
      Promise.resolve(
        projection === 'full'
          ? resolveFixtureUsers(fixture.fullUsers, ids)
          : resolveFixtureUsers(fixture.baseUsers, ids),
      ),
    );

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
              : (candidate.semanticMatchScore ?? 0) > 0
                ? 'semantic_only'
                : (candidate.profileMatchScore ?? 0) > 0
                  ? 'profile_only'
              : 'fallback',
      mutualFriends: candidate.mutualFriends,
      commonGroups: candidate.commonGroups ?? 0,
      profileScore: candidate.profileMatchScore ?? 0,
      semanticScore: candidate.semanticMatchScore ?? 0,
      sharedInterests: candidate.sharedInterestsCount ?? 0,
      profileSignals: (candidate.profileMatchedSignals ?? []).join(', '),
      baseScore: candidate.baseScore ?? 0,
      modelScore: candidate.modelScore ?? 0,
      finalScore: candidate.score ?? 0,
    }));

    console.log('\nRecommendation report fixture');
    console.table(rows);

    expect(rows.map((row) => row.candidateId)).toEqual([
      'semantic-peer',
      'community-host',
      'runner-a',
      'deep-graph',
      'runner-b',
      'group-designer',
      'mutual-docs',
      'mutual-local',
    ]);
  });
});
