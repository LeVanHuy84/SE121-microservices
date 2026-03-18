import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CursorPaginationDTO, CursorPageResponse } from '@repo/dtos';
import { RecentActivityBufferService } from '../event/recent-activity.buffer.service';
import { FriendRecommendationService } from './friend-recommendation.service';
import type {
  FriendRecommendation,
  SocialGraphRepository,
} from './repositories/social-graph.repository';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';

@Injectable()
export class FriendshipService {
  private readonly logger = new Logger(FriendshipService.name);
  private readonly recommendationDismissDurationMs =
    30 * 24 * 60 * 60 * 1000;

  constructor(
    @Inject(SOCIAL_GRAPH_REPOSITORY)
    private readonly socialGraphRepo: SocialGraphRepository,
    private readonly friendRecommendationService: FriendRecommendationService,
    private readonly buffer: RecentActivityBufferService,
  ) {}

  async getRelationshipStatus(userId: string, targetId: string) {
    return this.socialGraphRepo.getRelationshipStatus(userId, targetId);
  }

  async sendFriendRequest(userId: string, targetId: string) {
    if (userId === targetId) {
      throw new BadRequestException('Cannot send request to yourself');
    }

    const status = await this.getRelationshipStatus(userId, targetId);
    if (status.status === 'FRIEND') {
      throw new BadRequestException('Already friends');
    }
    if (status.status === 'REQUESTED_OUT') {
      throw new BadRequestException('Friend request already sent');
    }
    if (status.status === 'BLOCKED') {
      throw new BadRequestException('Cannot send request to a blocked user');
    }

    await this.socialGraphRepo.sendFriendRequest(userId, targetId);

    await this.buffer.addRecentActivity({
      actorId: userId,
      targetId,
      type: 'friendship_request',
    });

    return { message: 'Friend request sent successfully' };
  }

  async cancelFriendRequest(userId: string, targetId: string) {
    const status = await this.getRelationshipStatus(userId, targetId);
    if (status.status !== 'REQUESTED_OUT') {
      throw new BadRequestException('No outgoing friend request to cancel');
    }

    await this.socialGraphRepo.cancelFriendRequest(userId, targetId);
    await this.buffer.clearActivity('friendship_request', targetId, userId);

    return { message: 'Friend request canceled successfully' };
  }

  async acceptFriendRequest(userId: string, requesterId: string) {
    if (userId === requesterId) {
      throw new BadRequestException('Cannot accept your own request');
    }

    const status = await this.getRelationshipStatus(userId, requesterId);
    if (status.status !== 'REQUESTED_IN') {
      throw new BadRequestException('No pending friend request to accept');
    }

    await this.socialGraphRepo.acceptFriendRequest(userId, requesterId);

    await this.buffer.addRecentActivity({
      actorId: userId,
      targetId: requesterId,
      type: 'friendship_accept',
    });

    return { message: 'Friend request accepted' };
  }

  async declineFriendRequest(userId: string, requesterId: string) {
    if (userId === requesterId) {
      throw new BadRequestException('Cannot decline your own request');
    }

    const status = await this.getRelationshipStatus(userId, requesterId);
    if (status.status !== 'REQUESTED_IN') {
      throw new BadRequestException('No pending friend request to decline');
    }

    await this.socialGraphRepo.declineFriendRequest(userId, requesterId);

    return { message: 'Friend request declined' };
  }

  async removeFriend(userId: string, friendId: string) {
    if (userId === friendId) {
      throw new BadRequestException('Cannot remove yourself');
    }

    const status = await this.getRelationshipStatus(userId, friendId);
    if (status.status !== 'FRIEND') {
      throw new BadRequestException('Not friends');
    }

    await this.socialGraphRepo.removeFriend(userId, friendId);

    return { message: 'Friend removed successfully' };
  }

  async blockUser(userId: string, targetId: string) {
    if (userId === targetId) {
      throw new BadRequestException('Cannot block yourself');
    }

    const status = await this.getRelationshipStatus(userId, targetId);
    if (status.status === 'BLOCKED') {
      throw new BadRequestException('User already blocked');
    }

    await this.socialGraphRepo.blockUser(userId, targetId);

    return { message: 'User blocked successfully' };
  }

  async unblockUser(userId: string, targetId: string) {
    if (userId === targetId) {
      throw new BadRequestException('Cannot unblock yourself');
    }

    const status = await this.getRelationshipStatus(userId, targetId);
    if (status.status !== 'BLOCKED') {
      throw new BadRequestException('User is not blocked');
    }

    await this.socialGraphRepo.unblockUser(userId, targetId);

    return { message: 'User unblocked successfully' };
  }

  async dismissFriendRecommendation(userId: string, targetId: string) {
    if (userId === targetId) {
      throw new BadRequestException('Cannot dismiss yourself');
    }

    const expiresAt = new Date(
      Date.now() + this.recommendationDismissDurationMs,
    );

    await this.socialGraphRepo.dismissFriendRecommendation(
      userId,
      targetId,
      expiresAt,
    );

    return {
      message: 'Friend recommendation dismissed successfully',
      expiresAt,
    };
  }

  async getFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>> {
    return this.socialGraphRepo.getFriends(userId, query);
  }

  async getFriendRequests(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>> {
    this.logger.debug(
      `Getting friend requests for userId: ${userId} with query: ${JSON.stringify(query)}`,
    );
    return this.socialGraphRepo.getFriendRequests(userId, query);
  }

  async recommendFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<FriendRecommendation>> {
    this.logger.debug(
      `Recommending friends for userId: ${userId} with query: ${JSON.stringify(query)}`,
    );
    return this.friendRecommendationService.recommendFriends(userId, query);
  }

  async getFriendIds(userId: string, limit?: number) {
    return this.socialGraphRepo.getFriendIds(userId, limit);
  }

  async getBlockedUsers(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>> {
    return this.socialGraphRepo.getBlockedUsers(userId, query);
  }
}
