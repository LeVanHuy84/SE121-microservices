import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Report } from 'src/entities/report.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Post } from 'src/entities/post.entity';
import { ReadReportService } from './read-report.service';
import { PostStat } from 'src/entities/post-stat.entity';
import { CommentStat } from 'src/entities/comment-stat.entity';
import { ShareStat } from 'src/entities/share-stat.entity';
import { UserClientModule } from '../client/user/user-client.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Report,
      OutboxEvent,
      Post,
      PostStat,
      CommentStat,
      ShareStat,
    ]),
    UserClientModule,
  ],
  controllers: [ReportController],
  providers: [ReportService, ReadReportService],
})
export class ReportModule {}
