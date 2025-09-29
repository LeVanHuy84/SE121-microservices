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

  extractPublicId(url: string): string | null {
    // URL Cloudinary: https://res.cloudinary.com/<cloud>/image/upload/v123456789/folder/file.jpg
    try {
      const parts = url.split('/');
      const fileWithExt = parts[parts.length - 1];
      const folder = parts[parts.length - 2];
      const fileName = fileWithExt.split('.')[0];
      return `${folder}/${fileName}`;
    } catch (e) {
      return null;
    }
  }
}
