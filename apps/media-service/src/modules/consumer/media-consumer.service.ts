import { Injectable, Logger } from '@nestjs/common';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';

@Injectable()
export class MediaConsumerService {
  private readonly logger = new Logger(MediaConsumerService.name);

  constructor(private readonly cloudinary: CloudinaryService) {}

  async deleteMedia(
    items: { publicId: string; resourceType?: 'image' | 'video' }[]
  ) {
    for (const item of items) {
      const resourceType = item.resourceType ?? 'image';
      await this.cloudinary.deleteFile(item.publicId, resourceType);
      this.logger.log(
        `Deleted media publicId=${item.publicId} resourceType=${resourceType}`
      );
    }
  }
}
