import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RecentActivityBufferService } from '../event/recent-activity.buffer.service';
import { FriendRecommendationService } from './friend-recommendation.service';
import { FriendshipService } from './friendship.service';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';

describe('FriendshipService', () => {
  let service: FriendshipService;
  const dismissFriendRecommendation = jest.fn();

  beforeEach(async () => {
    dismissFriendRecommendation.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendshipService,
        {
          provide: SOCIAL_GRAPH_REPOSITORY,
          useValue: {
            getRelationshipStatus: jest.fn(),
            sendFriendRequest: jest.fn(),
            cancelFriendRequest: jest.fn(),
            acceptFriendRequest: jest.fn(),
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
          provide: FriendRecommendationService,
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

    const result = await service.dismissFriendRecommendation('self', 'target');

    expect(dismissFriendRecommendation).toHaveBeenCalledTimes(1);
    expect(dismissFriendRecommendation).toHaveBeenCalledWith(
      'self',
      'target',
      expect.any(Date),
    );
    expect(result.message).toBe('Friend recommendation dismissed successfully');
    expect(result.expiresAt.getTime()).toBeGreaterThan(before);
  });

  it('should reject dismissing yourself', async () => {
    await expect(
      service.dismissFriendRecommendation('self', 'self'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
