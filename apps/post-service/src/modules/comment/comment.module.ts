import { Module } from '@nestjs/common';
import { CommentController } from './comment.controller';
import { CommentService } from './comment.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommentStat } from 'src/entities/comment-stat.entity';
import { Comment } from 'src/entities/comment.entity';
import { CommentQueryService } from './comment-query.service';
import { Reaction } from 'src/entities/reaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Comment, CommentStat, Reaction])],
  controllers: [CommentController],
  providers: [CommentService, CommentQueryService],
})
export class CommentModule {}
