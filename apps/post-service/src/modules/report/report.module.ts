import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Report } from 'src/entities/report.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Post } from 'src/entities/post.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Report, OutboxEvent, Post])],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
