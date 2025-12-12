import { Module } from '@nestjs/common';
import { PostController } from './controller/post.controller';
import { Post } from 'src/entities/post.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Share } from 'src/entities/share.entity';
import { EditHistory } from 'src/entities/edit-history.entity';
import { Report } from 'src/entities/report.entity';
import { PostQueryService } from './service/post-query.service';
import { PostStat } from 'src/entities/post-stat.entity';
import { PostCommandService } from './service/post-command.service';
import { Reaction } from 'src/entities/reaction.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { PostCacheService } from './service/post-cache.service';
import { SocialClientModule } from '../client/social/social-client.module';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PostGroupController } from './controller/post-group.controller';
import { PostGroupService } from './service/post-group.service';
import { PostGroupInfo } from 'src/entities/post-group-info.entity';
import { OutboxService } from '../event/outbox.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Post,
      Share,
      EditHistory,
      Report,
      PostStat,
      Reaction,
      OutboxEvent,
      PostGroupInfo,
    ]),
    ClientsModule.registerAsync([
      {
        name: 'GROUP_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('GROUP_SERVICE_PORT'),
          },
        }),
      },
    ]),
    SocialClientModule,
  ],
  controllers: [PostController, PostGroupController],
  providers: [
    PostQueryService,
    PostCommandService,
    PostCacheService,
    PostGroupService,
    OutboxService,
  ],
})
export class PostModule {}
