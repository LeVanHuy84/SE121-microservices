import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { Media, MediaType } from 'src/entities/media.entity';

type WebhookMediaInput = {
  publicId: string;
  url?: string;
  type?: MediaType;
  fileName?: string;
  mimeType?: string;
  format?: string;
  size?: number;
  duration?: number;
  thumbnailUrl?: string;
  resourceType?: 'image' | 'video' | 'raw';
  createdAt?: Date;
};

@Injectable()
export class MediaService {
  private readonly audioFormats = new Set([
    'mp3',
    'm4a',
    'aac',
    'wav',
    'ogg',
    'oga',
    'flac',
    'webm',
  ]);

  constructor(
    private readonly cloudinary: CloudinaryService,
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>
  ) {}

  private normalizeMediaType(
    inputType?: MediaType,
    mimeType?: string,
    format?: string,
    resourceType?: 'image' | 'video' | 'raw'
  ): MediaType {
    if (inputType) {
      return inputType;
    }

    if (mimeType?.startsWith('image/')) {
      return 'image';
    }
    if (mimeType?.startsWith('audio/')) {
      return 'audio';
    }
    if (mimeType?.startsWith('video/')) {
      return 'video';
    }
    if (resourceType === 'raw') {
      return 'file';
    }
    if (resourceType === 'image') {
      return 'image';
    }
    if (resourceType === 'video') {
      return this.audioFormats.has((format || '').toLowerCase())
        ? 'audio'
        : 'video';
    }

    return 'file';
  }

  private toCloudinaryResourceType(
    type: MediaType
  ): 'image' | 'video' | 'raw' {
    switch (type) {
      case 'image':
        return 'image';
      case 'video':
      case 'audio':
        return 'video';
      case 'file':
      default:
        return 'raw';
    }
  }

  async upload(
    file: Buffer,
    userId: string,
    folder: string,
    type: MediaType,
    mimeType?: string,
    fileName?: string,
    size?: number
  ) {
    const normalizedType = this.normalizeMediaType(type, mimeType);
    const result = await this.cloudinary.uploadFile(file, folder, {
      resource_type: this.toCloudinaryResourceType(normalizedType),
    });

    const url = result.secure_url || result.url;
    return {
      type: normalizedType,
      url,
      publicId: result.public_id,
      fileName,
      mimeType,
      size: size ?? result.bytes,
      duration:
        typeof result.duration === 'number' ? Math.round(result.duration) : undefined,
      thumbnailUrl:
        normalizedType === 'video'
          ? this.cloudinary.generateVideoThumbnail(result.public_id)
          : undefined,
    };
  }

  async upsertFromWebhook(input: WebhookMediaInput) {
    const normalizedType = this.normalizeMediaType(
      input.type,
      input.mimeType,
      input.format,
      input.resourceType,
    );
    const existing = await this.mediaRepo.findOne({
      where: { publicId: input.publicId },
    });

    if (existing) {
      existing.url = input.url ?? existing.url;
      existing.type = normalizedType;
      existing.fileName = input.fileName ?? existing.fileName;
      existing.mimeType = input.mimeType ?? existing.mimeType;
      existing.format = input.format ?? existing.format;
      existing.size = input.size ?? existing.size;
      existing.duration = input.duration ?? existing.duration;
      existing.thumbnailUrl = input.thumbnailUrl ?? existing.thumbnailUrl;
      existing.status = existing.contentId ? 'READY' : 'UPLOADED';
      return this.mediaRepo.save(existing);
    }

    const media = this.mediaRepo.create({
      publicId: input.publicId,
      url: input.url || '',
      type: normalizedType,
      fileName: input.fileName,
      mimeType: input.mimeType,
      format: input.format,
      size: input.size,
      duration: input.duration,
      thumbnailUrl: input.thumbnailUrl,
      status: 'UPLOADED',
      createdAt: input.createdAt,
    });

    return this.mediaRepo.save(media);
  }
}
