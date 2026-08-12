import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Notification,
  NotificationSchema,
} from '../mongo/schema/notification.schema';
import { UserPreferenceModule } from '../user-preference/user-preference.module';
import { NotificationController } from './notification.controller';
import { ChatPushService } from './chat-push.service';
import { NotificationProcessor } from './notification.proccessor';
import { NOTIFICATION_QUEUE } from './notification.jobs';
import { NotificationService } from './notification.service';
import { NotificationDispatcherService } from './services/notification-dispatcher.service';
import { NotificationPolicyService } from './services/notification-policy.service';
import { TemplateService } from './template.service';
import { BullModule } from '@nestjs/bull';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
    ConfigModule,
    UserPreferenceModule,
    FirebaseModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisPort = configService.get<string>('REDIS_PORT');

        return {
          redis: {
            host: configService.get('REDIS_HOST') || 'localhost',
            port: redisPort ? parseInt(redisPort, 10) : 6379,
          },
        };
      },
    }),
    BullModule.registerQueue({
      name: NOTIFICATION_QUEUE,
    }),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationDispatcherService,
    NotificationPolicyService,
    ChatPushService,
    NotificationProcessor,
    TemplateService,
  ],
})
export class NotificationModule {}
