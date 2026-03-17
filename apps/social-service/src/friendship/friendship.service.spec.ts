import { Test, TestingModule } from '@nestjs/testing';
import { RecentActivityBufferService } from '../event/recent-activity.buffer.service';
import { FriendshipService } from './friendship.service';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';

describe('FriendshipService', () => {
  let service: FriendshipService;

  beforeEach(async () => {
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
            getFriends: jest.fn(),
            getFriendRequests: jest.fn(),
            recommendFriends: jest.fn(),
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
      ],
    }).compile();

    service = module.get<FriendshipService>(FriendshipService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
