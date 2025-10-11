import { Global, Module } from '@nestjs/common';
import { StatsBufferService } from './stats.buffer.service';
import { StatsBatchScheduler } from './stats.batch.scheduler';
import { KafkaModule } from '../kafka/kafka.module';

@Global()
@Module({
  imports: [KafkaModule],
  providers: [StatsBufferService, StatsBatchScheduler],
  exports: [StatsBufferService],
})
export class StatsModule {}
