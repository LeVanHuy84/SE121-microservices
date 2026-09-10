import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { EmotionFeatureController } from '../src/modules/insight/emotion-feature/emotion-feature.controller';
import { EmotionFeatureService } from '../src/modules/insight/emotion-feature/emotion-feature.service';
import { DashboardController } from '../src/modules/dashboard/dashboard.controller';
import { DashboardService } from '../src/modules/dashboard/dashboard.service';
import { IngestionController } from '../src/modules/ingestion/ingestion.controller';
import { IngestionService } from '../src/modules/ingestion/ingestion.service';
import { KafkaConsumerHelper } from '@repo/common';
import { AnalysisEventType, TargetType, ModerationAction } from '@repo/dtos';

describe('EmotionIntelligenceService (E2E Integration Test Suite)', () => {
  let app: INestApplication;
  let emotionFeatureController: EmotionFeatureController;
  let dashboardController: DashboardController;
  let ingestionController: IngestionController;

  const mockEmotionFeatureService = {
    getUserEmotionFeatures: jest.fn().mockResolvedValue({
      userEmotionPreference: { joy: 0.8, sadness: 0.2 },
      negativeRatio7d: 0.2,
      riskScore: 0.1,
    }),
    getUserEmotionSignal: jest.fn().mockResolvedValue({
      riskLevel: 'NORMAL',
      riskScore: 0.1,
      negativity: 0.2,
    }),
  };

  const mockDashboardService = {
    getSummary: jest.fn().mockResolvedValue({
      riskLevel: 'NORMAL',
      riskScore: 0.1,
      dominantEmotion: 'JOY',
    }),
    getTrend: jest.fn().mockResolvedValue({
      data: [{ negativeRatio: 0.2, timestamp: new Date() }],
      current: 0.2,
      previous: 0.1,
      trend: 0.1,
      baseline: 0.15,
    }),
    getDistribution: jest.fn().mockResolvedValue({
      distribution: { joy: 0.8, sadness: 0.2 },
      dominantEmotion: 'JOY',
    }),
    getInsights: jest
      .fn()
      .mockResolvedValue([
        { type: 'STABLE_STATE', message: 'Tâm trạng ổn định', tone: 'STABLE' },
      ]),
    getHistory: jest.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
    }),
  };

  const mockIngestionService = {
    handleCreated: jest.fn().mockResolvedValue(true),
    handleUpdated: jest.fn().mockResolvedValue(true),
    handleModeration: jest.fn().mockResolvedValue(true),
  };

  const mockKafkaConsumerHelper = {
    handle: jest.fn().mockImplementation(async (opts) => {
      await opts.handler(null);
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [
        EmotionFeatureController,
        DashboardController,
        IngestionController,
      ],
      providers: [
        { provide: EmotionFeatureService, useValue: mockEmotionFeatureService },
        { provide: DashboardService, useValue: mockDashboardService },
        { provide: IngestionService, useValue: mockIngestionService },
        { provide: KafkaConsumerHelper, useValue: mockKafkaConsumerHelper },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    emotionFeatureController = moduleFixture.get<EmotionFeatureController>(
      EmotionFeatureController,
    );
    dashboardController =
      moduleFixture.get<DashboardController>(DashboardController);
    ingestionController =
      moduleFixture.get<IngestionController>(IngestionController);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Emotion Feature RPC Patterns (get_emotion_ranking_features & get_user_emotion_signal)', () => {
    it('should return emotion ranking features for Feed Service', async () => {
      const result = await emotionFeatureController.getEmotionRankingFeatures({
        userId: 'user-123',
      });
      expect(result).toBeDefined();
      expect(result.userEmotionPreference.joy).toBe(0.8);
      expect(
        mockEmotionFeatureService.getUserEmotionFeatures,
      ).toHaveBeenCalledWith('user-123');
    });

    it('should return user emotion signal summary', async () => {
      const result = await emotionFeatureController.getUserEmotionSignal({
        userId: 'user-123',
      });
      expect(result).toBeDefined();
      expect(result.riskScore).toBe(0.1);
      expect(
        mockEmotionFeatureService.getUserEmotionSignal,
      ).toHaveBeenCalledWith('user-123');
    });
  });

  describe('2. Dashboard RPC Patterns (dashboard.get_*)', () => {
    it('should handle dashboard.get_summary RPC request', async () => {
      const res = await dashboardController.getSummary({ userId: 'user-123' });
      expect(res.riskScore).toBe(0.1);
      expect(res.dominantEmotion).toBe('JOY');
    });

    it('should handle dashboard.get_trend RPC request', async () => {
      const res = await dashboardController.getTrend({
        userId: 'user-123',
        window: '7d',
      } as any);
      expect(res.data).toHaveLength(1);
    });

    it('should handle dashboard.get_distribution RPC request', async () => {
      const res = await dashboardController.getDistribution({
        userId: 'user-123',
        window: '7d',
      } as any);
      expect(res.distribution.joy).toBe(0.8);
    });
  });

  describe('3. Ingestion Event Consumers (Kafka Events)', () => {
    it('should ingest EMOTION_RESULT event (CREATED)', async () => {
      const kafkaMessage: any = {
        type: AnalysisEventType.CREATED,
        payload: {
          userId: 'user-123',
          targetId: 'post-999',
          targetType: TargetType.POST,
          primaryEmotion: 'JOY',
          secondaryEmotions: ['SURPRISE'],
          scores: { joy: 0.9 },
          confidence: 0.95,
          isSarcasmOrConflict: false,
          mentalHealthRiskLevel: 'none',
        },
      };

      const kafkaCtxMock: any = {
        getTopic: () => 'emotion-result-events',
        getPartition: () => 0,
        getMessage: () => ({ key: 'post-999', offset: '1' }),
      };

      await ingestionController.handleAnalysisEvents(
        kafkaMessage,
        kafkaCtxMock,
      );
      expect(mockIngestionService.handleCreated).toHaveBeenCalledWith(
        kafkaMessage.payload,
      );
    });

    it('should ingest MODERATION_REJECTED event', async () => {
      const moderationMessage: any = {
        type: 'MODERATION_EVALUATED',
        payload: {
          targetId: 'post-888',
          targetType: TargetType.POST,
          userId: 'user-123',
          action: ModerationAction.ALLOW_WITH_WARNING,
          displayMessage: 'Nội dung chứa cảnh báo',
        },
      };

      const kafkaCtxMock: any = {
        getTopic: () => 'moderation-rejected-events',
        getPartition: () => 0,
        getMessage: () => ({ key: 'post-888', offset: '2' }),
      };

      await ingestionController.handleModerationEvents(
        moderationMessage,
        kafkaCtxMock,
      );
      expect(mockIngestionService.handleModeration).toHaveBeenCalledWith(
        moderationMessage.payload,
      );
    });
  });
});
