import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ProactiveInterventionController } from './proactive-intervention.controller';
import { ProactiveInterventionService } from './proactive-intervention.service';
import { RiskLevel } from '@repo/dtos';

describe('ProactiveInterventionController', () => {
  let controller: ProactiveInterventionController;
  let service: jest.Mocked<ProactiveInterventionService>;

  beforeEach(async () => {
    const mockService = {
      getUserInterventionHistory: jest.fn(),
      getUserInterventionById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProactiveInterventionController],
      providers: [
        {
          provide: ProactiveInterventionService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ProactiveInterventionController>(
      ProactiveInterventionController,
    );
    service = module.get(ProactiveInterventionService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getUserInterventionHistory', () => {
    it('should delegate to service.getUserInterventionHistory', async () => {
      const mockResult = [{ id: 'log1' }] as any;
      service.getUserInterventionHistory.mockResolvedValue(mockResult);

      const result = await controller.getUserInterventionHistory({
        userId: 'user1',
        limit: 10,
      });

      expect(service.getUserInterventionHistory).toHaveBeenCalledWith('user1', 10);
      expect(result).toBe(mockResult);
    });
  });

  describe('getUserInterventionById', () => {
    it('should delegate to service.getUserInterventionById', async () => {
      const mockResult = { id: 'log1', userId: 'user1' } as any;
      (service.getUserInterventionById as any).mockResolvedValue(mockResult);

      const result = await controller.getUserInterventionById({
        userId: 'user1',
        id: 'log1',
      });

      expect(service.getUserInterventionById).toHaveBeenCalledWith('user1', 'log1');
      expect(result).toBe(mockResult);
    });
  });
});
