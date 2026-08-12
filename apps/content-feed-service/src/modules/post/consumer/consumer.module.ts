import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from 'src/entities/comment.entity';
import { Post } from 'src/entities/post.entity';
import { ConsumerController } from './consumer.controller';
import { ConsumerService } from './consumer.service';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Share } from 'src/entities/share.entity';
import {
  IdempotencyModule,
  KafkaConsumerHelper,
  KafkaDLQService,
  KafkaProducerModule,
} from '@repo/common';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, Comment, Share, OutboxEvent]),
    IdempotencyModule.forPostgres(),
    KafkaProducerModule.registerAsync(),
  ],
  controllers: [ConsumerController],
  providers: [ConsumerService, KafkaDLQService, KafkaConsumerHelper],
})
export class PostConsumerModule {}
