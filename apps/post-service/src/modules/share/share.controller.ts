import { Controller } from '@nestjs/common';
import { ShareCommandService } from './share-command.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateShareDTO, PaginationDTO, UpdateShareDTO } from '@repo/dtos';
import { ShareQueryService } from './share-query.service';

@Controller('share')
export class ShareController {
  constructor(
    private readonly commandService: ShareCommandService,
    private readonly queryService: ShareQueryService
  ) {}

  @MessagePattern('share_post')
  async sharePost(@Payload() payload: { userId: string; dto: CreateShareDTO }) {
    return this.commandService.sharePost(payload.userId, payload.dto);
  }

  @MessagePattern('update_share_post')
  async update(
    @Payload() payload: { userId: string; shareId: string; dto: UpdateShareDTO }
  ) {
    return this.commandService.update(
      payload.userId,
      payload.shareId,
      payload.dto
    );
  }

  @MessagePattern('find_share_by_id')
  async findById(@Payload() shareId: string) {
    return this.queryService.findById(shareId);
  }

  @MessagePattern('find_share_by_user_id')
  async findByUserId(
    @Payload() payload: { userId: string; query: PaginationDTO }
  ) {
    return this.queryService.findByUserId(payload.userId, payload.query);
  }

  @MessagePattern('remove_share')
  remove(@Payload() payload: { userId: string; shareId: string }) {
    return this.commandService.remove(payload.userId, payload.shareId);
  }

  @MessagePattern('get_share_batch')
  async getSharesBatch(@Payload() ids: string[]) {
    return this.queryService.getSharesBatch(ids);
  }
}
