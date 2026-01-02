import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, IsNull, Repository } from 'typeorm';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { Media } from 'src/entities/media.entity';

@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  constructor(
    @InjectRepository(Media)
    private readonly mediaRepo: Repository<Media>,
    private readonly cloudinary: CloudinaryService
  ) {}

  @Cron(process.env.MEDIA_CLEANUP_CRON || '0 */10 * * * *')
  async cleanupOrphanedMedia() {
    const ttlMinutes = parseInt(
      process.env.MEDIA_ORPHAN_TTL_MINUTES || '30',
      10
    );
    const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000);

    const orphans = await this.mediaRepo.find({
      where: {
        contentId: IsNull(),
        createdAt: LessThan(cutoff),
      },
    });

    if (!orphans.length) {
      return;
    }

    this.logger.log(
      `Found ${orphans.length} orphaned media older than ${ttlMinutes} minutes`
    );

    for (const media of orphans) {
      try {
        await this.cloudinary.deleteFile(media.publicId, media.type);
        await this.mediaRepo.delete(media.id);
        this.logger.log(`Deleted orphaned media publicId=${media.publicId}`);
      } catch (error) {
        this.logger.warn(
          `Failed to delete orphaned media publicId=${media.publicId}: ${error.message}`
        );
      }
    }
  }
}
