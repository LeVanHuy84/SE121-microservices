import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreatePostDTO, GetPostQueryDTO } from '@repo/dtos';
import { PostQueryService } from './post-query.service';
import { PostCommandService } from './post-command.service';

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
  async findById(@Payload() postId: string) {
    return this.postQuery.findById(postId);
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
    return this.postQuery.findByUserId(
      payload.userId,
      payload.pagination,
      payload.currentUserId
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
