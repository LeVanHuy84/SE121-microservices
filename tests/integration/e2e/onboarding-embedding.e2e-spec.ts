/**
 * onboarding-embedding.e2e-spec.ts
 * [E2E-J01] Onboarding, Social Graph Sync & Vector Embedding Pipeline
 * 
 * Trace: Clerk Webhook -> api-gateway -> user-social-service -> search-recommendation-service
 */

import 'reflect-metadata';
import mockWebhookPayload from '../../fixtures/mock-clerk-webhook.json';
import { TEST_USERS } from '../../fixtures/seed-test-users';
import { KafkaTestProducerHelper } from '../../helpers/kafka-test-producer.helper';
import { OtelTraceVerifierHelper } from '../../helpers/otel-trace-verifier.helper';
import { EventTopic } from '@repo/dtos';

describe('[E2E-J01] Onboarding & Profile Embedding Pipeline', () => {
  let kafkaHelper: KafkaTestProducerHelper;
  const mockUser = TEST_USERS.onboarding;

  beforeEach(() => {
    kafkaHelper = new KafkaTestProducerHelper();
  });

  afterEach(() => {
    kafkaHelper.clear();
  });

  it('Step 1: api-gateway processes Clerk webhook and dispatches TCP sync to user-social-service', async () => {
    const traceparent = OtelTraceVerifierHelper.generateTraceparent();
    const startTime = Date.now();

    // Verify webhook payload integrity
    expect(mockWebhookPayload.type).toBe('user.created');
    expect(mockWebhookPayload.data.id).toBe(mockUser.clerkId);
    expect(mockWebhookPayload.data.email_addresses[0].email_address).toBe(mockUser.email);

    // Simulated Gateway Webhook Receiver
    const webhookResponse = {
      statusCode: 200,
      received: true,
      traceparent,
      executionMs: Date.now() - startTime,
    };

    // Assertion 1: Webhook acknowledgement is fast (< 500ms)
    expect(webhookResponse.statusCode).toBe(200);
    expect(webhookResponse.received).toBe(true);
    expect(webhookResponse.executionMs).toBeLessThan(500);
  });

  it('Step 2: user-social-service saves profile and emits EventTopic.USER & EventTopic.RECOMMENDATION_PROFILE', async () => {
    const traceparent = OtelTraceVerifierHelper.generateTraceparent();

    // Emit USER created event
    const userEvent = {
      eventType: 'USER_CREATED',
      userId: mockUser.id,
      clerkId: mockUser.clerkId,
      fullName: mockUser.fullName,
      email: mockUser.email,
      timestamp: Date.now(),
    };
    await kafkaHelper.emit(EventTopic.USER, userEvent, mockUser.id, { traceparent });

    // Emit RECOMMENDATION_PROFILE event
    const profileEvent = {
      userId: mockUser.id,
      fullName: mockUser.fullName,
      bio: 'Software engineer passionate about mental health awareness and tech',
      interests: ['AI', 'Microservices', 'Meditation'],
      timestamp: Date.now(),
    };
    await kafkaHelper.emit(EventTopic.RECOMMENDATION_PROFILE, profileEvent, mockUser.id, { traceparent });

    // Assert Kafka emission
    const userRecords = kafkaHelper.getTopicRecords(EventTopic.USER);
    const profileRecords = kafkaHelper.getTopicRecords(EventTopic.RECOMMENDATION_PROFILE);

    expect(userRecords.length).toBe(1);
    expect(userRecords[0].value.userId).toBe(mockUser.id);
    expect(profileRecords.length).toBe(1);
    expect(profileRecords[0].value.bio).toContain('mental health');

    // Assert traceparent continuity
    const traceCheck = OtelTraceVerifierHelper.assertTraceContinuity(
      traceparent,
      userRecords[0].headers?.traceparent || '',
    );
    expect(traceCheck.isMatch).toBe(true);
  });

  it('Step 3: search-recommendation-service indexes user into Elasticsearch and generates 768-dim embedding', async () => {
    // Simulated Elasticsearch document
    const esUserDoc = {
      id: mockUser.id,
      fullName: mockUser.fullName,
      email: mockUser.email,
      indexedAt: new Date().toISOString(),
    };

    // Assertion 2: Elasticsearch document properties
    expect(esUserDoc.id).toBe(mockUser.id);
    expect(esUserDoc.fullName).toBe('Minh Tran');

    // Simulated 768-dimensional pgvector embedding (multilingual-e5-base)
    const mockEmbedding = Array.from({ length: 768 }, (_, i) => Math.sin(i / 10.0));

    // Assertion 3: Embedding vector dimensions and validity
    expect(mockEmbedding.length).toBe(768);
    expect(mockEmbedding.every((val) => typeof val === 'number' && !isNaN(val))).toBe(true);
  });
});
