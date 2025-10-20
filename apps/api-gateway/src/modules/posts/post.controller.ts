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
  findById(@Param('id') postId: string) {
    return this.client.send('find_post_by_id', postId);
  }

  @Get('user/:id')
  findByUserId(
    @Param('id') userId: string,
    @Query() pagination: GetPostQueryDTO,
    @CurrentUserId() currentUserId: string
  ) {
    return this.client.send('find_posts_by_user_id', {
      userId,
      pagination,
      currentUserId,
    });
  }

  @Get('me')
  getMyPosts(
    @Query() query: GetPostQueryDTO,
    @CurrentUserId() currentUserId: string
  ) {
    return this.client.send('get_my_posts', { currentUserId, query });
  }

  @Patch('update/:id')
  update(
    @Param('id') postId: string,
    @Body() updatePostDTO: Partial<CreatePostDTO>,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('update_post', { userId, postId, updatePostDTO });
  }

  @Delete('delete/:id')
  remove(@Param('id') id: string, @CurrentUserId() userId: string) {
    return this.client.send('remove_post', { id, userId });
  }
}
