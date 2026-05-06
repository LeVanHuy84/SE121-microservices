import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EmotionFeedback,
  EmotionFeedbackSchema,
} from 'src/mongo/schema/emotion-feedback.schema';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { FeedbackRepository } from './feedback.repository';
import { EmotionAnalyticsModule } from '../emotion-analytics/emotion-analytics.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: EmotionFeedback.name,
        schema: EmotionFeedbackSchema,
      },
    ]),
    EmotionAnalyticsModule,
  ],
  controllers: [FeedbackController],
  providers: [FeedbackService, FeedbackRepository],
  exports: [FeedbackService, FeedbackRepository],
})
export class FeedbackModule {}
