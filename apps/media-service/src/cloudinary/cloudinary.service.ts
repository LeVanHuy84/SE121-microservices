// cloudinary.service.ts

import { Injectable } from '@nestjs/common';
import { v2 as cloudinary, UploadApiOptions } from 'cloudinary';
import { CloudinaryResponse } from './cloudinary-response';
const streamifier = require('streamifier');
@Injectable()
export class CloudinaryService {
  async uploadFile(
    buffer: Buffer,
    folderName: string,
    options: UploadApiOptions = {}
  ): Promise<CloudinaryResponse> {
    return new Promise<CloudinaryResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folderName,
          overwrite: true,
          resource_type: options.resource_type || 'auto',
          public_id: options.public_id,
          eager: options.eager,
          notification_url: options.notification_url,
          ...options,
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('No result from Cloudinary'));
          resolve(result);
        }
      );

      streamifier.createReadStream(buffer).pipe(uploadStream);
    });
  }

  generateImageUrl(
    publicId: string,
    opts: { w?: number; h?: number; crop?: string } = {}
  ) {
    return cloudinary.url(publicId, {
      secure: true,
      transformation: [
        { width: opts.w, height: opts.h, crop: opts.crop || 'fill' },
      ],
    });
  }

  generateVideoThumbnail(
    publicId: string,
    opts: { w?: number; h?: number; start_offset?: string } = {}
  ) {
    return cloudinary.url(publicId, {
      resource_type: 'video',
      format: 'jpg',
      secure: true,
      transformation: [
        {
          width: opts.w,
          height: opts.h,
          crop: 'fill',
          start_offset: opts.start_offset || '1',
        },
      ],
    });
  }
}
