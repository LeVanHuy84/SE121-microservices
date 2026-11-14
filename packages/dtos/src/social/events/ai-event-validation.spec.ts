import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  AnalysisResultEventPayload,
  AnalysisResultEvent,
  CreatedAnalysisEventPayload,
} from './analysis.event';
import { ChatbotCrisisAlertPayload, ChatbotCrisisAlertEvent } from './chatbot.event';
import { CreateFeedbackDto } from '../../emotion/feedback.dto';
import { Emotion, TargetType } from '../enums';

describe('AI & Emotion Analysis Event Contracts (TC-DTO-04)', () => {
  describe('CreateFeedbackDto Validation', () => {
    it('TC-DTO-04: should successfully validate correct feedback payload', async () => {
      const dto = plainToInstance(CreateFeedbackDto, {
        targetId: 'post-999',
        targetType: TargetType.POST,
        isAccurate: true,
        expectedEmotion: Emotion.JOY,
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail when isAccurate is missing or invalid type', async () => {
      const dto = plainToInstance(CreateFeedbackDto, {
        targetId: 'post-999',
        targetType: TargetType.POST,
        isAccurate: 'not-a-boolean' as any,
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'isAccurate')).toBe(true);
    });

    it('should fail when targetType is not an accepted TargetType enum', async () => {
      const dto = plainToInstance(CreateFeedbackDto, {
        targetId: 'post-999',
        targetType: 'INVALID_TARGET' as any,
        isAccurate: false,
      });

      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'targetType')).toBe(true);
    });
  });

  describe('AnalysisResultEvent & CreatedAnalysisEventPayload Contracts', () => {
    it('TC-DTO-04: should properly instantiate AnalysisResultEvent structure with payload', () => {
      const payload: AnalysisResultEventPayload = {
        userId: 'user-001',
        targetId: 'post-100',
        targetType: TargetType.POST,
        modelVersion: 'phobert-v2.1',
        primaryEmotion: Emotion.JOY,
        scores: {
          joy: 0.92,
          sadness: 0.03,
          anger: 0.01,
          neutral: 0.04,
        },
        confidence: 0.95,
        isSarcasmOrConflict: false,
        mentalHealthRiskLevel: 'LOW',
      };

      const event: AnalysisResultEvent = {
        type: 'analysis_result',
        payload,
      };

      expect(event.type).toBe('analysis_result');
      expect(event.payload.targetId).toBe('post-100');
      expect(event.payload.scores.joy).toBe(0.92);
      expect(event.payload.primaryEmotion).toBe(Emotion.JOY);
    });

    it('should instantiate CreatedAnalysisEventPayload correctly', () => {
      const eventPayload = plainToInstance(CreatedAnalysisEventPayload, {
        userId: 'user-1',
        targetId: 'post-1',
        targetType: TargetType.POST,
        content: 'Feeling peaceful and calm today',
        imageUrls: ['https://cdn.example.com/calm.jpg'],
      });

      expect(eventPayload.userId).toBe('user-1');
      expect(eventPayload.imageUrls).toHaveLength(1);
    });
  });

  describe('ChatbotCrisisAlert Contract', () => {
    it('TC-DTO-04: should correctly construct ChatbotCrisisAlertEvent', () => {
      const payload: ChatbotCrisisAlertPayload = {
        userId: 'user-distressed',
        conversationId: 'conv-ai-001',
        riskLevel: 'CRISIS',
        reason: 'Detected self-harm expression in conversation message',
        timestamp: new Date().toISOString(),
      };

      const alertEvent: ChatbotCrisisAlertEvent = {
        type: 'chatbot.crisis.alert',
        payload,
      };

      expect(alertEvent.type).toBe('chatbot.crisis.alert');
      expect(alertEvent.payload.riskLevel).toBe('CRISIS');
      expect(alertEvent.payload.userId).toBe('user-distressed');
    });
  });
});

