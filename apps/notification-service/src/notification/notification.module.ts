import { Module } from '@nestjs/common';
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
    UserPreferenceModule,
    FirebaseModule,
    BullModule.forRoot({
      redis: {
        host: 'localhost',
        port: 6379,
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
