import { Module } from '@nestjs/common';
import { SagaOrchestratorService } from './saga-orchestrator.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Saga } from 'src/entities/saga.entity';
import { Media } from 'src/entities/media.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Saga, Media])],
  providers: [SagaOrchestratorService],
  exports: [SagaOrchestratorService]
})
export class SagaOrchestratorModule {}
