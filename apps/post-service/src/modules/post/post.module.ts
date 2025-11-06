import { Module } from '@nestjs/common';
import { PostController } from './post.controller';
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
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PostCacheService } from './service/post-cache.service';
import { SocialClientModule } from '../client/social/social-client.module';

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
    ]),
    SocialClientModule,
  ],
  controllers: [PostController],
  providers: [PostQueryService, PostCommandService, PostCacheService],
})
export class PostModule {}
