import { Module } from '@nestjs/common';
import { IntentSafetyMatcher } from './intent-safety.matcher';
import { ProactiveInterventionService } from './proactive-intervention.service';
import { ProactiveCron } from './proactive.cron';
import { MusicClientModule } from '../client/music/music-client.module';
import { KafkaProducerModule } from '@repo/common';

import { MongooseModule } from '@nestjs/mongoose';
import {
  UserRiskState,
  UserRiskStateSchema,
} from 'src/mongo/schema/user_risk_states.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserRiskState.name, schema: UserRiskStateSchema },
    ]),
    MusicClientModule,
    KafkaProducerModule.registerAsync(),
  ],
  providers: [
    IntentSafetyMatcher,
    ProactiveInterventionService,
    ProactiveCron,
  ],
  exports: [IntentSafetyMatcher, ProactiveInterventionService],
})
export class ProactiveInterventionModule {}
