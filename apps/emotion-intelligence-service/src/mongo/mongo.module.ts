import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config'; // Import ConfigModule and ConfigService
import {
  EmotionAnalyticsSnapshot,
  EmotionAnalyticsSnapshotSchema,
} from './schema/analytic-snapshot.schema';
import {
  UserEmotionSnapshot,
  UserEmotionSnapshotSchema,
} from './schema/emotion-snapshot.schema';
import {
  UserEmotionProfile,
  UserEmotionProfileSchema,
} from './schema/emotion-profile.schema';
import {
  UserRiskState,
  UserRiskStateSchema,
} from './schema/user_risk_states.schema';
import {
  EmotionFeedback,
  EmotionFeedbackSchema,
} from './schema/emotion-feedback.schema';
import {
  InterventionResource,
  InterventionResourceSchema,
} from './schema/intervention-resource.schema';
import {
  EmergencyHotline,
  EmergencyHotlineSchema,
} from './schema/emergency-hotline.schema';
import {
  InterventionLog,
  InterventionLogSchema,
} from './schema/intervention-log.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        dbName: 'emotion_intelligence_service',

        retryWrites: true,
        w: 'majority',
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      {
        name: EmotionAnalyticsSnapshot.name,
        schema: EmotionAnalyticsSnapshotSchema,
      },
      {
        name: UserEmotionSnapshot.name,
        schema: UserEmotionSnapshotSchema,
      },
      {
        name: UserEmotionProfile.name,
        schema: UserEmotionProfileSchema,
      },
      {
        name: UserRiskState.name,
        schema: UserRiskStateSchema,
      },
      {
        name: EmotionFeedback.name,
        schema: EmotionFeedbackSchema,
      },
      {
        name: InterventionResource.name,
        schema: InterventionResourceSchema,
      },
      {
        name: EmergencyHotline.name,
        schema: EmergencyHotlineSchema,
      },
      {
        name: InterventionLog.name,
        schema: InterventionLogSchema,
      },
    ]),
  ],
  providers: [],
  exports: [MongooseModule],
})
export class MongoModule {}
