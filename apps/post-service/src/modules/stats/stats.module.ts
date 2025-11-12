import { Global, Module, Post } from '@nestjs/common';
import { StatsBufferService } from './stats.buffer.service';
import { StatsBatchScheduler } from './stats.batch.scheduler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { PostGroupInfo } from 'src/entities/post-group-info.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent, PostGroupInfo])],
  providers: [StatsBufferService, StatsBatchScheduler],
  exports: [StatsBufferService],
})
export class StatsModule {}
