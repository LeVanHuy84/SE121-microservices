import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreatePostDTO, GetPostQueryDTO } from '@repo/dtos';
import { PostQueryService } from './service/post-query.service';
import { PostCommandService } from './service/post-command.service';

@Controller('posts')
export class PostController {
  constructor(
    private postQuery: PostQueryService,
    private postCommand: PostCommandService
  ) {}

  @MessagePattern('create_post')
  async create(
    @Payload() payload: { userId: string; createPostDTO: CreatePostDTO }
  ) {
    return this.postCommand.create(payload.userId, payload.createPostDTO);
  }

  @MessagePattern('find_post_by_id')
  async findById(
    @Payload() payload: { currentUserId: string; postId: string }
  ) {
    return this.postQuery.findById(payload.currentUserId, payload.postId);
  }

  @MessagePattern('get_my_posts')
  async getMyPosts(
    @Payload() payload: { currentUserId: string; query: GetPostQueryDTO }
  ) {
    return this.postQuery.getMyPosts(payload.currentUserId, payload.query);
  }

  @MessagePattern('find_posts_by_user_id')
  async findPostsByUserId(
    @Payload()
    payload: {
      userId: string;
      pagination: GetPostQueryDTO;
      currentUserId: string;
    }
  ) {
    return this.postQuery.getUserPosts(
      payload.userId,
      payload.currentUserId,
      payload.pagination
    );
  }

  @MessagePattern('update_post')
  async updatePost(
    @Payload() payload: { userId: string; postId: string; updatePostDTO: any }
  ) {
    return this.postCommand.update(
      payload.userId,
      payload.postId,
      payload.updatePostDTO
    );
  }

  @MessagePattern('remove_post')
  async remove(@Payload() payload: { id: string; userId: string }) {
    return this.postCommand.remove(payload.id, payload.userId);
  }
}
