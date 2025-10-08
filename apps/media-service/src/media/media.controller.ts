import { Controller } from '@nestjs/common';
import { MediaService } from './media.service';
import { MessagePattern, Payload } from '@nestjs/microservices';

@Controller()
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @MessagePattern('upload')
  async upload(
    @Payload()
    data: {
      file: Buffer;
      userId: string;
      folder: string;
      type: 'image' | 'video';
    }
  ) {
    const media = await this.mediaService.upload(
      data.userId,
      data.folder,
      data.type
    );

    const url = await this.mediaService.performUpload(
      media.id,
      Buffer.from(data.file),
      data.type,
      `${process.env.WEBHOOK_BASE_URL}/webhook/cloudinary`
    );

    return url;
  }
}
