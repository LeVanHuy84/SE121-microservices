import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from 'src/entities/comment.entity';
import { Post } from 'src/entities/post.entity';
import { ConsumerController } from './consumer.controller';
import { ConsumerService } from './consumer.service';

@Module({
  imports: [TypeOrmModule.forFeature([Post, Comment])],
  controllers: [ConsumerController],
  providers: [ConsumerService],
})
export class ConsumerModule {}
