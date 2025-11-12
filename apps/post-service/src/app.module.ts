import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostModule } from './modules/post/post.module';
import { ReactionModule } from './modules/reaction/reaction.module';
import { CommentModule } from './modules/comment/comment.module';
import { ShareModule } from './modules/share/share.module';
import dbConfig from './config/db.config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { StatsModule } from './modules/stats/stats.module';
import { ScheduleModule } from '@nestjs/schedule';
import { EventModule } from './modules/event/event.module';
import { ReportModule } from './modules/report/report.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      load: [dbConfig],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: dbConfig,
    }),
    RedisModule.forRoot({
      type: 'single',
      options: {
        host: process.env.POST_REDIS_HOST,
        port: process.env.POST_REDIS_PORT
          ? parseInt(process.env.POST_REDIS_PORT, 10)
          : 6379,
      },
    }),
    ScheduleModule.forRoot(),
    PostModule,
    ReactionModule,
    CommentModule,
    ShareModule,
    EventModule,
    StatsModule,
    ReportModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
