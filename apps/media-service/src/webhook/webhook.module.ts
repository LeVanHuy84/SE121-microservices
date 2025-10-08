import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { MediaModule } from 'src/media/media.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookEvent } from 'src/entities/webhook.entity';
import { MediaService } from 'src/media/media.service';
import { Media } from 'src/entities/media.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent, Media]),
    MediaModule
  ],
  controllers: [WebhookController]
})
export class WebhookModule {}
