import { Global, Module } from '@nestjs/common';
import { StatsBufferService } from './stats.buffer.service';
import { StatsBatchScheduler } from './stats.batch.scheduler';

@Global()
@Module({
  imports: [],
  providers: [StatsBufferService, StatsBatchScheduler],
  exports: [StatsBufferService],
})
export class StatsModule {}
