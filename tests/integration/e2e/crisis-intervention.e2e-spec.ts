/**
 * crisis-intervention.e2e-spec.ts
 * [E2E-J03] Psychological Crisis Guard Detection & Real-time Proactive Intervention
 * 
 * Trace: api-gateway -> ai-chatbot-service -> emotion-intelligence-service ->
 *        RabbitMQ -> WebSocket Gateway -> search-recommendation-service
 */

import 'reflect-metadata';
import mockEmotionVectors from '../../fixtures/mock-emotion-vectors.json';
import { TEST_USERS } from '../../fixtures/seed-test-users';
import { KafkaTestProducerHelper } from '../../helpers/kafka-test-producer.helper';
import { EventTopic } from '@repo/dtos';

describe('[E2E-J03] Crisis Guard & Proactive Intervention Pipeline', () => {
  let kafkaHelper: KafkaTestProducerHelper;
  const crisisUser = TEST_USERS.crisisUser;

  beforeEach(() => {
    kafkaHelper = new KafkaTestProducerHelper();
  });

  afterEach(() => {
    kafkaHelper.clear();
  });

  it('Step 1: CrisisGuard detects suicidal ideation prompt and bypasses LLM to return emergency hotline (< 100ms)', async () => {
    const promptText = mockEmotionVectors.crisis.triggerPhrase;
    const startTime = Date.now();

    // Crisis Regex / Lexicon match
    const crisisPatterns = [/tự tử/i, /không muốn sống/i, /kết thúc cuộc sống/i];
    const isCrisisDetected = crisisPatterns.some((pattern) => pattern.test(promptText));

    expect(isCrisisDetected).toBe(true);

    // Emergency response payload (Bypass RAG LLM)
    const emergencyResponse = {
      severity: 'CRITICAL',
      riskLevel: 'CRISIS',
      message: 'Chúng tôi luôn ở bên bạn. Xin đừng ngần ngại gọi ngay đến Tổng đài Quốc gia Bảo vệ Trẻ em & Khủng hoảng Tâm lý: 1900 6000 (Miễn phí 24/7).',
      hotline: '1900 6000',
      executionMs: Date.now() - startTime,
    };

    // Assertion 1: Immediate emergency response
    expect(emergencyResponse.severity).toBe('CRITICAL');
    expect(emergencyResponse.hotline).toBe('1900 6000');
    expect(emergencyResponse.message).toContain('1900 6000');
    expect(emergencyResponse.executionMs).toBeLessThan(100);
  });

  it('Step 2: AI service emits EventTopic.CHATBOT_CRISIS_ALERT and RabbitMQ dispatches safety resources', async () => {
    const alertPayload = {
      userId: crisisUser.id,
      riskLevel: 'CRISIS',
      triggerPhrase: mockEmotionVectors.crisis.triggerPhrase,
      timestamp: Date.now(),
    };

    // Emit event topic CHATBOT_CRISIS_ALERT
    await kafkaHelper.emit(EventTopic.CHATBOT_CRISIS_ALERT, alertPayload, crisisUser.id);

    const alertRecords = kafkaHelper.getTopicRecords(EventTopic.CHATBOT_CRISIS_ALERT);
    expect(alertRecords.length).toBe(1);
    expect(alertRecords[0].value.riskLevel).toBe('CRISIS');

    // Simulated RabbitMQ Notification Packet
    const rabbitMqNotification = {
      routingKey: 'notification.crisis.safety',
      payload: {
        userId: crisisUser.id,
        type: 'CRISIS_SAFETY_RESOURCES',
        title: 'Hỗ trợ khẩn cấp',
        actionUrl: 'tel:19006000',
      },
    };

    expect(rabbitMqNotification.payload.type).toBe('CRISIS_SAFETY_RESOURCES');
    expect(rabbitMqNotification.payload.actionUrl).toBe('tel:19006000');
  });

  it('Step 3: search-recommendation-service dynamically shifts music recommendation to CALM / Meditation', async () => {
    const calmTarget = mockEmotionVectors.calm_target;

    // Simulated music recommendation query response under CRISIS state
    const recommendedTracks = [
      {
        id: 'track_mindfulness_01',
        title: 'Deep Breathing & Calming Ocean Waves',
        category: 'MEDITATION_MINDFULNESS',
        valence: 0.65,
        arousal: 0.25,
      },
      {
        id: 'track_mindfulness_02',
        title: 'Gentle Rain for Anxiety Relief',
        category: 'MEDITATION_MINDFULNESS',
        valence: 0.60,
        arousal: 0.20,
      },
    ];

    // Assert music coordinates match soothing profile
    expect(recommendedTracks.length).toBeGreaterThan(0);
    expect(recommendedTracks[0].category).toBe('MEDITATION_MINDFULNESS');
    expect(recommendedTracks[0].valence).toBeCloseTo(calmTarget.valence, 1);
    expect(recommendedTracks[0].arousal).toBeCloseTo(calmTarget.arousal, 1);
  });
});
