/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getModelToken } from '@nestjs/mongoose';
import { RiskLevel } from '@repo/dtos';
import { ProactiveCron } from './proactive.cron';
import { UserRiskState } from '../../mongo/schema/user_risk_states.schema';
import { ProactiveInterventionService } from './proactive-intervention.service';

describe('ProactiveCron', () => {
  let cron: ProactiveCron;
  let mockRiskStateModel: any;
  let mockProactiveService: jest.Mocked<ProactiveInterventionService>;

  beforeEach(async () => {
    mockRiskStateModel = {
      find: jest.fn(),
    };

    mockProactiveService = {
      evaluatePassiveUser: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProactiveCron,
        {
          provide: getModelToken(UserRiskState.name),
          useValue: mockRiskStateModel,
        },
        {
          provide: ProactiveInterventionService,
          useValue: mockProactiveService,
        },
      ],
    }).compile();

    cron = module.get<ProactiveCron>(ProactiveCron);
  });

  it('should be defined', () => {
    expect(cron).toBeDefined();
  });

  describe('runDailyProactiveSweep', () => {
    it('should query active risk users and evaluate each user', async () => {
      const mockUsers = [
        { userId: 'user1', riskLevel: RiskLevel.HIGH_RISK },
        { userId: 'user2', riskLevel: RiskLevel.CRISIS },
      ];

      const execMock = jest.fn().mockResolvedValue(mockUsers);
      mockRiskStateModel.find.mockReturnValue({ exec: execMock });

      mockProactiveService.evaluatePassiveUser
        .mockResolvedValueOnce({ userId: 'user1' } as any) // User 1 gets intervention
        .mockResolvedValueOnce(null); // User 2 in cooldown / null

      await cron.runDailyProactiveSweep();

      const { find } = mockRiskStateModel;
      const { evaluatePassiveUser } = mockProactiveService;

      expect(find).toHaveBeenCalledWith({
        riskLevel: {
          $in: [
            RiskLevel.MILD_STRESS,
            RiskLevel.MODERATE_RISK,
            RiskLevel.HIGH_RISK,
            RiskLevel.CRISIS,
          ],
        },
      });
      expect(evaluatePassiveUser).toHaveBeenCalledWith('user1');
      expect(evaluatePassiveUser).toHaveBeenCalledWith('user2');
      expect(evaluatePassiveUser).toHaveBeenCalledTimes(2);
    });

    it('should handle empty active risk users list gracefully', async () => {
      const execMock = jest.fn().mockResolvedValue([]);
      mockRiskStateModel.find.mockReturnValue({ exec: execMock });

      await cron.runDailyProactiveSweep();

      const { evaluatePassiveUser } = mockProactiveService;
      expect(evaluatePassiveUser).not.toHaveBeenCalled();
    });

    it('should catch and log errors if database query fails', async () => {
      const execMock = jest
        .fn()
        .mockRejectedValue(new Error('Database Connection Failed'));
      mockRiskStateModel.find.mockReturnValue({ exec: execMock });

      await expect(cron.runDailyProactiveSweep()).resolves.not.toThrow();
    });
  });
});
