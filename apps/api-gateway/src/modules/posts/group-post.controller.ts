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
import { CreatePostDTO, GetGroupPostQueryDTO } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('groups')
export class GroupPostController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.POST_SERVICE)
    private client: ClientProxy,
  ) {}

  @Get(':groupId/posts')
  getGroupPosts(
    @Param('groupId') groupId: string,
    @CurrentUserId() currentUserId: string,
    @Query() pagination: GetGroupPostQueryDTO,
  ) {
    return this.client.send('get_group_posts', {
      groupId,
      pagination,
      currentUserId,
    });
  }

  @Post(':groupId/posts')
  create(
    @Param('groupId') groupId: string,
    @Body() createPostDTO: CreatePostDTO,
    @CurrentUserId() userId: string,
  ) {
    return this.client.send('create_post_in_group', {
      userId,
      groupId,
      createPostDTO,
    });
  }

  @Post(':groupId/posts/:postId/moderation')
  approvePostInGroup(
    @Param('postId') postId: string,
    @Param('groupId') groupId: string,
    @CurrentUserId() userId: string,
    @Body('action') action: 'approve' | 'reject',
  ) {
    if (action === 'approve') {
      return this.client.send('approve_post_in_group', {
        userId,
        groupId,
        postId,
      });
    } else {
      return this.client.send('reject_post_in_group', {
        userId,
        groupId,
        postId,
      });
    }
  }
}
