import { Global, Module } from '@nestjs/common';
import { StatsBufferService } from './stats.buffer.service';
import { StatsBatchScheduler } from './stats.batch.scheduler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Post } from 'src/entities/post.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent, Post])],
  providers: [StatsBufferService, StatsBatchScheduler],
  exports: [StatsBufferService],
})
export class StatsModule {}
