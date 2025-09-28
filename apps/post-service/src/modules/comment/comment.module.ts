import { Module } from '@nestjs/common';
import { CommentController } from './comment.controller';
import { CommentService } from './comment.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommentStat } from 'src/entities/comment-stat.entity';
import { Comment } from 'src/entities/comment.entity';
import { UserModule } from '../user/user.module';

@Module({
  imports: [TypeOrmModule.forFeature([Comment, CommentStat]), UserModule],
  controllers: [CommentController],
  providers: [CommentService],
})
export class CommentModule {}
