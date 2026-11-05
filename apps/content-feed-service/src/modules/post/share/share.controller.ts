import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { ShareCommandService } from "./service/share-command.service";
import { Payload } from "@nestjs/microservices";
import {
  CreateShareDTO,
  CursorPaginationDTO,
  UpdateShareDTO,
} from "@repo/dtos";
import { ShareQueryService } from "./service/share-query.service";

@Controller("share")
export class ShareController {
  constructor(
    private readonly commandService: ShareCommandService,
    private readonly queryService: ShareQueryService,
  ) {}

  @TcpMessagePattern("share_post")
  async sharePost(@Payload() payload: { userId: string; dto: CreateShareDTO }) {
    return this.commandService.sharePost(payload.userId, payload.dto);
  }

  @TcpMessagePattern("update_share_post")
  async update(
    @Payload()
    payload: {
      userId: string;
      shareId: string;
      dto: UpdateShareDTO;
    },
  ) {
    return this.commandService.update(
      payload.userId,
      payload.shareId,
      payload.dto,
    );
  }

  @TcpMessagePattern("find_share_by_id")
  async findById(@Payload() payload: { userId: string; shareId: string }) {
    return this.queryService.findById(payload.userId, payload.shareId);
  }

  @TcpMessagePattern("get_my_shares")
  async getMyPosts(
    @Payload() payload: { currentUserId: string; query: CursorPaginationDTO },
  ) {
    return this.queryService.getMyShares(payload.currentUserId, payload.query);
  }

  @TcpMessagePattern("find_shares_by_user_id")
  async findPostsByUserId(
    @Payload()
    payload: {
      userId: string;
      pagination: CursorPaginationDTO;
      currentUserId: string;
    },
  ) {
    return this.queryService.getUserShares(
      payload.userId,
      payload.currentUserId,
      payload.pagination,
    );
  }

  @TcpMessagePattern("find_shares_by_post_id")
  async findSharesByPostId(
    @Payload()
    payload: {
      currentUserId: string;
      postId: string;
      pagination: CursorPaginationDTO;
    },
  ) {
    return this.queryService.findSharesByPostId(
      payload.currentUserId,
      payload.postId,
      payload.pagination,
    );
  }

  @TcpMessagePattern("remove_share")
  remove(@Payload() payload: { userId: string; shareId: string }) {
    return this.commandService.remove(payload.userId, payload.shareId);
  }
}
