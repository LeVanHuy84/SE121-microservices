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
import { SeedModule } from './modules/seed/seed.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AiModule } from './modules/ai/ai.module';
import { EmotionAnalyticsModule } from './modules/emotion-analytics/emotion-analytics.module';
import { UserClientModule } from './modules/client/user/user-client.module';
import { PostClientModule } from './modules/client/post/post-client.module';

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
    EventEmitterModule.forRoot(),
    MongoModule,
    SnapshotModule,
    ProfileModule,
    InsightModule,
    WarningModule,
    FeedbackModule,
    DashboardModule,
    SeedModule,
    AiModule,
    EmotionAnalyticsModule,
    UserClientModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
