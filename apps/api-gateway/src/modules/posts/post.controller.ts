import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CreatePostDTO, GetPostQueryDTO } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('posts')
export class PostController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.POST_SERVICE)
    private client: ClientProxy
  ) {}

  @Post()
  create(
    @Body() createPostDTO: CreatePostDTO,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('create_post', { userId, createPostDTO });
  }

  @Get('post/:id')
  getById(@Param('id') postId: string) {
    return this.client.send('get_post_by_id', postId);
  }

  @Get('user/:id')
  getByUser(
    @Param('id') userId: string,
    @Query() pagination: GetPostQueryDTO,
    @CurrentUserId() currentUserId: string
  ) {
    return this.client.send('get_posts_by_user', {
      userId,
      pagination,
      currentUserId,
    });
  }

  @Patch('update/:id')
  update(
    @Param('id') postId: string,
    @Body() updatePostDTO: Partial<CreatePostDTO>,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('update_post', { userId, postId, updatePostDTO });
  }

  @Patch('update-status/:id')
  updatePostStatus(
    @Param('id') postId: string,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('update_post_status', { userId, postId });
  }

  @Delete('delete/:id')
  deletePost(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.client.send('delete_post', { id, userId });
  }
}
