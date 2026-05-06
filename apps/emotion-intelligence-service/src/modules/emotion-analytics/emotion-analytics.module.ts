import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InsightModule } from '../insight/insight.module';
import {
  EmotionAnalyticsSnapshot,
  EmotionAnalyticsSnapshotSchema,
} from 'src/mongo/schema/analytic-snapshot.schema';
import { EmotionAnalyticsService } from './emotion-analytics.service';
import { EmotionAnalyticsController } from './emotion-analytics.controller';
import { EmotionAnalyticsRepository } from './emotion-analytics.repository';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: EmotionAnalyticsSnapshot.name,
        schema: EmotionAnalyticsSnapshotSchema,
      },
    ]),
    InsightModule,
  ],
  controllers: [EmotionAnalyticsController],
  providers: [EmotionAnalyticsService, EmotionAnalyticsRepository],
  exports: [EmotionAnalyticsService, EmotionAnalyticsRepository],
})
export class EmotionAnalyticsModule {}
