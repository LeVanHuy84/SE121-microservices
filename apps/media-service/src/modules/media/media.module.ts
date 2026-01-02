import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { Media } from 'src/entities/media.entity';
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
