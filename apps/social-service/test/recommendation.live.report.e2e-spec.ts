import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FriendshipController } from '../src/friendship/friendship.controller';
import { FriendshipService } from '../src/friendship/friendship.service';
import { GroupClientService } from '../src/client/group/group-client.service';
import { RecommendationClientService } from '../src/client/recommendation/recommendation-client.service';
import { UserClientService } from '../src/client/user/user-client.service';
import { RecentActivityBufferService } from '../src/event/recent-activity.buffer.service';
import { RecommendationHydrationService } from '../src/friendship/recommendation/recommendation-hydration.service';
import { RecommendationQueryService } from '../src/friendship/recommendation/recommendation-query.service';
import { RecommendationTrackingService } from '../src/friendship/recommendation/recommendation-tracking.service';
import { SOCIAL_GRAPH_REPOSITORY } from '../src/friendship/repositories/social-graph.repository';
import { InMemoryRedis } from './recommendation-test.helpers';

const liveDescribe =
  process.env.RUN_LIVE_SOCIAL_RECOMMENDATION_REPORT === '1'
    ? describe
    : describe.skip;

liveDescribe('Recommendation live query report', () => {
  let controller: FriendshipController;

  beforeEach(async () => {
    const getUsers = jest.fn().mockResolvedValue({
      'semantic-peer': {
        id: 'semantic-peer',
        firstName: 'Minh',
        lastName: 'Le',
        avatarUrl: '',
      },
      'community-host': {
        id: 'community-host',
        firstName: 'Giang',
        lastName: 'Ngo',
        avatarUrl: '',
      },
      'runner-a': {
        id: 'runner-a',
        firstName: 'An',
        lastName: 'Pham',
        avatarUrl: '',
      },
      'deep-graph': {
        id: 'deep-graph',
        firstName: 'Hoang',
        lastName: 'Tran',
        avatarUrl: '',
      },
    });

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
    ]);

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [FriendshipController],
      providers: [
        FriendshipService,
        RecommendationHydrationService,
        RecommendationQueryService,
        RecommendationTrackingService,
        RecommendationClientService,
        {
          provide: UserClientService,
          useValue: {
            getUsers,
          },
        },
        {
          provide: RecentActivityBufferService,
          useValue: {
            addRecentActivity: jest.fn(),
            clearActivity: jest.fn(),
          },
        },
        {
          provide: SOCIAL_GRAPH_REPOSITORY,
          useValue: {
            recordRecommendationEvents: jest.fn(),
            summarizeCandidates: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: GroupClientService,
          useValue: {
            getCommonGroupCounts: jest.fn().mockResolvedValue({}),
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

  it('should print live query-only recommendation output', async () => {
    const result = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 8 },
    });

    const rows = result.data.map((candidate, index) => ({
      rank: index + 1,
      candidateId: candidate.id,
      sourceMode: candidate.candidateSourceMode,
      retrievalScore: candidate.retrievalScore ?? 0,
      modelScore: candidate.modelScore ?? 0,
      finalScore: candidate.score ?? 0,
      reasons: (candidate.reasons ?? []).join(' | '),
    }));

    console.log('\nLive query-only recommendation report');
    console.table(rows);

    expect(Array.isArray(result.data)).toBe(true);
  });
});
