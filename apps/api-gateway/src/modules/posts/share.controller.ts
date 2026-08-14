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
} from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import {
  CreateShareDTO,
  CursorPaginationDTO,
  UpdateShareDTO,
} from "@repo/dtos";
import { MICROSERVICES_CLIENTS } from "src/common/constants";
import { CurrentUserId } from "src/common/decorators/current-user-id.decorator";

@Controller("shares")
export class ShareController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.CONTENT_FEED_SERVICE)
    private client: ClientProxy,
  ) {}

  @Post()
  sharePost(@CurrentUserId() userId: string, @Body() dto: CreateShareDTO) {
    return this.client.send("share_post", { userId, dto });
  }

  @Get("me")
  getMyShares(
    @CurrentUserId() currentUserId: string,
    @Query() query: CursorPaginationDTO,
  ) {
    return this.client.send("get_my_shares", { currentUserId, query });
  }

  @Get("user/:id")
  findByUserId(
    @Param("id") userId: string,
    @Query() pagination: CursorPaginationDTO,
    @CurrentUserId() currentUserId: string,
  ) {
    return this.client.send("find_shares_by_user_id", {
      userId,
      currentUserId,
      pagination,
    });
  }

  @Get("post/:id")
  findByPostId(
    @CurrentUserId() currentUserId: string,
    @Param("id") postId: string,
    @Query() pagination: CursorPaginationDTO,
  ) {
    return this.client.send("find_shares_by_post_id", {
      currentUserId,
      postId,
      pagination,
    });
  }

  @Patch(":id")
  update(
    @CurrentUserId() userId: string,
    @Param("id") shareId: string,
    @Body() dto: UpdateShareDTO,
  ) {
    return this.client.send("update_share_post", { userId, shareId, dto });
  }

  @Get(":id")
  findById(@Param("id") id: string, @CurrentUserId() currentUserId: string) {
    return this.client.send("find_share_by_id", {
      userId: currentUserId,
      shareId: id,
    });
  }

  @Delete(":id")
  remove(@CurrentUserId() userId: string, @Param("id") shareId: string) {
    return this.client.send("remove_share", { userId, shareId });
  }
}
