import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PostService } from './post.service';
import { CreatePostDTO, GetPostQueryDTO, PaginationDTO } from '@repo/dtos';

@Controller('posts')
export class PostController {
  constructor(private postService: PostService) {}

  @MessagePattern('create_post')
  async create(
    @Payload() payload: { userId: string; createPostDTO: CreatePostDTO }
  ) {
    return this.postService.create(payload.userId, payload.createPostDTO);
  }

  @MessagePattern('find_post_by_id')
  async findById(@Payload() postId: string) {
    return this.postService.findById(postId);
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
    return this.postService.findByUserId(
      payload.userId,
      payload.pagination,
      payload.currentUserId
    );
  }

  @MessagePattern('update_post')
  async updatePost(
    @Payload() payload: { userId: string; postId: string; updatePostDTO: any }
  ) {
    return this.postService.update(
      payload.userId,
      payload.postId,
      payload.updatePostDTO
    );
  }

  @MessagePattern('update_post_status')
  async updatePostStatus(
    @Payload() payload: { userId: string; postId: string }
  ) {
    return this.postService.updateStatus(payload.userId, payload.postId);
  }

  @MessagePattern('remove_post')
  async remove(@Payload() payload: { id: string; userId: string }) {
    return this.postService.remove(payload.id, payload.userId);
  }
}
