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
    private readonly socialClient: ClientProxy
  ) {}
  @Post('request/:targetId')
  sendFriendRequest(
    @CurrentUserId() userId: string,
    @Param('targetId') targetId: string
  ) {
    return this.socialClient.send('send_friend_request', { userId, targetId });
  }

  @Post('cancel/:targetId')
  cancelFriendRequest(
    @CurrentUserId() userId: string,
    @Param('targetId') targetId: string
  ) {
    return this.socialClient.send('cancel_friend_request', { userId, targetId });
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
    return this.socialClient.send('get_friends', { userId, query });
  }

  @Get('friends/:userId')
  async getUserFriends(
    @Param('userId') userId: string,
    @Query() query: CursorPaginationDTO
  ) {
    return this.socialClient.send('get_friends', { userId, query });
  }

  @Get('friends/recommend')
  recommendFriends(
    @CurrentUserId() userId: string,
    @Body() query: CursorPaginationDTO
  ) {
    return this.socialClient.send('recommend_friends', { userId, query });
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
