import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { NotificationModule } from '@repo/common';
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
import { AiConsumer } from './ai.consumer';
import { AiService } from './ai.service';

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
    NotificationModule.registerAsync({
      useFactory: async (config: ConfigService) => ({
        urls: [
          `amqp://${config.get('RABBITMQ_USER')}:${config.get('RABBITMQ_PASS')}` +
            `@${config.get('RABBITMQ_HOST')}:${config.get('RABBITMQ_PORT')}`,
        ],
        queue: 'create_notification_queue',
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AiService, AiConsumer],
  exports: [AiService],
})
export class AiModule {}
