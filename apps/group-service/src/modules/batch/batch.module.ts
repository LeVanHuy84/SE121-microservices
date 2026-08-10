import { Global, Module } from '@nestjs/common';
import { GroupBatchService } from './batch.service';
import { GroupBufferService } from './buffer.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent])],
  providers: [GroupBufferService, GroupBatchService],
  exports: [GroupBufferService, GroupBatchService],
})
export class BatchModule {}
