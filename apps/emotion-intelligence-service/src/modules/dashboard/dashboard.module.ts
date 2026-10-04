import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { DashboardRepository } from './dashboard.repository';
import {
  UserEmotionSnapshot,
  UserEmotionSnapshotSchema,
} from 'src/mongo/schema/emotion-snapshot.schema';
import {
  UserEmotionProfile,
  UserEmotionProfileSchema,
} from 'src/mongo/schema/emotion-profile.schema';
import {
  UserRiskState,
  UserRiskStateSchema,
} from 'src/mongo/schema/user_risk_states.schema';
import {
  EmotionAnalyticsSnapshot,
  EmotionAnalyticsSnapshotSchema,
} from 'src/mongo/schema/analytic-snapshot.schema';
import {
  InterventionResource,
  InterventionResourceSchema,
} from 'src/mongo/schema/intervention-resource.schema';
import {
  EmergencyHotline,
  EmergencyHotlineSchema,
} from 'src/mongo/schema/emergency-hotline.schema';
import {
  InterventionLog,
  InterventionLogSchema,
} from 'src/mongo/schema/intervention-log.schema';
import {
  EmotionFeedback,
  EmotionFeedbackSchema,
} from 'src/mongo/schema/emotion-feedback.schema';
import { InsightModule } from '../insight/insight.module';

@Module({
  imports: [
    MongooseModule.forFeature([
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
        name: EmotionAnalyticsSnapshot.name,
        schema: EmotionAnalyticsSnapshotSchema,
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
      {
        name: EmotionFeedback.name,
        schema: EmotionFeedbackSchema,
      },
    ]),
    InsightModule,
  ],
  controllers: [DashboardController, AdminDashboardController],
  providers: [DashboardService, DashboardRepository, AdminDashboardService],
  exports: [DashboardService, DashboardRepository, AdminDashboardService],
})
export class DashboardModule {}
