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
import { CreatePostDTO, GetPostQueryDTO } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('posts')
export class GroupPostController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.POST_SERVICE)
    private client: ClientProxy
  ) {}

  @Get('group/:groupId')
  getGroupPosts(
    @Param('groupId') groupId: string,
    @CurrentUserId() currentUserId: string,
    @Query() pagination: GetPostQueryDTO
  ) {
    return this.client.send('get_group_posts', {
      groupId,
      pagination,
      currentUserId,
    });
  }

  @Post('/group')
  create(
    @Body() createPostDTO: CreatePostDTO,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('create_post_in_group', { userId, createPostDTO });
  }
}
