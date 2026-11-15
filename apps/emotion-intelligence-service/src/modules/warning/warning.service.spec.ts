import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { RiskLevel } from '@repo/dtos';
import { WarningService } from './warning.service';
import { WarningRepository } from './warning.repository';
import { RiskEvaluationService } from './risk-evaluation.service';

describe('WarningService', () => {
  let service: WarningService;
  let mockWarningRepository: jest.Mocked<WarningRepository>;
  let mockRiskEvaluationService: jest.Mocked<RiskEvaluationService>;
  let mockPipeline: {
    hset: jest.Mock<any>;
    expire: jest.Mock<any>;
    exec: jest.Mock<any>;
  };
  let mockRedis: { pipeline: jest.Mock<any> };

  beforeEach(async () => {
    mockWarningRepository = {
      findLatestSnapshot1d: jest.fn<any>(),
      findProfileSignals: jest.fn<any>(),
      findRiskState: jest.fn<any>(),
      upsertRiskState: jest.fn<any>().mockResolvedValue(undefined),
    } as any;

    mockRiskEvaluationService = {
      isSpike: jest.fn<any>().mockReturnValue(false),
      applySpikeOverride: jest.fn<any>(),
      computeNextLevel: jest.fn<any>().mockReturnValue(RiskLevel.HIGH_RISK),
      shouldNotify: jest.fn<any>().mockReturnValue(true),
    } as any;

    mockPipeline = {
      hset: jest.fn<any>().mockReturnThis(),
      expire: jest.fn<any>().mockReturnThis(),
      exec: jest.fn<any>().mockResolvedValue([]),
    };
    mockRedis = {
      pipeline: jest.fn<any>().mockReturnValue(mockPipeline),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarningService,
        { provide: WarningRepository, useValue: mockWarningRepository },
        {
          provide: RiskEvaluationService,
          useValue: mockRiskEvaluationService,
        },
        {
          provide: getRedisConnectionToken(),
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<WarningService>(WarningService);
  });

  it('writes longitudinal fields to emotion:longitudinal:{userId} via HSET + EXPIRE', async () => {
    mockWarningRepository.findLatestSnapshot1d.mockResolvedValue({
      riskScore: 0.78,
    });
    mockWarningRepository.findProfileSignals.mockResolvedValue({
      consecutiveNegativeDays: 4,
    });
    mockWarningRepository.findRiskState.mockResolvedValue({
      userId: 'user-1',
      riskLevel: RiskLevel.MODERATE_RISK,
      riskScore: 0.65,
      stableWindows: 2,
      previousRiskScore: 0.6,
    });

    const result = await service.evaluateUserRisk('user-1');

    expect(result.riskLevel).toBe(RiskLevel.HIGH_RISK);
    expect(mockRedis.pipeline).toHaveBeenCalledTimes(1);
    expect(mockPipeline.hset).toHaveBeenCalledWith(
      'emotion:longitudinal:user-1',
      expect.objectContaining({
        hysteresis_risk_level: RiskLevel.HIGH_RISK,
        risk_score: '0.78',
        stable_windows: '1',
        consecutive_negative_days: '4',
        persistent_distress: 'true',
      }),
    );
    expect(mockPipeline.expire).toHaveBeenCalledWith(
      'emotion:longitudinal:user-1',
      86400,
    );
    expect(mockPipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('resets suggested_action and chatbot_prompt_context when risk level recovers to NORMAL', async () => {
    mockRiskEvaluationService.computeNextLevel.mockReturnValueOnce(
      RiskLevel.NORMAL,
    );
    mockWarningRepository.findLatestSnapshot1d.mockResolvedValue({
      riskScore: 0.1,
    });
    mockWarningRepository.findProfileSignals.mockResolvedValue({
      consecutiveNegativeDays: 0,
    });
    mockWarningRepository.findRiskState.mockResolvedValue({
      userId: 'user-1',
      riskLevel: RiskLevel.NORMAL,
      riskScore: 0.12,
      stableWindows: 3,
      previousRiskScore: 0.15,
    });

    const result = await service.evaluateUserRisk('user-1');

    expect(result.riskLevel).toBe(RiskLevel.NORMAL);
    expect(mockPipeline.hset).toHaveBeenCalledWith(
      'emotion:longitudinal:user-1',
      expect.objectContaining({
        hysteresis_risk_level: RiskLevel.NORMAL,
        persistent_distress: 'false',
        suggested_action: 'NO_ACTION',
        chatbot_prompt_context: '',
      }),
    );
  });
});
