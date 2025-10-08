import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Outbox } from 'src/entities/outbox.entity';
import { KafkaModule } from '@repo/common';
import { SagaOrchestratorService } from 'src/saga-orchestrator/saga-orchestrator.service';

@Module({
  imports: [
    KafkaModule.register('media-service'),
    TypeOrmModule.forFeature([Outbox]),
  ],
  providers: [OutboxService],
  exports: [OutboxService]
})
export class OutboxModule {}
