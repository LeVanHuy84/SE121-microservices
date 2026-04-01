import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongoModule } from './mongo/mongo.module';
import { SnapshotModule } from './modules/snapshot/snapshot.module';
import { ProfileModule } from './modules/profile/profile.module';
import { InsightModule } from './modules/insight/insight.module';
import { WarningModule } from './modules/warning/warning.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
    }),
    RedisModule.forRoot({
      type: 'single',
      options: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
          ? parseInt(process.env.REDIS_PORT, 10)
          : 6379,
      },
    }),
    ScheduleModule.forRoot(),
    MongoModule,
    SnapshotModule,
    ProfileModule,
    InsightModule,
    WarningModule,
    FeedbackModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
