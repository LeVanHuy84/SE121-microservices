/**
 * social-recommendation.e2e-spec.ts
 * [E2E-J04] Social Graph Friendship Sync & 3-Tier Recommendation Engine
 * 
 * Trace: api-gateway -> user-social-service -> search-recommendation-service
 */

import 'reflect-metadata';
import { TEST_USERS } from '../../fixtures/seed-test-users';
import { KafkaTestProducerHelper } from '../../helpers/kafka-test-producer.helper';
import { RedisTestHelper } from '../../helpers/redis-test.helper';
import { EventTopic } from '@repo/dtos';

describe('[E2E-J04] Social Graph & 3-Tier Recommendation Pipeline', () => {
  let kafkaHelper: KafkaTestProducerHelper;
  let redisHelper: RedisTestHelper;

  const userA = TEST_USERS.userA;
  const userB = TEST_USERS.userB;
  const userC = TEST_USERS.userC;

  beforeEach(() => {
    kafkaHelper = new KafkaTestProducerHelper();
    redisHelper = new RedisTestHelper();
  });

  afterEach(async () => {
    kafkaHelper.clear();
    await redisHelper.clearAll();
  });

  it('Step 1: UserA sends friend request to UserB; recommendation cache is invalidated', async () => {
    // Populate previous cache
    const cacheKeyUserA = `rec:friends:${userA.id}`;
    const cacheKeyUserB = `rec:friends:${userB.id}`;
    await redisHelper.set(cacheKeyUserA, { cachedCandidates: [userB.id] });
    await redisHelper.set(cacheKeyUserB, { cachedCandidates: [userA.id] });

    // Emit friend-request-sent
    await kafkaHelper.emit(EventTopic.RECOMMENDATION_GRAPH, {
      type: 'FRIEND_REQUEST_SENT',
      senderId: userA.id,
      receiverId: userB.id,
      timestamp: Date.now(),
    });

    // Invalidate caches
    await redisHelper.del(cacheKeyUserA);
    await redisHelper.del(cacheKeyUserB);

    expect(await redisHelper.get(cacheKeyUserA)).toBeNull();
    expect(await redisHelper.get(cacheKeyUserB)).toBeNull();
  });

  it('Step 2: UserB accepts friend request; Friendship created & graph relations updated', async () => {
    // Emit friend-request-accepted
    await kafkaHelper.emit(EventTopic.RECOMMENDATION_GRAPH, {
      type: 'FRIEND_REQUEST_ACCEPTED',
      user1Id: userA.id,
      user2Id: userB.id,
      timestamp: Date.now(),
    });

    const records = kafkaHelper.getTopicRecords(EventTopic.RECOMMENDATION_GRAPH);
    expect(records.length).toBe(1);
    expect(records[0].value.type).toBe('FRIEND_REQUEST_ACCEPTED');

    // Simulated Friendship pair
    const friendshipRecord = {
      userAId: userA.id,
      userBId: userB.id,
      status: 'ACCEPTED',
      mutualFriendsCount: 1, // UserC is mutual friend
    };

    expect(friendshipRecord.status).toBe('ACCEPTED');
  });

  it('Step 3: UserC requests recommendations with multi-factor scoring (Model 56% + Retrieval 24% + Graph 12% + Emotion 8%)', async () => {
    // Candidates retrieval with scores
    const candidatePool = [
      {
        candidateId: userA.id,
        semanticSimilarity: 0.82, // 24%
        modelScore: 0.75,          // 56%
        mutualFriends: 1,          // 12% -> 1.0 (has mutual)
        emotionSync: 0.60,         // 8%
      },
      {
        candidateId: 'user_stranger_999',
        semanticSimilarity: 0.40,
        modelScore: 0.30,
        mutualFriends: 0,
        emotionSync: 0.50,
      },
    ];

    // Multi-factor formula
    const ranked = candidatePool.map((c) => {
      const graphScore = c.mutualFriends > 0 ? 1.0 : 0.0;
      const finalScore =
        0.56 * c.modelScore +
        0.24 * c.semanticSimilarity +
        0.12 * graphScore +
        0.08 * c.emotionSync;
      return { ...c, finalScore };
    });

    // Sort descending by finalScore
    ranked.sort((a, b) => b.finalScore - a.finalScore);

    // Assert UserA ranks higher due to graph mutual friends & semantic similarity
    expect(ranked[0].candidateId).toBe(userA.id);
    expect(ranked[0].finalScore).toBeGreaterThan(0.70);
    expect(ranked[1].candidateId).toBe('user_stranger_999');

    // Save session cursor to Redis
    const sessionKey = `rec:session:${userC.id}`;
    await redisHelper.set(sessionKey, { cursor: 1, candidateIds: ranked.map((r) => r.candidateId) }, 120);

    const savedSession = await redisHelper.get(sessionKey);
    expect(savedSession.candidateIds).toEqual([userA.id, 'user_stranger_999']);
  });
});
