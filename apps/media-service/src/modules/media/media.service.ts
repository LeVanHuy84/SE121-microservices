import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { Media, MediaType } from 'src/entities/media.entity';

type WebhookMediaInput = {
  publicId: string;
  url?: string;
  type: MediaType;
  format?: string;
  size?: number;
  duration?: number;
  createdAt?: Date;
};

@Injectable()
export class MediaService {
  constructor(
    private readonly cloudinary: CloudinaryService,
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>
  ) {}

  async upload(
    file: Buffer,
    userId: string,
    folder: string,
    type: 'image' | 'video'
  ) {
    const result = await this.cloudinary.uploadFile(file, folder, {
      resource_type: type,
    });

    const url = result.secure_url || result.url;
    return { url, publicId: result.public_id};
  }

  async upsertFromWebhook(input: WebhookMediaInput) {
    const existing = await this.mediaRepo.findOne({
      where: { publicId: input.publicId },
    });

    if (existing) {
      existing.url = input.url ?? existing.url;
      existing.type = input.type;
      existing.format = input.format ?? existing.format;
      existing.size = input.size ?? existing.size;
      existing.duration = input.duration ?? existing.duration;
      existing.status = existing.contentId ? 'READY' : 'UPLOADED';
      return this.mediaRepo.save(existing);
    }

    const media = this.mediaRepo.create({
      publicId: input.publicId,
      url: input.url || '',
      type: input.type,
      format: input.format,
      size: input.size,
      duration: input.duration,
      status: 'UPLOADED',
      createdAt: input.createdAt,
    });

    return this.mediaRepo.save(media);
  }
}
