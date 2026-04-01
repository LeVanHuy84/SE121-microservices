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

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        dbName: 'emotion_intelligence_service',
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
    ]),
  ],
  providers: [],
  exports: [MongooseModule],
})
export class MongoModule {}
