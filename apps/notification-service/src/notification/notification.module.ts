import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Notification,
  NotificationSchema,
} from 'src/mongo/schema/notification.schema';
import { UserPreferenceModule } from 'src/user-preference/user-preference.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { RabbitmqModule } from '@repo/common';
import { TemplateService } from './template.service';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    RabbitmqModule.register({
      urls: ['amqp://guest:guest@localhost:5672'], // hoặc 'amqp://rabbitmq:5672' nếu docker
      exchanges: [{ name: 'notification_exchange', type: 'topic' }],
    }),
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
    UserPreferenceModule,
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
  providers: [NotificationService, TemplateService],
})
export class NotificationModule {}
