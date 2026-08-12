import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { Media } from '../entities/media.entity';
import { MediaController } from './media.controller';
import { MediaWebhookController } from './media.webhook.controller';
import { MediaCleanupService } from './media.cleanup.service';
import { MediaService } from './media.service';

@Module({
  imports: [CloudinaryModule, TypeOrmModule.forFeature([Media])],
  controllers: [MediaController, MediaWebhookController],
  providers: [MediaService, MediaCleanupService],
})
export class MediaModule {}
