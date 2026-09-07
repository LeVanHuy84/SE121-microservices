import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import {
  EmotionAnalyticsSnapshot,
  EmotionAnalyticsSnapshotSchema,
} from 'src/mongo/schema/analytic-snapshot.schema';
import { MongooseModule } from '@nestjs/mongoose';
import {
  IdempotencyModule,
  KafkaConsumerHelper,
  KafkaDLQService,
  KafkaProducerModule,
} from '@repo/common';

import { ProactiveInterventionModule } from '../proactive-intervention/proactive-intervention.module';

@Module({
  imports: [
    ProactiveInterventionModule,
    MongooseModule.forFeature([
      {
        name: EmotionAnalyticsSnapshot.name,
        schema: EmotionAnalyticsSnapshotSchema,
      },
    ]),
    IdempotencyModule.forMongo(),
    KafkaProducerModule.registerAsync(), // dùng DLQ
  ],
  controllers: [IngestionController],
  providers: [IngestionService, KafkaDLQService, KafkaConsumerHelper],
  exports: [IngestionService],
})
export class IngestionModule {}
