import { TcpMessagePattern } from "@repo/common";
import { Controller, UseGuards } from "@nestjs/common";
import { PostGroupService } from "../service/post-group.service";
import { Payload } from "@nestjs/microservices";
import { CreatePostDTO } from "@repo/dtos";

@Controller("post-group")
export class PostGroupController {
  constructor(private postGroup: PostGroupService) {}

  // Tạo post trong group
  @TcpMessagePattern("create_post_in_group")
  async createPostInGroup(
    @Payload()
    payload: {
      userId: string;
      groupId: string;
      createPostDTO: CreatePostDTO;
    },
  ) {
    return this.postGroup.create(
      payload.userId,
      payload.groupId,
      payload.createPostDTO,
    );
  }

  // Duyệt post trong group
  @TcpMessagePattern("approve_post_in_group")
  async approvePostInGroup(
    @Payload() payload: { userId: string; groupId: string; postId: string },
  ) {
    return this.postGroup.approvePost(
      payload.userId,
      payload.groupId,
      payload.postId,
    );
  }

  // Từ chối post trong group
  @TcpMessagePattern("reject_post_in_group")
  async rejectPostInGroup(
    @Payload() payload: { userId: string; groupId: string; postId: string },
  ) {
    return this.postGroup.rejectPost(
      payload.userId,
      payload.groupId,
      payload.postId,
    );
  }
}
