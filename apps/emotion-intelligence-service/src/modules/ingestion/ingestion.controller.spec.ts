import { Test, TestingModule } from '@nestjs/testing';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { KafkaConsumerHelper } from '@repo/common';

describe('IngestionController', () => {
  let controller: IngestionController;

  beforeEach(async () => {
    const mockIngestionService = {};
    const mockConsumerHelper = {};

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IngestionController],
      providers: [
        {
          provide: IngestionService,
          useValue: mockIngestionService,
        },
        {
          provide: KafkaConsumerHelper,
          useValue: mockConsumerHelper,
        },
      ],
    }).compile();

    controller = module.get<IngestionController>(IngestionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
