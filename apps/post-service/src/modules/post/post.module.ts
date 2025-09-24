import { Module } from '@nestjs/common';
import { PostController } from './post.controller';
import { Post } from 'src/entities/post.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Share } from 'src/entities/share.entity';
import { EditHistory } from 'src/entities/edit-history.entity';
import { Report } from 'src/entities/report.entity';
import { PostService } from './post.service';
import { PostStat } from 'src/entities/post-stat.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, Share, EditHistory, Report, PostStat]),
  ],
  controllers: [PostController],
  providers: [PostService],
})
export class PostModule {}
