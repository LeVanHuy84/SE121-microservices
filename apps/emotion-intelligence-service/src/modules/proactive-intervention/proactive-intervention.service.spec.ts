import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getModelToken } from '@nestjs/mongoose';
import {
  AnalysisResultEventPayload,
  ModerationAction,
  ModerationLabel,
  RiskLevel,
  TriggerFlag,
} from '@repo/dtos';
import { ProactiveInterventionService } from './proactive-intervention.service';
import { UserRiskState } from '../../mongo/schema/user_risk_states.schema';
import { InterventionResource } from '../../mongo/schema/intervention-resource.schema';
import { EmergencyHotline } from '../../mongo/schema/emergency-hotline.schema';
import { IntentSafetyMatcher } from './intent-safety.matcher';
import { InterventionSelectorService } from './intervention-selector.service';
import { MusicClientService } from '../client/music/music-client.service';

import { InterventionLog } from '../../mongo/schema/intervention-log.schema';

describe('ProactiveInterventionService', () => {
  let service: ProactiveInterventionService;
  let mockRiskStateModel: any;
  let mockResourceModel: any;
  let mockHotlineModel: any;
  let mockLogModel: any;
  let mockIntentSafetyMatcher: jest.Mocked<IntentSafetyMatcher>;
  let mockSelectorService: jest.Mocked<InterventionSelectorService>;
  let mockMusicClientService: jest.Mocked<MusicClientService>;
  let mockRabbitmqChannel: any;

  beforeEach(async () => {
    mockRiskStateModel = {
      findOne: jest.fn<any>(),
      updateOne: jest.fn<any>().mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue({ acknowledged: true }),
      }),
    };

    mockResourceModel = {
      find: jest.fn<any>(),
    };

    mockHotlineModel = {
      find: jest.fn<any>(),
    };

    mockLogModel = jest.fn<any>().mockImplementation((dto: any) => ({
      ...dto,
      save: jest.fn<any>().mockResolvedValue({ _id: 'log123', ...dto }),
    }));
    mockLogModel.find = jest.fn<any>();
    mockLogModel.findOneAndUpdate = jest.fn<any>();
    mockLogModel.countDocuments = jest.fn<any>();

    mockIntentSafetyMatcher = {
      matchesEmergencyIntent: jest.fn<any>(),
      evaluateEmergencySafety: jest.fn<any>(),
    } as any;

    mockSelectorService = {
      selectBestResource: jest.fn<any>(),
      dispatchHotlines: jest.fn<any>(),
    } as any;

    mockMusicClientService = {
      getRelaxingMusicBySignal: jest.fn<any>(),
    } as any;

    mockRabbitmqChannel = {
      publish: jest.fn<any>().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProactiveInterventionService,
        {
          provide: getModelToken(UserRiskState.name),
          useValue: mockRiskStateModel,
        },
        {
          provide: getModelToken(InterventionResource.name),
          useValue: mockResourceModel,
        },
        {
          provide: getModelToken(EmergencyHotline.name),
          useValue: mockHotlineModel,
        },
        {
          provide: getModelToken(InterventionLog.name),
          useValue: mockLogModel,
        },
        {
          provide: IntentSafetyMatcher,
          useValue: mockIntentSafetyMatcher,
        },
        {
          provide: InterventionSelectorService,
          useValue: mockSelectorService,
        },
        {
          provide: MusicClientService,
          useValue: mockMusicClientService,
        },
        {
          provide: 'RABBITMQ_CHANNEL',
          useValue: mockRabbitmqChannel,
        },
      ],
    }).compile();

    service = module.get<ProactiveInterventionService>(
      ProactiveInterventionService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('evaluateFromEvent', () => {
    it('should return null when payload indicates NORMAL risk level and no crisis triggers', async () => {
      mockIntentSafetyMatcher.matchesEmergencyIntent.mockReturnValue(false);

      const payload: AnalysisResultEventPayload = {
        userId: 'user1',
        content: 'Today is a great day',
        mentalHealthRiskLevel: 'LOW',
      } as any;

      const result = await service.evaluateFromEvent('user1', payload);

      expect(result).toBeNull();
      expect(mockRiskStateModel.updateOne).not.toHaveBeenCalled();
    });

    it('should evaluate as CRISIS when emergency keywords match in text', async () => {
      mockIntentSafetyMatcher.matchesEmergencyIntent.mockReturnValue(true);
      mockHotlineModel.find.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue([]),
      });
      mockSelectorService.dispatchHotlines.mockReturnValue({
        primary: undefined,
        secondary: [],
      });

      const payload: AnalysisResultEventPayload = {
        userId: 'user1',
        content: 'Tôi muốn tự tử',
        mentalHealthRiskLevel: 'low',
      } as any;

      const result = await service.evaluateFromEvent('user1', payload);

      expect(result).toBeDefined();
      expect(result?.riskLevel).toBe(RiskLevel.CRISIS);
      expect(result?.triggers).toContain(TriggerFlag.SUICIDAL_IDEATION);
      expect(result?.suggestedAction).toBe('CRISIS_HOTLINE');
      expect(mockRiskStateModel.updateOne).toHaveBeenCalledWith(
        { userId: 'user1' },
        expect.objectContaining({
          $set: expect.objectContaining({
            lastInterventionType: 'CRISIS_HOTLINE',
          }),
        }),
      );
      expect(mockRabbitmqChannel.publish).toHaveBeenCalledWith(
        'notification',
        'proactive.intervention',
        result,
      );
    });

    it('should evaluate as CRISIS when moderation contains SELF_HARM category violation', async () => {
      mockIntentSafetyMatcher.matchesEmergencyIntent.mockReturnValue(false);
      mockHotlineModel.find.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue([]),
      });
      mockSelectorService.dispatchHotlines.mockReturnValue({
        primary: undefined,
        secondary: [],
      });

      const payload: AnalysisResultEventPayload = {
        userId: 'user1',
        content: 'Image with text',
        moderation: {
          action: (ModerationAction as any).BLOCK || 'BLOCK',
          violations: [{ category: 'SELF_HARM', confidence: 0.99 }],
        },
      } as any;

      const result = await service.evaluateFromEvent('user1', payload);

      expect(result?.riskLevel).toBe(RiskLevel.CRISIS);
    });

    it('should evaluate as HIGH_RISK when AI risk level is "high" or "critical"', async () => {
      mockIntentSafetyMatcher.matchesEmergencyIntent.mockReturnValue(false);
      const mockResource = {
        _id: 'res1',
        title: 'Depression Resource',
        description: 'Resource desc',
        targetRiskLevels: [RiskLevel.HIGH_RISK],
        mediaType: 'INFOGRAPHIC',
      };
      mockResourceModel.find.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue([mockResource]),
      });
      mockSelectorService.selectBestResource.mockResolvedValue(
        mockResource as any,
      );

      const payload: AnalysisResultEventPayload = {
        userId: 'user1',
        content: 'Tôi thấy bế tắc kéo dài',
        mentalHealthRiskLevel: 'HIGH',
      } as any;

      const result = await service.evaluateFromEvent('user1', payload);

      expect(result?.riskLevel).toBe(RiskLevel.HIGH_RISK);
      expect(result?.triggers).toContain(TriggerFlag.LONG_TERM_SADNESS);
      expect(result?.suggestedAction).toBe('MEDICAL_DOCUMENT');
      expect(result?.resource?.id).toBe('res1');
    });

    it('should evaluate as HIGH_RISK when moderation label is EMOTIONAL_CRISIS', async () => {
      mockIntentSafetyMatcher.matchesEmergencyIntent.mockReturnValue(false);
      mockResourceModel.find.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue([]),
      });
      mockSelectorService.selectBestResource.mockResolvedValue(null);

      const payload: AnalysisResultEventPayload = {
        userId: 'user1',
        content: 'Deep sadness',
        moderation: {
          action: ModerationAction.ALLOW,
          label: (ModerationLabel as any).EMOTIONAL_CRISIS || 'EMOTIONAL_CRISIS',
        },
      } as any;

      const result = await service.evaluateFromEvent('user1', payload);

      expect(result?.riskLevel).toBe(RiskLevel.HIGH_RISK);
    });
  });

  describe('evaluateFromChatbotCrisis', () => {
    it('should evaluate as CRISIS when chatbot reports HIGH or CRITICAL risk level', async () => {
      mockHotlineModel.find.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue([]),
      });
      mockSelectorService.dispatchHotlines.mockReturnValue({
        primary: undefined,
        secondary: [],
      });
      mockResourceModel.find.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue([]),
      });
      mockSelectorService.selectBestResource.mockResolvedValue(null);

      const payload: any = {
        userId: 'user1',
        riskLevel: 'high',
        reason: 'User mentioned sadness',
      };

      const result = await service.evaluateFromChatbotCrisis(payload);

      expect(result).toBeDefined();
      expect(result?.riskLevel).toBe(RiskLevel.HIGH_RISK);
      expect(result?.triggers).toContain(TriggerFlag.LONG_TERM_SADNESS);
      expect(mockRabbitmqChannel.publish).toHaveBeenCalled();
    });

    it('should default to CRISIS when chatbot reports other/extreme levels', async () => {
      mockHotlineModel.find.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue([]),
      });
      mockSelectorService.dispatchHotlines.mockReturnValue({
        primary: undefined,
        secondary: [],
      });

      const payload: any = {
        userId: 'user1',
        riskLevel: 'crisis',
        reason: 'User is in immediate danger',
      };

      const result = await service.evaluateFromChatbotCrisis(payload);

      expect(result).toBeDefined();
      expect(result?.riskLevel).toBe(RiskLevel.CRISIS);
      expect(result?.triggers).toContain(TriggerFlag.SUICIDAL_IDEATION);
      expect(mockRabbitmqChannel.publish).toHaveBeenCalled();
    });
  });

  describe('evaluatePassiveUser & Cooldown logic', () => {
    it('should return null if user risk state is not found in DB', async () => {
      mockRiskStateModel.findOne.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue(null),
      });

      const result = await service.evaluatePassiveUser('user1');
      expect(result).toBeNull();
    });

    it('should return null if riskLevel in DB is NORMAL', async () => {
      mockRiskStateModel.findOne.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue({
          userId: 'user1',
          riskLevel: RiskLevel.NORMAL,
        }),
      });

      const result = await service.evaluatePassiveUser('user1');
      expect(result).toBeNull();
    });

    it('should return null if spam cooldown is currently active for CRISIS risk (< 15 mins)', async () => {
      const recentTime = new Date(Date.now() - 5 * 60 * 1000); // 5 mins ago
      mockRiskStateModel.findOne.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue({
          userId: 'user1',
          riskLevel: RiskLevel.CRISIS,
          lastInterventionAt: recentTime,
        }),
      });

      const result = await service.evaluatePassiveUser('user1');
      expect(result).toBeNull();
    });

    it('should proceed if spam cooldown expired for CRISIS risk (>= 15 mins)', async () => {
      const pastTime = new Date(Date.now() - 20 * 60 * 1000); // 20 mins ago
      mockRiskStateModel.findOne.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue({
          userId: 'user1',
          riskLevel: RiskLevel.CRISIS,
          riskScore: 0.95,
          riskTriggers: [TriggerFlag.SUICIDAL_IDEATION],
          lastInterventionAt: pastTime,
        }),
      });

      mockHotlineModel.find.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue([]),
      });
      mockSelectorService.dispatchHotlines.mockReturnValue({
        primary: undefined,
        secondary: [],
      });

      const result = await service.evaluatePassiveUser('user1');

      expect(result).toBeDefined();
      expect(result?.riskLevel).toBe(RiskLevel.CRISIS);
    });

    it('should return null if spam cooldown active for HIGH_RISK (< 60 mins)', async () => {
      const recentTime = new Date(Date.now() - 30 * 60 * 1000); // 30 mins ago
      mockRiskStateModel.findOne.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue({
          userId: 'user1',
          riskLevel: RiskLevel.HIGH_RISK,
          lastInterventionAt: recentTime,
        }),
      });

      const result = await service.evaluatePassiveUser('user1');
      expect(result).toBeNull();
    });

    it('should return null if spam cooldown active for MILD_STRESS / MODERATE_RISK (< 120 mins)', async () => {
      const recentTime = new Date(Date.now() - 90 * 60 * 1000); // 90 mins ago
      mockRiskStateModel.findOne.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue({
          userId: 'user1',
          riskLevel: RiskLevel.MILD_STRESS,
          lastInterventionAt: recentTime,
        }),
      });

      const result = await service.evaluatePassiveUser('user1');
      expect(result).toBeNull();
    });
  });

  describe('buildInterventionResponse', () => {
    it('MILD_STRESS - should query relaxing music from MusicClientService', async () => {
      const mockMusic = [{ id: 'm1', title: 'Relaxing Rain' }];
      mockMusicClientService.getRelaxingMusicBySignal.mockResolvedValue(
        mockMusic as any,
      );

      const result = await service.buildInterventionResponse(
        'user1',
        RiskLevel.MILD_STRESS,
        0.5,
        [(TriggerFlag as any).STRESS_SPIKE || ('ANXIETY_ATTACK' as any)],
      );

      expect(result?.suggestedAction).toBe('PLAYLIST_AND_TIPS');
      expect(result?.musicSuggestions).toEqual(mockMusic);
    });

    it('MILD_STRESS - should handle missing MusicClientService gracefully', async () => {
      const serviceWithoutMusic = new ProactiveInterventionService(
        mockRiskStateModel,
        mockResourceModel,
        mockHotlineModel,
        mockLogModel,
        mockIntentSafetyMatcher,
        mockSelectorService,
        undefined, // musicClientService undefined
        mockRabbitmqChannel,
      );

      const result = await serviceWithoutMusic.buildInterventionResponse(
        'user1',
        RiskLevel.MILD_STRESS,
        0.5,
      );

      expect(result?.suggestedAction).toBe('PLAYLIST_AND_TIPS');
      expect(result?.musicSuggestions).toEqual([]);
    });

    it('CRISIS - should build hotline info using primary and secondary hotlines', async () => {
      const mockPrimary = {
        _id: 'p1',
        organizationName: 'National Center',
        hotlineNumber: '111',
        is247: true,
        operatingHours: '24/7',
        isPrimary: true,
      };

      const mockSecondary = [
        {
          _id: 's1',
          organizationName: 'Local Line',
          hotlineNumber: '115',
          is247: true,
          operatingHours: '24/7',
          isPrimary: false,
        },
      ];

      mockHotlineModel.find.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue([...mockSecondary, mockPrimary]),
      });
      mockSelectorService.dispatchHotlines.mockReturnValue({
        primary: mockPrimary as any,
        secondary: mockSecondary as any,
      });

      const result = await service.buildInterventionResponse(
        'user1',
        RiskLevel.CRISIS,
        0.95,
      );

      expect(result?.suggestedAction).toBe('CRISIS_HOTLINE');
      expect(result?.hotlineInfo?.number).toBe('111');
      expect(result?.hotlineInfo?.organization).toBe('National Center');
      expect(result?.hotlineInfo?.primaryHotline?.id).toBe('p1');
      expect(result?.hotlineInfo?.secondaryHotlines).toHaveLength(1);
    });

    it('CRISIS - should return default 115 emergency hotline if primary hotline is null/undefined', async () => {
      mockHotlineModel.find.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue([]),
      });
      mockSelectorService.dispatchHotlines.mockReturnValue({
        primary: undefined,
        secondary: [],
      });

      const result = await service.buildInterventionResponse(
        'user1',
        RiskLevel.CRISIS,
        0.95,
      );

      expect(result?.hotlineInfo?.number).toBe('115');
      expect(result?.hotlineInfo?.organization).toBe('Cấp cứu Khẩn cấp 115');
    });

    it('Default case - should return null for unknown risk level', async () => {
      const result = await service.buildInterventionResponse(
        'user1',
        'UNKNOWN_RISK' as any,
        0.5,
      );

      expect(result).toBeNull();
    });
  });

  describe('RabbitMQ Error Handling', () => {
    it('should catch and log rabbitmq publish errors without throwing', async () => {
      mockRabbitmqChannel.publish.mockRejectedValue(
        new Error('RabbitMQ connection lost'),
      );
      mockIntentSafetyMatcher.matchesEmergencyIntent.mockReturnValue(true);
      mockHotlineModel.find.mockReturnValue({
        exec: jest.fn<any>().mockResolvedValue([]),
      });
      mockSelectorService.dispatchHotlines.mockReturnValue({
        primary: undefined,
        secondary: [],
      });

      const payload: AnalysisResultEventPayload = {
        userId: 'user1',
        content: 'Tôi muốn tự tử',
      } as any;

      await expect(
        service.evaluateFromEvent('user1', payload),
      ).resolves.not.toThrow();
    });
  });

  describe('Intervention Audit Logs & User History', () => {
    it('getUserInterventionHistory - should query logs by userId sorted by createdAt DESC', async () => {
      const mockLogs = [
        { _id: 'log1', userId: 'user1', riskLevel: RiskLevel.HIGH_RISK },
      ];
      const limitMock = { exec: jest.fn<any>().mockResolvedValue(mockLogs) };
      const sortMock = { limit: jest.fn<any>().mockReturnValue(limitMock) };
      mockLogModel.find.mockReturnValue({
        sort: jest.fn<any>().mockReturnValue(sortMock),
      });

      const result = await service.getUserInterventionHistory('user1', 10);

      expect(mockLogModel.find).toHaveBeenCalledWith({ userId: 'user1' });
      expect(result).toEqual(mockLogs);
    });

    it('getUserInterventionById - should return intervention log by id for owner user', async () => {
      const mockLog = {
        _id: 'log1',
        userId: 'user1',
        riskLevel: RiskLevel.HIGH_RISK,
      };
      const execMock = jest.fn<any>().mockResolvedValue(mockLog);
      mockLogModel.findOne = jest.fn<any>().mockReturnValue({ exec: execMock });

      const result = await service.getUserInterventionById('user1', 'log1');

      expect(mockLogModel.findOne).toHaveBeenCalledWith({
        _id: 'log1',
        userId: 'user1',
      });
      expect(result).toEqual(mockLog);
    });
  });
});
