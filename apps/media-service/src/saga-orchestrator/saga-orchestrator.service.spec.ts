import { Test, TestingModule } from '@nestjs/testing';
import { SagaOrchestratorService } from './saga-orchestrator.service';

describe('SagaOrchestratorService', () => {
  let service: SagaOrchestratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SagaOrchestratorService],
    }).compile();

    service = module.get<SagaOrchestratorService>(SagaOrchestratorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
