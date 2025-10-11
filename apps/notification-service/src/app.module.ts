import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongoModule } from './mongo/mongo.module';
import { NotificationModule } from './notification/notification.module';
import { UserPreferenceModule } from './user-preference/user-preference.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
    }),

    NotificationModule,
    MongoModule,
    UserPreferenceModule,
  ],
})
export class AppModule {}
