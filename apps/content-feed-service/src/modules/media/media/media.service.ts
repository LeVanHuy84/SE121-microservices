import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MEDIA_UPLOAD_MAX_BYTES } from '@repo/dtos';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { Media, MediaType } from '../entities/media.entity';

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
  private readonly maxUploadSize: Record<MediaType, number> =
    MEDIA_UPLOAD_MAX_BYTES;
  private readonly fileMimeAllowlist = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'application/x-zip-compressed',
    'text/plain',
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

  private assertUploadAllowed(
    type: MediaType,
    mimeType?: string,
    size?: number
  ) {
    if (!mimeType) {
      throw new RpcException('mimeType is required');
    }

    if (type === 'image' && !mimeType.startsWith('image/')) {
      throw new RpcException(`Unsupported image MIME type: ${mimeType}`);
    }

    if (type === 'video' && !mimeType.startsWith('video/')) {
      throw new RpcException(`Unsupported video MIME type: ${mimeType}`);
    }

    if (type === 'audio' && !mimeType.startsWith('audio/')) {
      throw new RpcException(`Unsupported audio MIME type: ${mimeType}`);
    }

    if (type === 'file' && !this.fileMimeAllowlist.has(mimeType)) {
      throw new RpcException(`Unsupported file MIME type: ${mimeType}`);
    }

    const effectiveSize = size ?? 0;
    if (effectiveSize > this.maxUploadSize[type]) {
      throw new RpcException(
        `File exceeds the ${type} upload limit of ${this.maxUploadSize[type]} bytes`,
      );
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
    this.assertUploadAllowed(normalizedType, mimeType, size ?? file.byteLength);
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
