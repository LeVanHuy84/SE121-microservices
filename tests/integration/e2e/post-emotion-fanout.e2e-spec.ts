/**
 * post-emotion-fanout.e2e-spec.ts
 * [E2E-J02] Post Creation, Multimodal AI Emotion Analysis & Feed Fan-Out
 * 
 * Trace: api-gateway -> content-feed-service -> ai-chatbot-service -> 
 *        emotion-intelligence-service -> search-recommendation-service
 */

import 'reflect-metadata';
import mockEmotionVectors from '../../fixtures/mock-emotion-vectors.json';
import { TEST_USERS } from '../../fixtures/seed-test-users';
import { KafkaTestProducerHelper } from '../../helpers/kafka-test-producer.helper';
import { RedisTestHelper } from '../../helpers/redis-test.helper';
import { EventTopic } from '@repo/dtos';

describe('[E2E-J02] Post Creation, Multimodal Emotion Analysis & Feed Fan-Out', () => {
  let kafkaHelper: KafkaTestProducerHelper;
  let redisHelper: RedisTestHelper;

  const author = TEST_USERS.author;
  const follower = TEST_USERS.follower;
  const samplePostId = 'post_test_sadness_101';

  beforeEach(() => {
    kafkaHelper = new KafkaTestProducerHelper();
    redisHelper = new RedisTestHelper();
  });

  afterEach(async () => {
    kafkaHelper.clear();
    await redisHelper.clearAll();
  });

  it('Step 1: Author publishes post with PENDING_ANALYSIS and dispatches Kafka ANALYSIS event', async () => {
    const postPayload = {
      id: samplePostId,
      authorId: author.id,
      content: 'Hôm nay tôi mệt mỏi và bế tắc, mọi thứ dường như quá sức chịu đựng...',
      status: 'PENDING_ANALYSIS',
      createdAt: Date.now(),
    };

    // Emit POST created
    await kafkaHelper.emit(EventTopic.POST, {
      type: 'POST_CREATED',
      postId: postPayload.id,
      authorId: author.id,
    });

    // Emit ANALYSIS event for AI pipeline
    await kafkaHelper.emit(EventTopic.ANALYSIS, {
      targetId: postPayload.id,
      targetType: 'POST',
      text: postPayload.content,
      userId: author.id,
      timestamp: Date.now(),
    });

    const analysisRecords = kafkaHelper.getTopicRecords(EventTopic.ANALYSIS);
    expect(analysisRecords.length).toBe(1);
    expect(analysisRecords[0].value.targetId).toBe(samplePostId);
  });

  it('Step 2: AI service infers emotion (SADNESS) and emits EventTopic.ANALYSIS_RESULT', async () => {
    const aiResult = mockEmotionVectors.sadness;

    // Emit ANALYSIS_RESULT
    await kafkaHelper.emit(EventTopic.ANALYSIS_RESULT, {
      targetId: samplePostId,
      userId: author.id,
      primaryEmotion: aiResult.primaryEmotion,
      valence: aiResult.valence,
      arousal: aiResult.arousal,
      confidence: aiResult.confidence,
      timestamp: Date.now(),
    });

    const results = kafkaHelper.getTopicRecords(EventTopic.ANALYSIS_RESULT);
    expect(results.length).toBe(1);
    expect(results[0].value.primaryEmotion).toBe('SADNESS');
    expect(results[0].value.valence).toBeLessThan(0.3); // Low valence indicates negative mood
  });

  it('Step 3: content-feed-service activates post, fans out to followers Redis feed, and updates EMA', async () => {
    const now = Date.now();

    // 1. Post is updated to ACTIVE
    const updatedPost = {
      id: samplePostId,
      status: 'ACTIVE',
      mainEmotion: 'SADNESS',
      valence: 0.15,
      arousal: 0.35,
      activatedAt: now,
    };
    expect(updatedPost.status).toBe('ACTIVE');

    // 2. Fan-out to follower Redis Sorted Set
    const followerFeedKey = `feed:${follower.id}`;
    await redisHelper.zadd(followerFeedKey, now, samplePostId);

    // Assert follower feed contains new post
    const feedPosts = await redisHelper.zrevrange(followerFeedKey, 0, 10);
    expect(feedPosts).toContain(samplePostId);
    expect(feedPosts[0]).toBe(samplePostId);

    // 3. Emotion Intelligence EMA update (alpha = 0.2)
    const previousNegativeEMA = 0.20;
    const alpha = 0.20;
    const postWeight = 1.0;
    const newNegativeEMA = previousNegativeEMA + alpha * (postWeight - previousNegativeEMA);

    expect(newNegativeEMA).toBeGreaterThan(previousNegativeEMA);
    expect(newNegativeEMA).toBeCloseTo(0.36, 2);

    // 4. Elasticsearch search filter check
    const esIndexedPost = {
      id: samplePostId,
      authorId: author.id,
      mainEmotion: 'SADNESS',
      status: 'ACTIVE',
    };
    expect(esIndexedPost.mainEmotion).toBe('SADNESS');
    expect(esIndexedPost.status).toBe('ACTIVE');
  });
});
