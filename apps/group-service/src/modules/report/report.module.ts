import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupReport } from 'src/entities/group-report.entity';
import { Group } from 'src/entities/group.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GroupReport, Group, OutboxEvent])],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
