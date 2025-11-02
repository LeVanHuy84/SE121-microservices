import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '@nestjs-modules/ioredis';
import { GroupCoreModule } from './modules/group-core/group-core.module';
import { GroupMemberModule } from './modules/member/group-member.module';
import dbConfig from './config/db.config';
import { APP_GUARD } from '@nestjs/core';
import { GroupPermissionGuard } from './modules/group-authorization/group-permission.guard';
import { GroupAuthorizationModule } from './modules/group-authorization/group-authorization.module';

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
    // RedisModule.forRoot({
    //   type: 'single',
    //   options: {
    //     host: process.env.POST_REDIS_HOST,
    //     port: process.env.POST_REDIS_PORT
    //       ? parseInt(process.env.POST_REDIS_PORT, 10)
    //       : 6379,
    //   },
    // }),
    GroupAuthorizationModule,
    GroupCoreModule,
    GroupMemberModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
