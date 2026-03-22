import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RecentActivityBufferService } from '../event/recent-activity.buffer.service';
import { FriendshipService } from './friendship.service';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';
import { RecommendationQueryService } from './recommendation/recommendation-query.service';

describe('FriendshipService', () => {
  let service: FriendshipService;
  const dismissFriendRecommendation = jest.fn();
  const sendFriendRequest = jest.fn();
  const acceptFriendRequest = jest.fn();
  const getRelationshipStatus = jest.fn();
  const getFriendRecommendationAnalytics = jest.fn();
  const recordRecommendationEvents = jest.fn();
  const addRecentActivity = jest.fn();
  const clearActivity = jest.fn();

  beforeEach(async () => {
    dismissFriendRecommendation.mockReset();
    sendFriendRequest.mockReset();
    acceptFriendRequest.mockReset();
    getRelationshipStatus.mockReset();
    getFriendRecommendationAnalytics.mockReset();
    recordRecommendationEvents.mockReset();
    addRecentActivity.mockReset();
    clearActivity.mockReset();
    getRelationshipStatus.mockResolvedValue({ status: 'NONE' });
    acceptFriendRequest.mockResolvedValue(null);
    getFriendRecommendationAnalytics.mockResolvedValue({
      windowStart: '2026-03-01T00:00:00.000Z',
      windowEnd: '2026-03-18T00:00:00.000Z',
      totals: {
        served: 10,
        dismissed: 2,
        requestSent: 3,
        accepted: 1,
      },
      rates: {
        dismissFromServed: 0.2,
        requestSentFromServed: 0.3,
        acceptFromServed: 0.1,
        acceptFromRequests: 1 / 3,
      },
      sources: [],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendshipService,
        {
          provide: SOCIAL_GRAPH_REPOSITORY,
          useValue: {
            getRelationshipStatus,
            sendFriendRequest,
            cancelFriendRequest: jest.fn(),
            acceptFriendRequest,
            declineFriendRequest: jest.fn(),
            removeFriend: jest.fn(),
            blockUser: jest.fn(),
            unblockUser: jest.fn(),
            dismissFriendRecommendation,
            getFriends: jest.fn(),
            getFriendRequests: jest.fn(),
            recommendFriends: jest.fn(),
            summarizeCandidates: jest.fn(),
            getFriendIds: jest.fn(),
            getBlockedUsers: jest.fn(),
            getFriendRecommendationAnalytics,
            recordRecommendationEvents,
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
          provide: RecommendationQueryService,
          useValue: {
            recommendFriends: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FriendshipService>(FriendshipService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should dismiss friend recommendation with expiry', async () => {
    const before = Date.now();

    const result = await service.dismissFriendRecommendation('self', 'target', {
      recommendationId: 'rec-1',
      recommendationRequestId: 'req-1',
    });

    expect(dismissFriendRecommendation).toHaveBeenCalledTimes(1);
    expect(dismissFriendRecommendation).toHaveBeenCalledWith(
      'self',
      'target',
      expect.any(Date),
    );
    expect(recordRecommendationEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'self',
        candidateId: 'target',
        eventType: 'dismissed',
        recommendationId: 'rec-1',
        recommendationRequestId: 'req-1',
      }),
    ]);
    expect(result.message).toBe('Friend recommendation dismissed successfully');
    expect(result.expiresAt.getTime()).toBeGreaterThan(before);
  });

  it('should reject dismissing yourself', async () => {
    await expect(
      service.dismissFriendRecommendation('self', 'self'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should record request_sent when sending from recommendation', async () => {
    await service.sendFriendRequest('self', 'target', {
      recommendationId: 'rec-1',
      recommendationRequestId: 'req-1',
    });

    expect(sendFriendRequest).toHaveBeenCalledWith('self', 'target', {
      recommendationId: 'rec-1',
      recommendationRequestId: 'req-1',
    });
    expect(recordRecommendationEvents).toHaveBeenCalledWith([
      {
        userId: 'self',
        candidateId: 'target',
        eventType: 'request_sent',
        recommendationId: 'rec-1',
        recommendationRequestId: 'req-1',
      },
    ]);
    expect(addRecentActivity).toHaveBeenCalledWith({
      actorId: 'self',
      targetId: 'target',
      type: 'friendship_request',
    });
  });

  it('should record accepted when accepted request came from recommendation', async () => {
    getRelationshipStatus.mockResolvedValue({ status: 'REQUESTED_IN' });
    acceptFriendRequest.mockResolvedValue({
      recommendationId: 'rec-1',
      recommendationRequestId: 'req-1',
    });

    await service.acceptFriendRequest('receiver', 'requester');

    expect(recordRecommendationEvents).toHaveBeenCalledWith([
      {
        userId: 'requester',
        candidateId: 'receiver',
        eventType: 'accepted',
        recommendationId: 'rec-1',
        recommendationRequestId: 'req-1',
      },
    ]);
    expect(addRecentActivity).toHaveBeenCalledWith({
      actorId: 'receiver',
      targetId: 'requester',
      type: 'friendship_accept',
    });
  });

  it('should return recommendation analytics with normalized window days', async () => {
    const result = await service.getFriendRecommendationAnalytics('self', 999);

    expect(getFriendRecommendationAnalytics).toHaveBeenCalledTimes(1);
    expect(getFriendRecommendationAnalytics).toHaveBeenCalledWith(
      'self',
      expect.any(Date),
    );
    expect(result.windowDays).toBe(365);
    expect(result.totals.served).toBe(10);
  });
});
