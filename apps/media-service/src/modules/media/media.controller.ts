import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { MediaService } from './media.service';


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
      type: 'image' | 'video' | 'audio' | 'file';
      mimeType?: string;
      fileName?: string;
      size?: number;
    }
  ) {
    const buffer = Buffer.isBuffer(data.file)
      ? data.file
      : Buffer.from(data.file);
    return this.mediaService.upload(
      buffer,
      data.userId,
      data.folder,
      data.type,
      data.mimeType,
      data.fileName,
      data.size
    );
  }
}
