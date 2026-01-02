import { Module } from '@nestjs/common';
import { CommentController } from './comment.controller';
import { CommentService } from './service/comment.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommentStat } from 'src/entities/comment-stat.entity';
import { Comment } from 'src/entities/comment.entity';
import { CommentQueryService } from './service/comment-query.service';
import { Reaction } from 'src/entities/reaction.entity';
import { CommentCacheService } from './service/comment-cache.service';
import { UserClientModule } from '../client/user/user-client.module';
import { OutboxService } from '../event/outbox.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Comment, CommentStat, Reaction]),
    UserClientModule,
  ],
  controllers: [CommentController],
  providers: [
    CommentService,
    CommentQueryService,
    CommentCacheService,
    OutboxService,
  ],
})
export class CommentModule {}
