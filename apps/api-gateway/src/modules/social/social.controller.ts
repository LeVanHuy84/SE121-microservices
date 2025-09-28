import { Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('social')
export class SocialController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.SOCIAL_SERVICE) private readonly socialClient: ClientProxy,
  ) { }
  @Post('request/:targetId')
  sendFriendRequest(@Param('targetId') targetId: string, @CurrentUserId() userId: string) {
    return this.socialClient
      .send('send_friend_request', { userId, targetId })

  }

  @Post('accept/:requesterId')
  acceptFriendRequest(@Param('requesterId') requesterId: string, @CurrentUserId() userId: string) {
    return this.socialClient
      .send('accept_friend_request', { userId, requesterId })
  }

  @Post('remove/:friendId')
  removeFriend(@Param('friendId') friendId: string, @CurrentUserId() userId: string) {
    return this.socialClient
      .send({ cmd: 'remove_friend' }, { userId, friendId })
  }

  @Get()
  getFriends(@CurrentUserId() userId: string) {
    return this.socialClient
      .send({ cmd: 'get_friends' }, { userId })
  }

  @Get('recommend')
  async recommendFriends(@CurrentUserId() userId: string) {
    return this.socialClient
      .send({ cmd: 'recommend_friends' }, { userId })
    
  }

  @Post('block/:targetId')
  blockUser(@CurrentUserId() userId: string, @Param() targetId: string) {
    return this.socialClient.send({ cmd: 'block_user'}, {userId, targetId})
  }

  @Post('unblock/:targetId')
  unblockUser(@CurrentUserId() userId: string, @Param() targetId: string) {
    return this.socialClient.send({ cmd: 'unblock_user' }, { userId, targetId })
  }

}
