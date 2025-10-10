import { Module } from '@nestjs/common';
import { PostController } from './post.controller';
import { Post } from 'src/entities/post.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Share } from 'src/entities/share.entity';
import { EditHistory } from 'src/entities/edit-history.entity';
import { Report } from 'src/entities/report.entity';
import { PostQueryService } from './post-query.service';
import { PostStat } from 'src/entities/post-stat.entity';
import { PostCommandService } from './post-command.service';
import { Reaction } from 'src/entities/reaction.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';

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
  ],
  controllers: [PostController],
  providers: [PostQueryService, PostCommandService],
})
export class PostModule {}
