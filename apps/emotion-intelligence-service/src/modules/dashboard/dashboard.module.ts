import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
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
    ]),
    InsightModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository],
  exports: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
