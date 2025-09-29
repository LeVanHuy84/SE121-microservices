import { BadRequestException, Injectable } from '@nestjs/common';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';

@Injectable()
export class ImagesService {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  async updateImage(file: Buffer, userId: string, folder: string): Promise<string> {
    try {
      if (!file) throw new BadRequestException('No file uploaded');

      // Upload ảnh mới
      const res = await this.cloudinaryService.uploadFile(file, folder, {
        public_id: `user_${userId}`,
      });
      return res.secure_url;
    } catch (error) {
      throw error;
    }
  }
}
