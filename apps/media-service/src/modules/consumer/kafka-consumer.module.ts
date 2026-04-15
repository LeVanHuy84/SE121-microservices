import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { Media } from 'src/entities/media.entity';
import { KafkaConsumerController } from './kafka-consumer.controller';
import { MediaConsumerService } from './media-consumer.service';
import {
  IdempotencyModule,
  KafkaConsumerHelper,
  KafkaDLQService,
  KafkaProducerModule,
} from '@repo/common';

@Module({
  imports: [
    CloudinaryModule,
    TypeOrmModule.forFeature([Media]),
    IdempotencyModule.forPostgres(),
    KafkaProducerModule.registerAsync(),
  ],
  controllers: [KafkaConsumerController],
  providers: [MediaConsumerService, KafkaDLQService, KafkaConsumerHelper],
})
export class KafkaConsumerModule {}
