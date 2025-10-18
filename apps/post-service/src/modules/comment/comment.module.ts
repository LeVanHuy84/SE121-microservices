import { Module } from '@nestjs/common';
import { CommentController } from './comment.controller';
import { CommentService } from './service/comment.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommentStat } from 'src/entities/comment-stat.entity';
import { Comment } from 'src/entities/comment.entity';
import { CommentQueryService } from './service/comment-query.service';
import { Reaction } from 'src/entities/reaction.entity';
import { CommentCacheService } from './service/comment-cache.service';

@Module({
  imports: [TypeOrmModule.forFeature([Comment, CommentStat, Reaction])],
  controllers: [CommentController],
  providers: [CommentService, CommentQueryService, CommentCacheService],
})
export class CommentModule {}
