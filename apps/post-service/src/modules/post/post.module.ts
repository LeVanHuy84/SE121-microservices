import { Module } from '@nestjs/common';
import { PostController } from './post.controller';
import { Post } from 'src/entities/post.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from 'src/entities/comment.entity';
import { Reaction } from 'src/entities/reaction.entity';
import { Share } from 'src/entities/share.entity';
import { EditHisstory } from 'src/entities/edit-history.entity';
import { Report } from 'src/entities/report.entity';
import { PostService } from './post.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, Comment, Reaction, Share, EditHisstory, Report]),
  ],
  controllers: [
    PostController,
  ],
  providers: [PostService]
})
export class PostModule { }
