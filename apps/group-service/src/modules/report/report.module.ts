import { Module } from '@nestjs/common';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupReport } from 'src/entities/group-report.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GroupReport])],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
