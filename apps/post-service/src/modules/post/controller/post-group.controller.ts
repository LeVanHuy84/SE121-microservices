import { Controller, UseGuards } from '@nestjs/common';
import { PostGroupService } from '../service/post-group.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreatePostDTO } from '@repo/dtos';

@Controller('post-group')
export class PostGroupController {
  constructor(private postGroup: PostGroupService) {}

  // Tạo post trong group
  @MessagePattern('create_post_in_group')
  async createPostInGroup(
    @Payload() payload: { userId: string; createPostDTO: CreatePostDTO }
  ) {
    return this.postGroup.create(payload.userId, payload.createPostDTO);
  }

  // Duyệt post trong group
  @MessagePattern('approve_post_in_group')
  async approvePostInGroup(
    @Payload() payload: { userId: string; postId: string }
  ) {
    return this.postGroup.approvePost(payload.userId, payload.postId);
  }

  // Từ chối post trong group
  @MessagePattern('reject_post_in_group')
  async rejectPostInGroup(
    @Payload() payload: { userId: string; postId: string }
  ) {
    return this.postGroup.rejectPost(payload.userId, payload.postId);
  }
}
