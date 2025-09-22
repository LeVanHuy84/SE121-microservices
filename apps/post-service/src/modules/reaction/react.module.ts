import { Module } from '@nestjs/common';
import { ReactionController } from './react.controller';
import { ReactionService } from './react.service';
import { Reaction } from 'src/entities/reaction.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from 'src/entities/comment.entity';
import { Post } from 'src/entities/post.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Reaction, Post, Comment])],
  controllers: [ReactionController],
  providers: [ReactionService]
})
export class ReactModule { }
