import { Module } from '@nestjs/common';
import { IntentSafetyMatcher } from './intent-safety.matcher';
import { ProactiveInterventionService } from './proactive-intervention.service';
import { InterventionSelectorService } from './intervention-selector.service';
import { ProactiveCron } from './proactive.cron';
import { MusicClientModule } from '../client/music/music-client.module';
import { RabbitmqModule } from '@repo/common';

import { MongooseModule } from '@nestjs/mongoose';
import {
  UserRiskState,
  UserRiskStateSchema,
} from 'src/mongo/schema/user_risk_states.schema';
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

import { ProactiveInterventionController } from './proactive-intervention.controller';

@Module({
  controllers: [ProactiveInterventionController],
  imports: [
    MongooseModule.forFeature([
      { name: UserRiskState.name, schema: UserRiskStateSchema },
      { name: InterventionResource.name, schema: InterventionResourceSchema },
      { name: EmergencyHotline.name, schema: EmergencyHotlineSchema },
      { name: InterventionLog.name, schema: InterventionLogSchema },
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
    InterventionSelectorService,
    ProactiveInterventionService,
    ProactiveCron,
  ],
  exports: [
    IntentSafetyMatcher,
    InterventionSelectorService,
    ProactiveInterventionService,
  ],
})
export class ProactiveInterventionModule {}
