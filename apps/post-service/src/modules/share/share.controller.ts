import { Controller } from '@nestjs/common';
import { ShareService } from './share.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateShareDTO } from '@repo/dtos';

@Controller('share')
export class ShareController {
  constructor(private shareService: ShareService) {}

  @MessagePattern('share_post')
  async sharePost(@Payload() payload: { userId: string; dto: CreateShareDTO }) {
    return this.shareService.sharePost(payload.userId, payload.dto);
  }
}
