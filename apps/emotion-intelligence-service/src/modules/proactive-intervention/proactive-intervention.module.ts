import { Module } from '@nestjs/common';
import { IntentSafetyMatcher } from './intent-safety.matcher';
import { ProactiveInterventionService } from './proactive-intervention.service';
import { ProactiveCron } from './proactive.cron';
import { MusicClientModule } from '../client/music/music-client.module';
import { RabbitmqModule } from '@repo/common';

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
    RabbitmqModule.register({
      urls: [process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'],
      exchanges: [
        { name: 'notification', type: 'topic' },
        { name: 'broadcast', type: 'fanout' },
      ],
    }),
  ],
  providers: [
    IntentSafetyMatcher,
    ProactiveInterventionService,
    ProactiveCron,
  ],
  exports: [IntentSafetyMatcher, ProactiveInterventionService],
})
export class ProactiveInterventionModule {}
