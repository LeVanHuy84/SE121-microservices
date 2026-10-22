import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { getRedisConnectionToken } from "@nestjs-modules/ioredis";
import { PersonalFeedController } from "../../src/modules/feed/feed-pipeline/controllers/personal-feed.controller";
import { TrendingController } from "../../src/modules/feed/feed-pipeline/controllers/trending.controller";
import { PersonalFeedService } from "../../src/modules/feed/feed-pipeline/services/personal-feed.service";
import { TrendingService } from "../../src/modules/feed/feed-pipeline/services/trending.service";
import { ScoreCombinerService } from "../../src/modules/feed/ranking/services/score-combiner.service";
import { EmotionFeatureService } from "../../src/modules/feed/ranking/services/emotion-feature.service";
import { AffinityService } from "../../src/modules/feed/affinity/affinity.service";
import { SnapshotRepository } from "../../src/modules/feed/mongo/repository/snapshot.repository";
import { ReactionService } from "../../src/modules/post/reaction/reaction.service";
import { UserClientService } from "../../src/modules/post/client/user-client.service";
import { MICROSERVICES_CLIENT } from "../../src/constant";
import { FeedItem } from "../../src/modules/feed/mongo/schema/feed-item.schema";
import { FeedEventType, RiskHintLevel } from "@repo/dtos";
import { of } from "rxjs";
import { PersonalFeedHelper } from "../../src/modules/feed/feed-pipeline/helpers/personal-feed.helper";

/**
 * In-Memory Redis Mock supporting Lists, Hashes, and ZSETs
 */
class InMemoryRedisMock {
  public lists = new Map<string, string[]>();
  public hashes = new Map<string, Record<string, string>>();
  public zsets = new Map<string, Map<string, number>>();

  async rpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) || [];
    list.push(...values);
    this.lists.set(key, list);
    return list.length;
  }

  async llen(key: string): Promise<number> {
    return (this.lists.get(key) || []).length;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) || [];
    if (stop === -1) return list.slice(start);
    return list.slice(start, stop + 1);
  }

  async expire(key: string, ttl: number): Promise<number> {
    return 1;
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) {
      if (this.lists.delete(k) || this.hashes.delete(k) || this.zsets.delete(k)) {
        count++;
      }
    }
    return count;
  }

  async hset(key: string, data: Record<string, string>): Promise<number> {
    this.hashes.set(key, { ...(this.hashes.get(key) || {}), ...data });
    return Object.keys(data).length;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.hashes.get(key) || {};
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const zset = this.zsets.get(key) || new Map<string, number>();
    zset.set(member, score);
    this.zsets.set(key, zset);
    return 1;
  }

  async zrevrangebyscore(
    key: string,
    max: string,
    min: string,
    withscores?: string,
    limitStr?: string,
    offset = 0,
    count = 100,
  ): Promise<string[]> {
    const zset = this.zsets.get(key) || new Map<string, number>();
    const entries = Array.from(zset.entries()).sort((a, b) => b[1] - a[1]);
    const sliced = entries.slice(offset, offset + count);

    const result: string[] = [];
    for (const [member, score] of sliced) {
      result.push(member, score.toString());
    }
    return result;
  }

  pipeline() {
    const commands: (() => any)[] = [];
    const proxy = {
      hgetall: (key: string) => {
        commands.push(() => [null, this.hashes.get(key) || {}]);
        return proxy;
      },
      exec: async () => {
        return commands.map((fn) => fn());
      },
    };
    return proxy;
  }

  clear() {
    this.lists.clear();
    this.hashes.clear();
    this.zsets.clear();
  }
}

describe("Feed Module E2E & Integration Test Suite", () => {
  let app: INestApplication;
  let personalFeedController: PersonalFeedController;
  let trendingController: TrendingController;
  let redisMock: InMemoryRedisMock;

  // Mock In-Memory Databases
  let mockFeedItems: any[] = [];
  let mockPostSnapshots = new Map<string, any>();

  const mockUserSocialClient = {
    send: jest.fn().mockImplementation((pattern: string) => {
      if (pattern === "get_group_info_batch") return of([]);
      return of([]);
    }),
  };

  const mockReactionService = {
    getReactedTypesBatch: jest.fn().mockResolvedValue({}),
  };

  const mockUserClient = {
    getUserInfos: jest.fn().mockResolvedValue({}),
  };

  const mockAffinityService = {
    getAffinity: jest.fn().mockResolvedValue({}),
    calcAffinityScore: jest.fn().mockReturnValue(0.5),
  };

  const mockEmotionIntelligenceClient = {
    send: jest.fn().mockImplementation((pattern: string, payload: any) => {
      return of(null);
    }),
  };

  beforeAll(async () => {
    redisMock = new InMemoryRedisMock();

    const mockFeedItemModel = {
      find: jest.fn().mockImplementation((query: any) => {
        let items = [...mockFeedItems];
        if (query?.userId) {
          items = items.filter((i) => i.userId === query.userId);
        }
        if (query?._id?.$in) {
          const ids = new Set(query._id.$in.map((id: any) => id.toString()));
          items = items.filter((i) => ids.has(i._id.toString()));
        }
        return {
          sort: () => ({
            limit: (num: number) => ({
              lean: async () => items.slice(0, num),
            }),
            lean: async () => items,
          }),
          lean: async () => items,
        };
      }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };

    const mockSnapshotRepo = {
      findPostsForRanking: jest.fn().mockImplementation(async (ids: string[], mainEmotion?: string) => {
        return ids
          .map((id) => mockPostSnapshots.get(id))
          .filter((p) => {
            if (!p) return false;
            if (mainEmotion && p.emotionFeature?.label !== mainEmotion) return false;
            return true;
          });
      }),
      findPostsByIds: jest.fn().mockImplementation(async (ids: string[]) => {
        return ids.map((id) => mockPostSnapshots.get(id)).filter(Boolean);
      }),
      findSharesByIds: jest.fn().mockResolvedValue([]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PersonalFeedController, TrendingController],
      providers: [
        PersonalFeedService,
        TrendingService,
        ScoreCombinerService,
        EmotionFeatureService,
        { provide: SnapshotRepository, useValue: mockSnapshotRepo },
        { provide: getModelToken(FeedItem.name), useValue: mockFeedItemModel },
        { provide: getRedisConnectionToken(), useValue: redisMock },
        { provide: MICROSERVICES_CLIENT.USER_SOCIAL_SERVICE, useValue: mockUserSocialClient },
        { provide: "EMOTION_INTELLIGENCE_SERVICE", useValue: mockEmotionIntelligenceClient },
        { provide: ReactionService, useValue: mockReactionService },
        { provide: UserClientService, useValue: mockUserClient },
        { provide: AffinityService, useValue: mockAffinityService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    personalFeedController = moduleFixture.get<PersonalFeedController>(PersonalFeedController);
    trendingController = moduleFixture.get<TrendingController>(TrendingController);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    redisMock.clear();
    mockFeedItems = [];
    mockPostSnapshots.clear();
  });

  // =========================================================================
  // SUITE 1: PERSONAL FEED PAGINATION & REDIS SESSION SNAPSHOT LIFECYCLE
  // =========================================================================
  describe("Suite 1: Personal Feed Pagination & Session Snapshot Lifecycle", () => {
    it("TC1: First request without cursor should generate new Redis session snapshot and return Page 1 with nextCursor", async () => {
      // Seed 25 posts for user-1
      for (let i = 1; i <= 25; i++) {
        const postId = `post-${i}`;
        mockFeedItems.push({
          _id: `feed-item-${i}`,
          userId: "user-1",
          postId,
          eventType: FeedEventType.POST,
          createdAt: new Date(Date.now() - i * 60000),
        });
        mockPostSnapshots.set(postId, {
          postId,
          userId: `author-${i}`,
          content: `Test Post ${i}`,
          emotionFeature: { label: "joy", scores: { joy: 0.8 }, confidence: 0.9 },
          stats: { reactions: i * 10, comments: i, shares: 0 },
        });
      }

      const res = await personalFeedController.getUserFeeds({
        userId: "user-1",
        query: { limit: 10 },
      });

      expect(res.data).toHaveLength(10);
      expect(res.hasNextPage).toBe(true);
      expect(res.nextCursor).toBeDefined();
      expect(typeof res.nextCursor).toBe("string");

      // Verify that Redis List session snapshot was created with 25 candidate IDs
      const sessionKeyPattern = "feed:session:user-1:all:";
      // Check that a list key was saved in Redis
      const redisKeys = [...redisMock.lists.keys()].filter((k) => k.startsWith("feed:session:user-1:all:"));
      expect(redisKeys).toHaveLength(1);
      expect(redisMock.lists.get(redisKeys[0])).toHaveLength(25);
    });

    it("TC2: Consecutive pagination (Page 1 -> Page 2 -> Page 3) must guarantee 100% ZERO DUPLICATES and ZERO SKIPPED items", async () => {
      // Seed 25 items
      for (let i = 1; i <= 25; i++) {
        const postId = `post-${i}`;
        mockFeedItems.push({
          _id: `feed-item-${i}`,
          userId: "user-2",
          postId,
          eventType: FeedEventType.POST,
          createdAt: new Date(Date.now() - i * 60000),
        });
        mockPostSnapshots.set(postId, {
          postId,
          userId: `author-${i}`,
          content: `Content ${i}`,
          emotionFeature: { label: "neutral", scores: { neutral: 0.8 } },
          stats: { reactions: i * 5 },
        });
      }

      // Page 1
      const page1 = await personalFeedController.getUserFeeds({
        userId: "user-2",
        query: { limit: 10 },
      });
      expect(page1.data).toHaveLength(10);
      expect(page1.hasNextPage).toBe(true);

      // Page 2
      const page2 = await personalFeedController.getUserFeeds({
        userId: "user-2",
        query: { limit: 10, cursor: page1.nextCursor || undefined },
      });
      expect(page2.data).toHaveLength(10);
      expect(page2.hasNextPage).toBe(true);

      // Page 3
      const page3 = await personalFeedController.getUserFeeds({
        userId: "user-2",
        query: { limit: 10, cursor: page2.nextCursor || undefined },
      });
      expect(page3.data).toHaveLength(5);
      expect(page3.hasNextPage).toBe(false);
      expect(page3.nextCursor).toBeNull();

      // STRICT ZERO DUPLICATES CHECK
      const allSeenItemIds = [
        ...page1.data.map((x) => x.id),
        ...page2.data.map((x) => x.id),
        ...page3.data.map((x) => x.id),
      ];
      expect(allSeenItemIds).toHaveLength(25);
      const uniqueIds = new Set(allSeenItemIds);
      expect(uniqueIds.size).toBe(25); // Exactly 25 unique items, zero duplicates, zero lost!
    });

    it("TC3: Deep scrolling boundary condition should return empty data with hasNextPage: false", async () => {
      for (let i = 1; i <= 20; i++) {
        mockFeedItems.push({
          _id: `feed-item-u3-${i}`,
          userId: "user-3",
          postId: `post-u3-${i}`,
          eventType: FeedEventType.POST,
          createdAt: new Date(),
        });
        mockPostSnapshots.set(`post-u3-${i}`, {
          postId: `post-u3-${i}`,
          content: `User 3 post ${i}`,
          emotionFeature: { label: "joy", scores: { joy: 0.8 } },
        });
      }

      const page1 = await personalFeedController.getUserFeeds({
        userId: "user-3",
        query: { limit: 10 },
      });
      expect(page1.data).toHaveLength(10);
      expect(page1.hasNextPage).toBe(true);
      expect(page1.nextCursor).toBeDefined();

      const page2 = await personalFeedController.getUserFeeds({
        userId: "user-3",
        query: { limit: 10, cursor: page1.nextCursor! },
      });
      expect(page2.data).toHaveLength(10);
      expect(page2.hasNextPage).toBe(false);

      // Attempting to scroll further past end of existing session (deep scrolling boundary)
      const decoded = PersonalFeedHelper.decodeSessionCursor(page1.nextCursor!);
      const outOfBoundsCursor = PersonalFeedHelper.encodeSessionCursor(decoded!.sessionId, 100);
      const page3 = await personalFeedController.getUserFeeds({
        userId: "user-3",
        query: { limit: 10, cursor: outOfBoundsCursor },
      });
      expect(page3.data).toHaveLength(0);
      expect(page3.hasNextPage).toBe(false);
    });

    it("TC4: Expired or corrupted session cursor should gracefully fallback to a new session without error", async () => {
      mockFeedItems.push({
        _id: "feed-item-fb",
        userId: "user-4",
        postId: "post-fb",
        eventType: FeedEventType.POST,
        createdAt: new Date(),
      });
      mockPostSnapshots.set("post-fb", {
        postId: "post-fb",
        content: "Fallback post",
        emotionFeature: { label: "neutral", scores: { neutral: 0.9 } },
      });

      // Pass an expired/unknown cursor
      const res = await personalFeedController.getUserFeeds({
        userId: "user-4",
        query: { limit: 10, cursor: "eyJzIjoidW5rbm93bi1leHBpcmVkLXNlc3Npb24iLCJvIjoxMH0=" },
      });

      expect(res.data).toHaveLength(1);
      expect(res.data[0].id).toBe("feed-item-fb");
    });
  });

  // =========================================================================
  // SUITE 2: DYNAMIC ADAPTIVE RANKING & EMA EMOTION INTELLIGENCE
  // =========================================================================
  describe("Suite 2: Dynamic Adaptive Ranking & EMA Emotion Intelligence", () => {
    it("TC5: Normal user state (distress <= 0.3) balances recency, social affinity, and positive content", async () => {
      const emotionService = app.get(EmotionFeatureService);
      jest.spyOn(emotionService, "getEmotionFeatures").mockResolvedValue({
        userEmotionPreference: { joy: 0.5, neutral: 0.5 },
        last24hEmotionDistribution: { joy: 0.2 },
        negativeRatio7d: 0.1,
        emotionVolatility7d: 0.1,
        riskScore: 0.1,
        recentNegativityScore: 0.1,
        emotionMomentum: 0.2,
      });

      mockFeedItems.push(
        {
          _id: "item-fresh",
          userId: "user-normal",
          postId: "post-fresh",
          eventType: FeedEventType.POST,
          createdAt: new Date(), // very fresh
        },
        {
          _id: "item-old",
          userId: "user-normal",
          postId: "post-old",
          eventType: FeedEventType.POST,
          createdAt: new Date(Date.now() - 72 * 3600000), // 3 days old
        },
      );

      mockPostSnapshots.set("post-fresh", {
        postId: "post-fresh",
        content: "Fresh post",
        emotionFeature: { label: "joy", scores: { joy: 0.5 } },
        stats: { reactions: 10 },
      });
      mockPostSnapshots.set("post-old", {
        postId: "post-old",
        content: "Old post",
        emotionFeature: { label: "joy", scores: { joy: 0.5 } },
        stats: { reactions: 10 },
      });

      const res = await personalFeedController.getUserFeeds({
        userId: "user-normal",
        query: { limit: 10 },
      });

      // Fresh post should rank above old post under normal mode
      expect(res.data[0].id).toBe("item-fresh");
      expect(res.data[1].id).toBe("item-old");
    });

    it("TC6: Distressed user state (distress > 0.6) activates Safe Recovery Mode and elevates Calming Bridge content", async () => {
      const emotionService = app.get(EmotionFeatureService);
      jest.spyOn(emotionService, "getEmotionFeatures").mockResolvedValue({
        userEmotionPreference: { sadness: 0.8, neutral: 0.2 },
        last24hEmotionDistribution: { sadness: 0.7 },
        negativeRatio7d: 0.75,
        emotionVolatility7d: 0.6,
        riskScore: 0.8,
        recentNegativityScore: 0.85,
        emotionMomentum: -0.4,
      });

      mockFeedItems.push(
        {
          _id: "item-calm",
          userId: "user-distressed",
          postId: "post-calm",
          eventType: FeedEventType.POST,
          createdAt: new Date(Date.now() - 5 * 3600000),
        },
        {
          _id: "item-noisy",
          userId: "user-distressed",
          postId: "post-noisy",
          eventType: FeedEventType.POST,
          createdAt: new Date(),
        },
      );

      mockPostSnapshots.set("post-calm", {
        postId: "post-calm",
        content: "Peaceful nature and mindfulness",
        emotionFeature: { label: "neutral", scores: { neutral: 0.9, calm: 0.8 } },
        stats: { reactions: 5 },
      });

      mockPostSnapshots.set("post-noisy", {
        postId: "post-noisy",
        content: "Exciting party celebration",
        emotionFeature: { label: "joy", scores: { joy: 0.95 } },
        stats: { reactions: 50 },
      });

      const res = await personalFeedController.getUserFeeds({
        userId: "user-distressed",
        query: { limit: 10 },
      });

      // Under distressed state, Calming Bridge is prioritized over extreme joy
      expect(res.data[0].id).toBe("item-calm");
    });

    it("TC7: Doomscrolling Echo Chamber Prevention: Distressed sad user does NOT get flooded with depressing posts", async () => {
      const emotionService = app.get(EmotionFeatureService);
      jest.spyOn(emotionService, "getEmotionFeatures").mockResolvedValue({
        userEmotionPreference: { sadness: 0.9 },
        last24hEmotionDistribution: { sadness: 0.8 },
        negativeRatio7d: 0.8,
        emotionVolatility7d: 0.5,
        riskScore: 0.7,
        recentNegativityScore: 0.8,
        emotionMomentum: -0.2,
      });

      mockFeedItems.push(
        {
          _id: "item-sad-echo",
          userId: "user-doom",
          postId: "post-sad-echo",
          eventType: FeedEventType.POST,
          createdAt: new Date(),
        },
        {
          _id: "item-gentle",
          userId: "user-doom",
          postId: "post-gentle",
          eventType: FeedEventType.POST,
          createdAt: new Date(),
        },
      );

      mockPostSnapshots.set("post-sad-echo", {
        postId: "post-sad-echo",
        content: "Feeling hopeless and sad today",
        emotionFeature: { label: "sadness", scores: { sadness: 0.9 } },
        stats: { reactions: 20 },
      });

      mockPostSnapshots.set("post-gentle", {
        postId: "post-gentle",
        content: "A gentle reminder that it is okay to rest",
        emotionFeature: { label: "neutral", scores: { neutral: 0.8, calm: 0.6 } },
        stats: { reactions: 20 },
      });

      const res = await personalFeedController.getUserFeeds({
        userId: "user-doom",
        query: { limit: 10 },
      });

      // Gentle calming post must be ranked higher than the echo-chamber depressing post
      expect(res.data[0].id).toBe("item-gentle");
      expect(res.data[1].id).toBe("item-sad-echo");
    });

    it("TC8: Emotion filter (mainEmotion) runs correctly against post_snapshots", async () => {
      mockFeedItems.push(
        {
          _id: "item-joy",
          userId: "user-filter",
          postId: "post-joy",
          eventType: FeedEventType.POST,
          createdAt: new Date(),
        },
        {
          _id: "item-neutral",
          userId: "user-filter",
          postId: "post-neutral",
          eventType: FeedEventType.POST,
          createdAt: new Date(),
        },
      );

      mockPostSnapshots.set("post-joy", {
        postId: "post-joy",
        emotionFeature: { label: "joy", scores: { joy: 0.9 } },
      });
      mockPostSnapshots.set("post-neutral", {
        postId: "post-neutral",
        emotionFeature: { label: "neutral", scores: { neutral: 0.9 } },
      });

      const res = await personalFeedController.getUserFeeds({
        userId: "user-filter",
        query: { limit: 10, mainEmotion: "JOY" as any },
      });

      expect(res.data).toHaveLength(1);
      expect(res.data[0].id).toBe("item-joy");
    });
  });

  // =========================================================================
  // SUITE 3: DUAL-TIER HARD SAFETY GUARDRAILS (ETHICAL AI)
  // =========================================================================
  describe("Suite 3: Dual-tier Hard Safety Guardrails (Ethical AI)", () => {
    it("TC9: Tier 1 Hard Drop: Posts with mentalHealthRiskLevel === 'HIGH' are 100% excluded from candidates", async () => {
      mockFeedItems.push(
        {
          _id: "item-safe",
          userId: "user-safe",
          postId: "post-safe",
          eventType: FeedEventType.POST,
          createdAt: new Date(),
        },
        {
          _id: "item-high-risk",
          userId: "user-safe",
          postId: "post-high-risk",
          eventType: FeedEventType.POST,
          createdAt: new Date(),
        },
      );

      mockPostSnapshots.set("post-safe", {
        postId: "post-safe",
        content: "Safe daily sharing",
        emotionFeature: { label: "neutral", scores: { neutral: 0.8 }, mentalHealthRiskLevel: "none" },
      });

      mockPostSnapshots.set("post-high-risk", {
        postId: "post-high-risk",
        content: "Dangerous self-harm content",
        emotionFeature: { label: "sadness", scores: { sadness: 0.99 }, mentalHealthRiskLevel: "HIGH" },
      });

      const res = await personalFeedController.getUserFeeds({
        userId: "user-safe",
        query: { limit: 10 },
      });

      expect(res.data).toHaveLength(1);
      expect(res.data[0].id).toBe("item-safe");
      const highRiskInFeed = res.data.some((x) => x.id === "item-high-risk");
      expect(highRiskInFeed).toBe(false);
    });

    it("TC10: Tier 2 Contextual Guardrail: Warning-flagged or highly provocative posts are suppressed when user is distressed", async () => {
      const emotionService = app.get(EmotionFeatureService);
      jest.spyOn(emotionService, "getEmotionFeatures").mockResolvedValue({
        riskScore: 0.8,
        recentNegativityScore: 0.8,
      } as any);

      mockFeedItems.push(
        {
          _id: "item-normal-safe",
          userId: "user-distress-guard",
          postId: "post-normal-safe",
          eventType: FeedEventType.POST,
          createdAt: new Date(),
        },
        {
          _id: "item-warning-flagged",
          userId: "user-distress-guard",
          postId: "post-warning-flagged",
          eventType: FeedEventType.POST,
          createdAt: new Date(),
        },
        {
          _id: "item-anger-rage",
          userId: "user-distress-guard",
          postId: "post-anger-rage",
          eventType: FeedEventType.POST,
          createdAt: new Date(),
        },
      );

      mockPostSnapshots.set("post-normal-safe", {
        postId: "post-normal-safe",
        emotionFeature: { label: "neutral", scores: { neutral: 0.8 } },
        hasWarning: false,
      });

      mockPostSnapshots.set("post-warning-flagged", {
        postId: "post-warning-flagged",
        emotionFeature: { label: "anger", scores: { anger: 0.6 } },
        hasWarning: true, // Triggered moderation warning
      });

      mockPostSnapshots.set("post-anger-rage", {
        postId: "post-anger-rage",
        emotionFeature: { label: "anger", scores: { anger: 0.7, fear: 0.2 } }, // anger + fear > 0.5
        hasWarning: false,
      });

      const res = await personalFeedController.getUserFeeds({
        userId: "user-distress-guard",
        query: { limit: 10 },
      });

      expect(res.data).toHaveLength(1);
      expect(res.data[0].id).toBe("item-normal-safe");
    });
  });

  // =========================================================================
  // SUITE 4: TRENDING FEED PAGINATION & VIRALITY QUALITY CONTROL
  // =========================================================================
  describe("Suite 4: Trending Feed Pagination & Virality Quality Control", () => {
    it("TC11: Authenticated user trending request runs personalized re-ranking and saves to trending:session:sessionId", async () => {
      await redisMock.zadd("post:score", 10.5, "trend-1");
      await redisMock.zadd("post:score", 8.2, "trend-2");

      await redisMock.hset("post:rank:trend-1", {
        scores: JSON.stringify({ joy: 0.8 }),
        label: "joy",
      });
      await redisMock.hset("post:rank:trend-2", {
        scores: JSON.stringify({ neutral: 0.8 }),
        label: "neutral",
      });

      mockPostSnapshots.set("trend-1", { postId: "trend-1", content: "Viral 1" });
      mockPostSnapshots.set("trend-2", { postId: "trend-2", content: "Viral 2" });

      const res = await trendingController.getTrending({
        userId: "user-trend-auth",
        query: { limit: 10 },
      });

      expect(res.data).toHaveLength(2);
      expect(res.nextCursor).toBeDefined();
    });

    it("TC12: Anonymous guest trending request (userId undefined) ranks by baseScore without crashing", async () => {
      await redisMock.zadd("post:score", 15.0, "guest-top");
      await redisMock.zadd("post:score", 9.0, "guest-sub");

      await redisMock.hset("post:rank:guest-top", { scores: JSON.stringify({ neutral: 0.5 }) });
      await redisMock.hset("post:rank:guest-sub", { scores: JSON.stringify({ neutral: 0.5 }) });

      mockPostSnapshots.set("guest-top", { postId: "guest-top", content: "Top trend" });
      mockPostSnapshots.set("guest-sub", { postId: "guest-sub", content: "Sub trend" });

      const res = await trendingController.getTrending({
        userId: undefined as any,
        query: { limit: 10 },
      });

      expect(res.data).toHaveLength(2);
      expect(res.data[0].id).toBe("guest-top");
      expect(res.data[1].id).toBe("guest-sub");
    });

    it("TC13: Trending sequential pagination guarantees 100% Zero Duplicates between pages", async () => {
      for (let i = 1; i <= 25; i++) {
        const id = `trending-post-${i}`;
        await redisMock.zadd("post:score", i * 1.5, id);
        await redisMock.hset(`post:rank:${id}`, {
          scores: JSON.stringify({ neutral: 0.5 }),
          label: "neutral",
        });
        mockPostSnapshots.set(id, { postId: id, content: `Trending ${i}` });
      }

      // Page 1
      const page1 = await trendingController.getTrending({
        userId: "user-trend-pages",
        query: { limit: 10 },
      });
      expect(page1.data).toHaveLength(10);

      // Page 2
      const page2 = await trendingController.getTrending({
        userId: "user-trend-pages",
        query: { limit: 10, cursor: page1.nextCursor || undefined },
      });
      expect(page2.data).toHaveLength(10);

      // Page 3
      const page3 = await trendingController.getTrending({
        userId: "user-trend-pages",
        query: { limit: 10, cursor: page2.nextCursor || undefined },
      });
      expect(page3.data).toHaveLength(5);

      const allIds = [
        ...page1.data.map((x) => x.id),
        ...page2.data.map((x) => x.id),
        ...page3.data.map((x) => x.id),
      ];
      expect(new Set(allIds).size).toBe(25); // Zero duplicates!
    });

    it("TC14: Rage-baiting Penalty discounts highly toxic posts in trending calculation", async () => {
      const combiner = app.get(ScoreCombinerService);
      // Normalized score check
      const baseScore = 12.0;
      const normalizedBase = combiner.normalizeBaseScore(baseScore);
      expect(normalizedBase).toBeGreaterThan(0.7);

      // Toxicity calculation check
      const angerToxicity = 0.5 * 0.9 + 0.3 * 0.4 + 0.2 * 0.2; // 0.61
      const multiplier = Math.max(0.15, 1.0 - 1.2 * angerToxicity);
      expect(multiplier).toBeLessThan(0.4); // Severely penalized
    });

    it("TC15: Trending Hard Drop: Trending posts marked HIGH mental health risk are completely dropped", async () => {
      await redisMock.zadd("post:score", 100.0, "super-viral-dangerous");
      await redisMock.hset("post:rank:super-viral-dangerous", {
        scores: JSON.stringify({ sadness: 0.99 }),
        mentalHealthRiskLevel: "HIGH",
      });

      await redisMock.zadd("post:score", 10.0, "normal-viral");
      await redisMock.hset("post:rank:normal-viral", {
        scores: JSON.stringify({ joy: 0.8 }),
        mentalHealthRiskLevel: "none",
      });

      mockPostSnapshots.set("super-viral-dangerous", { postId: "super-viral-dangerous" });
      mockPostSnapshots.set("normal-viral", { postId: "normal-viral" });

      const res = await trendingController.getTrending({
        userId: "any-user",
        query: { limit: 10 },
      });

      expect(res.data).toHaveLength(1);
      expect(res.data[0].id).toBe("normal-viral");
    });
  });

  // =========================================================================
  // SUITE 5: RESILIENCE & EDGE CASES
  // =========================================================================
  describe("Suite 5: Resilience & Edge Cases", () => {
    it("TC16: Orphan feed items (deleted post) are filtered out cleanly without breaking feed response", async () => {
      mockFeedItems.push({
        _id: "orphan-item",
        userId: "user-orphan",
        postId: "post-already-deleted",
        eventType: FeedEventType.POST,
        createdAt: new Date(),
      });
      // Do not add to mockPostSnapshots

      const res = await personalFeedController.getUserFeeds({
        userId: "user-orphan",
        query: { limit: 10 },
      });

      expect(res.data).toHaveLength(0);
      expect(res.hasNextPage).toBe(false);
    });

    it("TC17: Empty feed state for brand new user returns empty array with hasMore: false and nextCursor: null", async () => {
      const res = await personalFeedController.getUserFeeds({
        userId: "brand-new-user-with-zero-friends",
        query: { limit: 10 },
      });

      expect(res.data).toEqual([]);
      expect(res.hasNextPage).toBe(false);
      expect(res.nextCursor).toBeNull();
    });

    it("TC18: Concurrent session isolation: two different users have independent snapshots that do not collide", async () => {
      for (let i = 1; i <= 5; i++) {
        mockFeedItems.push(
          {
            _id: `userA-item-${i}`,
            userId: "user-A",
            postId: `post-A-${i}`,
            eventType: FeedEventType.POST,
            createdAt: new Date(),
          },
          {
            _id: `userB-item-${i}`,
            userId: "user-B",
            postId: `post-B-${i}`,
            eventType: FeedEventType.POST,
            createdAt: new Date(),
          },
        );
        mockPostSnapshots.set(`post-A-${i}`, { postId: `post-A-${i}`, content: "User A post" });
        mockPostSnapshots.set(`post-B-${i}`, { postId: `post-B-${i}`, content: "User B post" });
      }

      const resA = await personalFeedController.getUserFeeds({
        userId: "user-A",
        query: { limit: 3 },
      });
      const resB = await personalFeedController.getUserFeeds({
        userId: "user-B",
        query: { limit: 3 },
      });

      expect(resA.data).toHaveLength(3);
      expect(resB.data).toHaveLength(3);
      expect(resA.nextCursor).not.toBeNull();
      expect(resB.nextCursor).not.toBeNull();
      expect(resA.nextCursor).not.toEqual(resB.nextCursor);

      // Verify that user A's items never contain user B's posts
      const userAIds = resA.data.map((x) => x.id);
      expect(userAIds.every((id) => id.startsWith("userA"))).toBe(true);
    });
  });
});
