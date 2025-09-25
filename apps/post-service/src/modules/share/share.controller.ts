import { Controller } from '@nestjs/common';
import { ShareService } from './share.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateShareDTO, PaginationDTO, UpdateShareDTO } from '@repo/dtos';

@Controller('share')
export class ShareController {
  constructor(private shareService: ShareService) {}

  @MessagePattern('share_post')
  async sharePost(@Payload() payload: { userId: string; dto: CreateShareDTO }) {
    return this.shareService.sharePost(payload.userId, payload.dto);
  }

  @MessagePattern('update_share_post')
  async update(
    @Payload() payload: { userId: string; shareId: string; dto: UpdateShareDTO }
  ) {
    return this.shareService.update(
      payload.userId,
      payload.shareId,
      payload.dto
    );
  }

  @MessagePattern('find_share_by_id')
  async findById(@Payload() shareId: string) {
    return this.shareService.findById(shareId);
  }

  @MessagePattern('find_share_by_user_id')
  async findByUserId(
    @Payload() payload: { userId: string; query: PaginationDTO }
  ) {
    return this.shareService.findByUserId(payload.userId, payload.query);
  }

  @MessagePattern('remove_share')
  remove(@Payload() payload: { userId: string; shareId: string }) {
    return this.shareService.remove(payload.userId, payload.shareId);
  }

  @MessagePattern('get_share_batch')
  async getSharesBatch(@Payload() ids: string[]) {
    return this.shareService.getSharesBatch(ids);
  }
}
