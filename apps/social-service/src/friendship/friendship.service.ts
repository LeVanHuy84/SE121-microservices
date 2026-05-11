import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CursorPaginationDTO, CursorPageResponse } from '@repo/dtos';
import { RecentActivityBufferService } from '../event/recent-activity.buffer.service';
import type {
  FriendRecommendationAnalytics,
  FriendRecommendationAttribution,
  FriendRecommendation,
  SocialGraphRepository,
} from './repositories/social-graph.repository';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';
import { RecommendationQueryService } from './recommendation/recommendation-query.service';

@Injectable()
export class FriendshipService {
  private readonly logger = new Logger(FriendshipService.name);
  private readonly recommendationDismissDurationMs = 30 * 24 * 60 * 60 * 1000;
  private readonly defaultAnalyticsWindowDays = 30;
  private readonly maxAnalyticsWindowDays = 365;
  private readonly defaultCursorLimit = 10;
  private readonly maxCursorLimit = 50;
  private readonly maxFriendIdsLimit = 200;

  constructor(
    @Inject(SOCIAL_GRAPH_REPOSITORY)
    private readonly socialGraphRepo: SocialGraphRepository,
    private readonly recommendationQueryService: RecommendationQueryService,
    private readonly buffer: RecentActivityBufferService,
  ) {}

  async getRelationshipStatus(userId: string, targetId: string) {
    return this.socialGraphRepo.getRelationshipStatus(userId, targetId);
  }

  async sendFriendRequest(
    userId: string,
    targetId: string,
    attribution?: FriendRecommendationAttribution,
  ) {
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

    const result = await this.socialGraphRepo.sendFriendRequest(
      userId,
      targetId,
      attribution,
    );

    if (!result.created) {
      throw new BadRequestException('Friend request already sent');
    }

    if (attribution?.recommendationId || attribution?.recommendationRequestId) {
      await this.socialGraphRepo.recordRecommendationEvents([
        {
          userId,
          candidateId: targetId,
          eventType: 'request_sent',
          recommendationId: attribution?.recommendationId ?? null,
          recommendationRequestId: attribution?.recommendationRequestId ?? null,
        },
      ]);
    }

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

    const result = await this.socialGraphRepo.cancelFriendRequest(
      userId,
      targetId,
    );

    if (!result.removed) {
      throw new BadRequestException('No outgoing friend request to cancel');
    }

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

    const attribution = await this.socialGraphRepo.acceptFriendRequest(
      userId,
      requesterId,
    );

    if (!attribution) {
      throw new BadRequestException('No pending friend request to accept');
    }

    if (attribution?.recommendationId || attribution?.recommendationRequestId) {
      await this.socialGraphRepo.recordRecommendationEvents([
        {
          userId: requesterId,
          candidateId: userId,
          eventType: 'accepted',
          recommendationId: attribution.recommendationId,
          recommendationRequestId: attribution.recommendationRequestId,
        },
      ]);
    }

    await this.buffer.clearActivity('friendship_request', userId, requesterId);

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

    const result = await this.socialGraphRepo.declineFriendRequest(
      userId,
      requesterId,
    );

    if (!result.removed) {
      throw new BadRequestException('No pending friend request to decline');
    }

    await this.buffer.clearActivity('friendship_request', userId, requesterId);

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

    const result = await this.socialGraphRepo.removeFriend(userId, friendId);

    if (!result.removed) {
      throw new BadRequestException('Not friends');
    }

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

    const result = await this.socialGraphRepo.blockUser(userId, targetId);

    if (!result.created) {
      throw new BadRequestException('User already blocked');
    }

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

    const result = await this.socialGraphRepo.unblockUser(userId, targetId);

    if (!result.removed) {
      throw new BadRequestException('User is not blocked');
    }

    return { message: 'User unblocked successfully' };
  }

  async dismissFriendRecommendation(
    userId: string,
    targetId: string,
    attribution?: FriendRecommendationAttribution,
  ) {
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
    await this.socialGraphRepo.recordRecommendationEvents([
      {
        userId,
        candidateId: targetId,
        eventType: 'dismissed',
        recommendationId: attribution?.recommendationId ?? null,
        recommendationRequestId: attribution?.recommendationRequestId ?? null,
        metadata: {
          expiresAt: expiresAt.toISOString(),
        },
      },
    ]);

    return {
      message: 'Friend recommendation dismissed successfully',
      expiresAt,
    };
  }

  async getFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>> {
    return this.socialGraphRepo.getFriends(userId, this.normalizeCursorQuery(query));
  }

  async getFriendRequests(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>> {
    const normalizedQuery = this.normalizeCursorQuery(query);
    this.logger.debug(
      `Getting friend requests for userId: ${userId} with query: ${JSON.stringify(normalizedQuery)}`,
    );
    return this.socialGraphRepo.getFriendRequests(userId, normalizedQuery);
  }

  async recommendFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<FriendRecommendation>> {
    const normalizedQuery = this.normalizeCursorQuery(query);
    this.logger.debug(
      `Recommending friends for userId: ${userId} with query: ${JSON.stringify(normalizedQuery)}`,
    );
    try {
      return await this.recommendationQueryService.recommendFriends(
        userId,
        normalizedQuery,
      );
    } catch (error) {
      this.logger.error(
        `Recommendation unavailable for userId=${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
      };
    }
  }

  async getFriendRecommendationAnalytics(
    userId: string,
    days?: number,
  ): Promise<FriendRecommendationAnalytics> {
    const windowDays = this.normalizeAnalyticsWindowDays(days);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const analytics =
      await this.socialGraphRepo.getFriendRecommendationAnalytics(
        userId,
        since,
      );

    return {
      ...analytics,
      windowDays,
    };
  }

  async getGlobalFriendRecommendationAnalytics(
    days?: number,
  ): Promise<FriendRecommendationAnalytics> {
    const windowDays = this.normalizeAnalyticsWindowDays(days);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const analytics =
      await this.socialGraphRepo.getGlobalFriendRecommendationAnalytics(since);

    return {
      ...analytics,
      windowDays,
    };
  }

  async getFriendIds(userId: string, limit?: number) {
    const normalizedLimit =
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.min(this.maxFriendIdsLimit, Math.max(1, Math.floor(limit)))
        : undefined;

    return this.socialGraphRepo.getFriendIds(userId, normalizedLimit);
  }

  async getBlockedUsers(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>> {
    return this.socialGraphRepo.getBlockedUsers(
      userId,
      this.normalizeCursorQuery(query),
    );
  }

  private normalizeCursorQuery(query: CursorPaginationDTO): CursorPaginationDTO {
    const normalizedCursor =
      typeof query?.cursor === 'string' && query.cursor.trim().length > 0
        ? query.cursor.trim()
        : undefined;

    const resolvedLimit =
      typeof query?.limit === 'number' && Number.isFinite(query.limit)
        ? Math.floor(query.limit)
        : this.defaultCursorLimit;

    const normalizedLimit = Math.min(
      this.maxCursorLimit,
      Math.max(1, resolvedLimit),
    );

    return {
      ...query,
      cursor: normalizedCursor,
      limit: normalizedLimit,
    };
  }

  private normalizeAnalyticsWindowDays(days: number | undefined): number {
    if (typeof days !== 'number' || !Number.isFinite(days)) {
      return this.defaultAnalyticsWindowDays;
    }

    return Math.min(this.maxAnalyticsWindowDays, Math.max(1, Math.floor(days)));
  }
}
