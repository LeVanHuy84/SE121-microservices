import { Injectable } from '@nestjs/common';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';

@Injectable()
export class MediaService {
  constructor(private readonly cloudinary: CloudinaryService) {}

  async upload(
    file: Buffer,
    userId: string,
    folder: string,
    type: 'image' | 'video'
  ) {
    const suffix = Math.random().toString(36).slice(2, 10);
    const publicId = `${userId}-${Date.now()}-${suffix}`;
    const result = await this.cloudinary.uploadFile(file, folder, {
      resource_type: type,
      public_id: publicId,
    });

    return result.secure_url || result.url;
  }
}
