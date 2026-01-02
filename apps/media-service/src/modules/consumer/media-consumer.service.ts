import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { Media } from 'src/entities/media.entity';

@Injectable()
export class MediaConsumerService {
  private readonly logger = new Logger(MediaConsumerService.name);

  constructor(
    private readonly cloudinary: CloudinaryService,
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>
  ) {}

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

    if (items.length) {
      await this.mediaRepo.delete({
        publicId: In(items.map((item) => item.publicId)),
      });
    }
  }

  async assignContentId(
    contentId: string,
    items: { publicId: string; url?: string; type?: 'image' | 'video' }[]
  ) {
    if (!items.length) {
      return;
    }

    const publicIds = items.map((item) => item.publicId);
    const existing = await this.mediaRepo.find({
      where: { publicId: In(publicIds) },
    });
    const existingMap = new Map(
      existing.map((media) => [media.publicId, media])
    );

    const toSave: Media[] = [];
    for (const item of items) {
      const found = existingMap.get(item.publicId);
      if (found) {
        found.contentId = contentId;
        found.status = 'READY';
        if (item.url) {
          found.url = item.url;
        }
        if (item.type) {
          found.type = item.type;
        }
        toSave.push(found);
        continue;
      }

      toSave.push(
        this.mediaRepo.create({
          publicId: item.publicId,
          contentId,
          url: item.url,
          type: item.type ?? 'image',
          status: 'READY',
        })
      );
    }

    await this.mediaRepo.save(toSave);
    this.logger.log(
      `Assigned contentId=${contentId} to ${toSave.length} media items`
    );
  }
}
