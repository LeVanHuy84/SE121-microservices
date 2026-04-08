import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Notification,
  NotificationSchema,
} from 'src/mongo/schema/notification.schema';
import { UserPreferenceModule } from 'src/user-preference/user-preference.module';
import { NotificationController } from './notification.controller';
import { ChatPushService } from './chat-push.service';
import { NotificationService } from './notification.service';
import { TemplateService } from './template.service';
import { BullModule } from '@nestjs/bull';
import { FirebaseModule } from 'src/firebase/firebase.module';

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
      name: 'notifications',
    }),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, ChatPushService, TemplateService],
})
export class NotificationModule {}
