import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import {
  CreatePostDTO,
  CursorPageResponse,
  GetGroupPostQueryDTO,
  GetPostQueryDTO,
  PostResponseDTO,
  PostSnapshotDTO,
  TargetType,
} from "@repo/dtos";
import { PostQueryService } from "../service/post-query.service";
import { PostCommandService } from "../service/post-command.service";

@Controller("posts")
export class PostController {
  constructor(
    private postQuery: PostQueryService,
    private postCommand: PostCommandService,
  ) {}

  @TcpMessagePattern("create_post")
  async create(
    @Payload() payload: { userId: string; createPostDTO: CreatePostDTO },
  ): Promise<PostSnapshotDTO> {
    return this.postCommand.create(payload.userId, payload.createPostDTO);
  }

  @TcpMessagePattern("find_post_by_id")
  async findById(
    @Payload() payload: { currentUserId: string; postId: string },
  ): Promise<PostResponseDTO> {
    return this.postQuery.findById(payload.currentUserId, payload.postId);
  }

  @TcpMessagePattern("get_my_posts")
  async getMyPosts(
    @Payload() payload: { currentUserId: string; query: GetPostQueryDTO },
  ): Promise<CursorPageResponse<PostSnapshotDTO>> {
    return this.postQuery.getMyPosts(payload.currentUserId, payload.query);
  }

  @TcpMessagePattern("find_posts_by_user_id")
  async findPostsByUserId(
    @Payload()
    payload: {
      userId: string;
      pagination: GetPostQueryDTO;
      currentUserId: string;
    },
  ): Promise<CursorPageResponse<PostSnapshotDTO>> {
    return this.postQuery.getUserPosts(
      payload.userId,
      payload.currentUserId,
      payload.pagination,
    );
  }

  @TcpMessagePattern("get_group_posts")
  async getGroupPosts(
    @Payload()
    payload: {
      groupId: string;
      pagination: GetGroupPostQueryDTO;
      currentUserId: string;
    },
  ): Promise<CursorPageResponse<PostSnapshotDTO>> {
    return this.postQuery.getGroupPost(
      payload.groupId,
      payload.currentUserId,
      payload.pagination,
    );
  }

  @TcpMessagePattern("update_post")
  async updatePost(
    @Payload() payload: { userId: string; postId: string; updatePostDTO: any },
  ): Promise<PostSnapshotDTO> {
    return this.postCommand.update(
      payload.userId,
      payload.postId,
      payload.updatePostDTO,
    );
  }

  @TcpMessagePattern("remove_post")
  async remove(
    @Payload() payload: { id: string; userId: string },
  ): Promise<boolean> {
    return this.postCommand.remove(payload.userId, payload.id);
  }

  @TcpMessagePattern("get_posts_batch")
  async getPostsBatch(
    @Payload() payload: { currentUserId: string; postIds: string[] },
  ): Promise<PostSnapshotDTO[]> {
    return this.postQuery.getPostBatch(payload.currentUserId, payload.postIds);
  }

  @TcpMessagePattern("get_post_edit_histories")
  async getPostEditHistories(
    @Payload() payload: { userId: string; postId: string },
  ) {
    return this.postQuery.getPostEditHistories(payload.userId, payload.postId);
  }
}
