import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { MongoModule } from 'src/mongo/mongo.module';
import {
  EmotionAnalyticsSnapshot,
  EmotionAnalyticsSnapshotSchema,
} from 'src/mongo/schema/analytic-snapshot.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from '@nestjs-modules/ioredis';
import {
  IdempotencyModule,
  KafkaConsumerHelper,
  KafkaDLQService,
  KafkaProducerModule,
} from '@repo/common';

@Module({
  imports: [
    MongoModule,
    MongooseModule.forFeature([
      {
        name: EmotionAnalyticsSnapshot.name,
        schema: EmotionAnalyticsSnapshotSchema,
      },
    ]),
    RedisModule.forRoot({
      type: 'single',
      options: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
          ? parseInt(process.env.REDIS_PORT, 10)
          : 6379,
      },
    }),
    IdempotencyModule.forMongo(),
    KafkaProducerModule.registerAsync(), // để dùng DLQ
  ],
  controllers: [IngestionController],
  providers: [IngestionService, KafkaDLQService, KafkaConsumerHelper],
  exports: [IngestionService],
})
export class IngestionModule {}
