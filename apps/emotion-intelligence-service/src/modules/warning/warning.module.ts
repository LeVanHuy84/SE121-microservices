import { Module } from '@nestjs/common';
import { RiskEvaluationService } from './risk-evaluation.service';
import { WarningProcessor } from './warning.processor';
import { WarningRepository } from './warning.repository';
import { WarningService } from './warning.service';
import { MongooseModule } from '@nestjs/mongoose';
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
  ],
  providers: [
    WarningRepository,
    RiskEvaluationService,
    WarningService,
    WarningProcessor,
  ],
  exports: [
    WarningRepository,
    RiskEvaluationService,
    WarningService,
    WarningProcessor,
  ],
})
export class WarningModule {}
