import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { IngestionService } from './ingestion.service';
import { getModelToken } from '@nestjs/mongoose';
import { EmotionAnalyticsSnapshot } from '../../mongo/schema/analytic-snapshot.schema';
import { ProactiveInterventionService } from '../proactive-intervention/proactive-intervention.service';

describe('IngestionService', () => {
  let service: IngestionService;

  beforeEach(async () => {
    const mockModel = {};
    const mockRedis = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionService,
        {
          provide: getModelToken(EmotionAnalyticsSnapshot.name),
          useValue: mockModel,
        },
        {
          provide: 'default_IORedisModuleConnectionToken',
          useValue: mockRedis,
        },
        {
          provide: ProactiveInterventionService,
          useValue: {
            evaluateUserRisk: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<IngestionService>(IngestionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
