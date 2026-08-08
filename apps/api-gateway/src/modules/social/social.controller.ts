import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CursorPaginationDTO } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('social')
export class SocialController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.SOCIAL_SERVICE)
    private readonly socialClient: ClientProxy,
  ) {}
  @Post('request/:targetId')
  sendFriendRequest(
    @CurrentUserId() userId: string,
    @Param('targetId') targetId: string,
    @Body()
    body: {
      recommendationId?: string;
      recommendationRequestId?: string;
    }
  ) {
    return this.socialClient.send('send_friend_request', {
      userId,
      targetId,
      recommendationId: body?.recommendationId,
      recommendationRequestId: body?.recommendationRequestId,
    });
  }

  @Post('cancel/:targetId')
  cancelFriendRequest(
    @CurrentUserId() userId: string,
    @Param('targetId') targetId: string
  ) {
    return this.socialClient.send('cancel_friend_request', {
      userId,
      targetId,
    });
  }

  @Post('accept/:requesterId')
  async acceptFriendRequest(
    @CurrentUserId() userId: string,
    @Param('requesterId') requesterId: string
  ) {
    return this.socialClient.send('accept_friend_request', {
      userId,
      requesterId,
    });
  }

  @Post('decline/:requesterId')
  async declineFriendRequest(
    @CurrentUserId() userId: string,
    @Param('requesterId') requesterId: string
  ) {
    return this.socialClient.send('decline_friend_request', {
      userId,
      requesterId,
    });
  }

  @Post('remove/:friendId')
  async removeFriend(
    @CurrentUserId() userId: string,
    @Param('friendId') friendId: string
  ) {
    return this.socialClient.send('remove_friend', { userId, friendId });
  }

  @Get('requests')
  async getFriendRequests(
    @CurrentUserId() userId: string,
    @Query() query: CursorPaginationDTO
  ) {
    return this.socialClient.send('get_friends_request', { userId, query });
  }

  @Get('friends/me')
  async getFriends(
    @CurrentUserId() userId: string,
    @Query() query: CursorPaginationDTO
  ) {
    return this.socialClient.send('get_friends', { requesterId: userId, targetId: userId, query });
  }

  @Get('friends/recommend')
  async recommendFriends(
    @CurrentUserId() userId: string,
    @Query() query: CursorPaginationDTO
  ) {
    return this.socialClient.send('suggest_friends', { userId, query });
  }

  @Get('friends/recommend/analytics')
  async getFriendRecommendationAnalytics(
    @CurrentUserId() userId: string,
    @Query('days') days?: string,
  ) {
    const parsedDays =
      typeof days === 'string' && days.trim().length > 0
        ? Number.parseInt(days, 10)
        : undefined;

    return this.socialClient.send('get_friend_recommendation_analytics', {
      userId,
      days: parsedDays,
    });
  }

  @Post('friends/recommend/dismiss/:targetId')
  async dismissFriendRecommendation(
    @CurrentUserId() userId: string,
    @Param('targetId') targetId: string,
    @Body()
    body: {
      recommendationId?: string;
      recommendationRequestId?: string;
    }
  ) {
    return this.socialClient.send('dismiss_friend_recommendation', {
      userId,
      targetId,
      recommendationId: body?.recommendationId,
      recommendationRequestId: body?.recommendationRequestId,
    });
  }

  @Get('friends/:userId')
  async getUserFriends(
    @CurrentUserId() requesterId: string,
    @Param('userId') targetId: string,
    @Query() query: CursorPaginationDTO
  ) {
    return this.socialClient.send('get_friends', { requesterId, targetId, query });
  }

  @Get('blocked')
  async getBlockedUsers(
    @CurrentUserId() userId: string,
    @Query() query: CursorPaginationDTO
  ) {
    return this.socialClient.send('get_blocked_users', { userId, query });
  }

  @Post('block/:targetId')
  async blockUser(
    @CurrentUserId() userId: string,
    @Param('targetId') targetId: string
  ) {
    return this.socialClient.send('block_user', { userId, targetId });
  }

  @Post('unblock/:targetId')
  async unblockUser(
    @CurrentUserId() userId: string,
    @Param('targetId') targetId: string
  ) {
    return this.socialClient.send('unblock_user', { userId, targetId });
  }

  @Get('relationship/:targetId')
  async getRelationshipStatus(
    @CurrentUserId() userId: string,
    @Param('targetId') targetId: string
  ) {
    return this.socialClient.send('get_relationship_status', {
      userId,
      targetId,
    });
  }
}
