import { Module } from '@nestjs/common';
import { SagaOrchestratorService } from './saga-orchestrator.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Saga } from 'src/entities/saga.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Saga])],
  providers: [SagaOrchestratorService],
  exports: [SagaOrchestratorService]
})
export class SagaOrchestratorModule {}
