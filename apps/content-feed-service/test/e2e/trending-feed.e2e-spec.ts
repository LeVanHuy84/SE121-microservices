import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { getModelToken, MongooseModule } from "@nestjs/mongoose";
import { getRedisConnectionToken } from "@nestjs-modules/ioredis";
import {
  MongoDBContainer,
  StartedMongoDBContainer,
} from "@testcontainers/mongodb";
import { RedisContainer, StartedRedisContainer } from "@testcontainers/redis";
import Redis from "ioredis";
import mongoose, { Model } from "mongoose";
import { of } from "rxjs";
import {
  Emotion,
  InteractionType,
  RiskHintLevel,
  FeedEventType,
  InterventionType,
} from "@repo/dtos";
import { FeedInterleaverService } from "../../src/modules/feed/feed-pipeline/services/feed-interleaver.service";

import { TrendingController } from "../../src/modules/feed/feed-pipeline/controllers/trending.controller";
import { TrendingService } from "../../src/modules/feed/feed-pipeline/services/trending.service";
import { TrendingWorker } from "../../src/modules/feed/feed-pipeline/services/trending-score-worker";
import { ScoreCombinerService } from "../../src/modules/feed/ranking/services/score-combiner.service";
import { EmotionFeatureService } from "../../src/modules/feed/ranking/services/emotion-feature.service";
import { AffinityService } from "../../src/modules/feed/affinity/affinity.service";
import { SnapshotRepository } from "../../src/modules/feed/mongo/repository/snapshot.repository";
import { ReactionService } from "../../src/modules/post/reaction/reaction.service";
import { UserClientService } from "../../src/modules/post/client/user-client.service";
import { MICROSERVICES_CLIENT } from "../../src/constant";
import {
  FeedItem,
  FeedItemDocument,
  FeedItemSchema,
} from "../../src/modules/feed/mongo/schema/feed-item.schema";
import {
  PostSnapshot,
  PostSnapshotDocument,
  PostSnapshotSchema,
} from "../../src/modules/feed/mongo/schema/post-snapshot.schema";
import {
  ShareSnapshot,
  ShareSnapshotDocument,
  ShareSnapshotSchema,
} from "../../src/modules/feed/mongo/schema/share-snapshot.schema";

// Load 120 PhoBERT Golden Posts
const goldenPosts = require("../fixtures/golden-recommendation-posts.json");

describe("Trending Feed Recommendation, EMA Distress Adaptation & Virality E2E Test Suite", () => {
  let mongoContainer: StartedMongoDBContainer;
  let redisContainer: StartedRedisContainer;
  let redisClient: Redis;
  let mongoConnection: typeof mongoose;

  let app: INestApplication;
  let trendingController: TrendingController;
  let trendingWorker: TrendingWorker;
  let affinityService: AffinityService;

  let postSnapshotModel: Model<PostSnapshotDocument>;

  // Mutable mock state for User Emotion Features per test case
  let mockUserEmotionState: any = {
    riskScore: 0.1,
    recentNegativityScore: 0.1,
    negativeRatio7d: 0.1,
    emotionVolatility7d: 0.1,
    emotionMomentum: 0.0,
    userEmotionPreference: {},
  };

  jest.setTimeout(180000);

  beforeAll(async () => {
    // 1. Start Testcontainers
    redisContainer = await new RedisContainer("redis:7-alpine").start();
    mongoContainer = await new MongoDBContainer("mongo:6.0").start();

    const redisHost = redisContainer.getHost();
    const redisPort = redisContainer.getPort();
    const rawMongoUri = mongoContainer.getConnectionString();
    const mongoUri = rawMongoUri.includes("?")
      ? `${rawMongoUri}&directConnection=true`
      : `${rawMongoUri}?directConnection=true`;

    redisClient = new Redis({
      host: redisHost,
      port: redisPort,
      maxRetriesPerRequest: 3,
    });

    mongoConnection = await mongoose.connect(mongoUri, {
      directConnection: true,
    });

    // 2. Build Testing Module
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongoUri, { directConnection: true }),
        MongooseModule.forFeature([
          { name: FeedItem.name, schema: FeedItemSchema },
          { name: PostSnapshot.name, schema: PostSnapshotSchema },
          { name: ShareSnapshot.name, schema: ShareSnapshotSchema },
        ]),
      ],
      controllers: [TrendingController],
      providers: [
        TrendingService,
        FeedInterleaverService,
        TrendingWorker,
        AffinityService,
        SnapshotRepository,
        ScoreCombinerService,
        EmotionFeatureService,
        {
          provide: getRedisConnectionToken(),
          useValue: redisClient,
        },
        {
          provide: ReactionService,
          useValue: {
            getReactedTypesBatch: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: UserClientService,
          useValue: {
            getUserInfos: jest.fn().mockImplementation((ids: string[]) => {
              const res: Record<string, any> = {};
              for (const id of ids) {
                res[id] = {
                  id,
                  firstName: "Author",
                  lastName: "Mock",
                  avatarUrl: "",
                };
              }
              return Promise.resolve(res);
            }),
          },
        },
        {
          provide: MICROSERVICES_CLIENT.USER_SOCIAL_SERVICE,
          useValue: {
            send: jest.fn().mockReturnValue(of([])),
            emit: jest.fn().mockReturnValue(of(true)),
          },
        },
        {
          provide: "EMOTION_INTELLIGENCE_SERVICE",
          useValue: {
            send: jest.fn().mockImplementation(() => of(mockUserEmotionState)),
            emit: jest.fn().mockReturnValue(of(true)),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    trendingController =
      moduleFixture.get<TrendingController>(TrendingController);
    trendingWorker = moduleFixture.get<TrendingWorker>(TrendingWorker);
    affinityService = moduleFixture.get<AffinityService>(AffinityService);

    postSnapshotModel = moduleFixture.get<Model<PostSnapshotDocument>>(
      getModelToken(PostSnapshot.name),
    );
  });

  afterAll(async () => {
    if (app) await app.close();
    if (redisClient) await redisClient.quit();
    if (mongoConnection) await mongoose.disconnect();
    if (redisContainer) await redisContainer.stop();
    if (mongoContainer) await mongoContainer.stop();
  });

  beforeEach(async () => {
    await redisClient.flushall();
    await postSnapshotModel.deleteMany({});

    mockUserEmotionState = {
      riskScore: 0.1,
      recentNegativityScore: 0.1,
      negativeRatio7d: 0.1,
      emotionVolatility7d: 0.1,
      emotionMomentum: 0.0,
      userEmotionPreference: {},
    };

    // Seed all 120 PhoBERT Golden Posts
    await postSnapshotModel.insertMany(goldenPosts);
  });

  function getReturnedPostIds(res: { data: any[] }): string[] {
    return res.data.map((x) => x.item?.postId || x.id);
  }

  async function seedTrendingPostWithWorker(
    postId: string,
    engagement: { reactions: number; comments: number; shares: number },
    createdAt = Date.now(),
    overrides?: { riskHintLevel?: RiskHintLevel },
  ) {
    const post = goldenPosts.find((p: any) => p.postId === postId);
    if (!post) throw new Error(`Post ${postId} not found in golden fixtures`);

    await redisClient.hset(`post:meta:${postId}`, {
      createdAt: String(createdAt),
    });
    await redisClient.hset(`post:engagement:${postId}`, {
      reactions: String(engagement.reactions),
      comments: String(engagement.comments),
      shares: String(engagement.shares),
    });
    await redisClient.hset(`post:rank:${postId}`, {
      label:
        post.emotionFeature?.label || post.emotionFeature?.primaryEmotion || "",
      scores: JSON.stringify(post.emotionFeature?.scores || {}),
      intensity: String(post.emotionFeature?.intensity || 0),
      confidence: String(post.emotionFeature?.confidence || 0),
      mentalHealthRiskLevel:
        post.emotionFeature?.mentalHealthRiskLevel || "none",
      riskHintLevel:
        overrides?.riskHintLevel ||
        post.emotionFeature?.riskHintLevel ||
        "none",
      authorId: post.userId || "author-1",
    });

    await (trendingWorker as any).recomputeScores([postId]);
  }

  // =========================================================================
  // SUITE T1: TRENDING SCORING ENGINE & VIRALITY MECHANICS (TrendingWorker)
  // =========================================================================
  describe("Suite T1: Trending Scoring Engine & Virality Mechanics", () => {
    it("T1.1: Deep engagement (Shares x5, Comments x2) outranks shallow reactions (Likes x1)", async () => {
      // Post A: 500 reactions, 10 comments, 2 shares -> weighted = 500 + 20 + 10 + 1 = 531
      // Post B: 100 reactions, 150 comments, 80 shares -> weighted = 100 + 300 + 400 + 1 = 801
      // Both posts created at same time
      const now = Date.now();
      await seedTrendingPostWithWorker(
        "golden-joy-001",
        { reactions: 500, comments: 10, shares: 2 },
        now,
      );
      await seedTrendingPostWithWorker(
        "golden-joy-002",
        { reactions: 100, comments: 150, shares: 80 },
        now,
      );

      const res = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toHaveLength(2);
      // Post B with high deep engagement outranks Post A
      expect(returnedIds[0]).toBe("golden-joy-002");
      expect(returnedIds[1]).toBe("golden-joy-001");
    });

    it("T1.2: Exponential Time Decay & Freshness Boost penalizes stale viral posts", async () => {
      const now = Date.now();
      const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000;

      // Post A: 5 days old with massive engagement (20,000 reactions)
      // Post B: 1 hour old with moderate engagement (2,000 reactions)
      await seedTrendingPostWithWorker(
        "golden-joy-001",
        { reactions: 20000, comments: 1000, shares: 500 },
        fiveDaysAgo,
      );
      await seedTrendingPostWithWorker(
        "golden-joy-002",
        { reactions: 2000, comments: 300, shares: 100 },
        now,
      );

      const res = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toHaveLength(2);
      // Fresh post B outranks stale post A due to time decay exp(-age/48)
      expect(returnedIds[0]).toBe("golden-joy-002");
    });

    it("T1.3: Rage-baiting penalty discounts high viral anger/fear posts below clean positive posts", async () => {
      // Post A: High viral anger (10,000 reactions, anger 0.83)
      // Post B: Clean joy (6,000 reactions, joy 0.93)
      await seedTrendingPostWithWorker("golden-rage-001", {
        reactions: 10000,
        comments: 2000,
        shares: 500,
      });
      await seedTrendingPostWithWorker("golden-joy-001", {
        reactions: 6000,
        comments: 1000,
        shares: 300,
      });

      const res = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toHaveLength(2);
      // Rage-baiting penalty multiplier brings clean Joy post above viral Rage post
      expect(returnedIds[0]).toBe("golden-joy-001");
      expect(returnedIds[1]).toBe("golden-rage-001");
    });

    it("T1.4: Multi-emotion indexing populates categorical Redis emotion scoreboards", async () => {
      await seedTrendingPostWithWorker("golden-joy-001", {
        reactions: 5000,
        comments: 500,
        shares: 100,
      });
      await seedTrendingPostWithWorker("golden-calm-001", {
        reactions: 4000,
        comments: 400,
        shares: 100,
      });

      // Verify that Redis contains categorical emotion zset keys
      const joyScore = await redisClient.zscore(
        "post:emotion:joy:score",
        "golden-joy-001",
      );
      const calmScore = await redisClient.zscore(
        "post:emotion:neutral:score",
        "golden-calm-001",
      );

      expect(joyScore).not.toBeNull();
      expect(calmScore).not.toBeNull();
      expect(Number(joyScore)).toBeGreaterThan(0);
      expect(Number(calmScore)).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // SUITE T2: ETHICAL SAFETY GUARDRAILS ON TRENDING FEED
  // =========================================================================
  describe("Suite T2: Ethical Safety Guardrails on Trending Feed", () => {
    it("T2.1: Tier 1 Hard Drop: HIGH mental health risk posts are completely removed from Trending", async () => {
      // Very viral post (50,000 reactions) but marked with HIGH mental health risk
      await seedTrendingPostWithWorker("golden-toxic-high-001", {
        reactions: 50000,
        comments: 10000,
        shares: 5000,
      });
      await seedTrendingPostWithWorker("golden-calm-001", {
        reactions: 1500,
        comments: 200,
        shares: 50,
      });

      const res = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 5 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).not.toContain("golden-toxic-high-001");
      expect(returnedIds).toContain("golden-calm-001");
    });

    it("T2.2: Tier 2 Contextual Drop: High hostility posts (anger + fear > 0.5) are hidden for distressed users (> 0.5)", async () => {
      mockUserEmotionState = {
        riskScore: 0.7,
        recentNegativityScore: 0.7,
        negativeRatio7d: 0.6,
        emotionVolatility7d: 0.5,
        emotionMomentum: 0.2,
      };

      // golden-rage-001 has anger > 0.8 (anger + fear > 0.5)
      await seedTrendingPostWithWorker("golden-rage-001", {
        reactions: 8000,
        comments: 1000,
        shares: 300,
      });
      await seedTrendingPostWithWorker("golden-calm-001", {
        reactions: 4000,
        comments: 400,
        shares: 100,
      });

      // Query by distressed user
      const resDistressed = await trendingController.getTrending({
        userId: "user-distressed-t22",
        query: { limit: 5 },
      });
      const distressedIds = getReturnedPostIds(resDistressed);
      expect(distressedIds).not.toContain("golden-rage-001");
      expect(distressedIds).toContain("golden-calm-001");

      // Query by unauthenticated guest (should still see rage post)
      const resGuest = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 5 },
      });
      const guestIds = getReturnedPostIds(resGuest);
      expect(guestIds).toContain("golden-rage-001");
    });

    it("T2.3: Tier 2 Contextual Drop: Medium risk hint posts are suppressed for distressed users", async () => {
      mockUserEmotionState = {
        riskScore: 0.65,
        recentNegativityScore: 0.65,
        negativeRatio7d: 0.55,
        emotionVolatility7d: 0.4,
        emotionMomentum: 0.1,
      };

      await seedTrendingPostWithWorker(
        "golden-joy-001",
        { reactions: 5000, comments: 500, shares: 100 },
        Date.now(),
        { riskHintLevel: RiskHintLevel.MEDIUM },
      );
      await seedTrendingPostWithWorker(
        "golden-calm-001",
        { reactions: 4000, comments: 400, shares: 100 },
        Date.now(),
        { riskHintLevel: RiskHintLevel.NONE },
      );

      const res = await trendingController.getTrending({
        userId: "user-distressed-t23",
        query: { limit: 5 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).not.toContain("golden-joy-001");
      expect(returnedIds).toContain("golden-calm-001");
    });
  });

  // =========================================================================
  // SUITE T3: EMA DISTRESS & PERSONALIZED RE-RANKING ON TRENDING FEED
  // =========================================================================
  describe("Suite T3: EMA Distress & Personalized Re-ranking on Trending Feed", () => {
    it("T3.1: Guest user (unauthenticated) receives top trending posts strictly ranked by clean virality score", async () => {
      await seedTrendingPostWithWorker("golden-joy-001", {
        reactions: 8000,
        comments: 1000,
        shares: 200,
      });
      await seedTrendingPostWithWorker("golden-calm-001", {
        reactions: 4000,
        comments: 500,
        shares: 100,
      });
      await seedTrendingPostWithWorker("golden-joy-002", {
        reactions: 2000,
        comments: 200,
        shares: 50,
      });

      const res = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 3 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toHaveLength(3);
      expect(returnedIds[0]).toBe("golden-joy-001");
      expect(returnedIds[1]).toBe("golden-calm-001");
      expect(returnedIds[2]).toBe("golden-joy-002");
    });

    it("T3.2: Normal user state (Distress <= 0.3) incorporates Author & Category Affinity into Trending re-ranking", async () => {
      mockUserEmotionState = {
        riskScore: 0.1,
        recentNegativityScore: 0.1,
        negativeRatio7d: 0.1,
        emotionVolatility7d: 0.1,
        emotionMomentum: 0.0,
      };

      const userId = "user-normal-affinity-t32";
      // User has high affinity for author-joy-1
      for (let i = 0; i < 8; i++) {
        await affinityService.updateAffinity({
          userId,
          category: "joy",
          authorId: "author-joy-1",
          type: InteractionType.REACT,
        });
      }

      // Both posts have equal base virality and joy content:
      // Post A: author-joy-1 (golden-joy-001 - high affinity)
      // Post B: author-joy-2 (golden-joy-002 - low affinity)
      await seedTrendingPostWithWorker("golden-joy-002", {
        reactions: 3000,
        comments: 300,
        shares: 100,
      });
      await seedTrendingPostWithWorker("golden-joy-001", {
        reactions: 3000,
        comments: 300,
        shares: 100,
      });

      const res = await trendingController.getTrending({
        userId,
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toHaveLength(2);
      // High affinity author's post is elevated on Trending
      expect(returnedIds[0]).toBe("golden-joy-001");
    });

    it("T3.3: Authenticated distressed user (Distress > 0.6) elevates Calming Bridge content on Trending", async () => {
      mockUserEmotionState = {
        riskScore: 0.75,
        recentNegativityScore: 0.7,
        negativeRatio7d: 0.65,
        emotionVolatility7d: 0.5,
        emotionMomentum: 0.2,
        userEmotionPreference: { sadness: 0.85, neutral: 0.15 },
      };

      await seedTrendingPostWithWorker("golden-joy-001", {
        reactions: 3000,
        comments: 300,
        shares: 100,
      });
      await seedTrendingPostWithWorker("golden-calm-001", {
        reactions: 3000,
        comments: 300,
        shares: 100,
      });

      const res = await trendingController.getTrending({
        userId: "user-trending-distressed-t33",
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toHaveLength(2);
      // Calming neutral post is elevated to #1 over high-joy post for distressed user
      expect(returnedIds[0]).toBe("golden-calm-001");
    });

    it("T3.4: Iso-Principle transition on Trending: Distressed sad user ranks Calming > Empathetic Sadness", async () => {
      mockUserEmotionState = {
        riskScore: 0.8,
        recentNegativityScore: 0.8,
        negativeRatio7d: 0.75,
        emotionVolatility7d: 0.55,
        emotionMomentum: 0.2,
        userEmotionPreference: { sadness: 0.85, neutral: 0.15 },
      };

      // Equal base engagement
      await seedTrendingPostWithWorker("golden-sad-001", {
        reactions: 2500,
        comments: 250,
        shares: 80,
      });
      await seedTrendingPostWithWorker("golden-calm-001", {
        reactions: 2500,
        comments: 250,
        shares: 80,
      });

      const res = await trendingController.getTrending({
        userId: "user-trending-iso-t34",
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds[0]).toBe("golden-calm-001");
      expect(returnedIds[1]).toBe("golden-sad-001");
    });
    it("T3.5: Distressed user: Tail pruning drops extreme sad posts and Pacing interleaves negative content", async () => {
      mockUserEmotionState = {
        riskScore: 0.75,
        recentNegativityScore: 0.7,
        negativeRatio7d: 0.65,
        emotionVolatility7d: 0.5,
        emotionMomentum: 0.2,
        userEmotionPreference: { sadness: 0.85, neutral: 0.15 },
      };

      // Seed 2 extreme sad posts (sadness > 0.6) and 2 calm posts
      await seedTrendingPostWithWorker("golden-sad-002", {
        reactions: 8000,
        comments: 800,
        shares: 300,
      });
      await seedTrendingPostWithWorker("golden-sad-003", {
        reactions: 7000,
        comments: 700,
        shares: 250,
      });
      await seedTrendingPostWithWorker("golden-calm-001", {
        reactions: 4000,
        comments: 400,
        shares: 100,
      });
      await seedTrendingPostWithWorker("golden-calm-002", {
        reactions: 3000,
        comments: 300,
        shares: 80,
      });

      const res = await trendingController.getTrending({
        userId: "user-distressed-t35",
        query: { limit: 10 },
      });

      const returnedIds = getReturnedPostIds(res);
      // Extreme sad posts are pruned from the session tail for distressed users
      expect(returnedIds).not.toContain("golden-sad-002");
      expect(returnedIds).not.toContain("golden-sad-003");
      // Calming posts are retained
      expect(returnedIds).toContain("golden-calm-001");
      expect(returnedIds).toContain("golden-calm-002");
    });
  });

  // =========================================================================
  // SUITE T4: EMOTION-FILTERED TRENDING FEEDS (mainEmotion)
  // =========================================================================
  describe("Suite T4: Emotion-Filtered Trending Feeds", () => {
    it("T4.1: Querying mainEmotion = 'joy' filters only Joy Trending Leaderboard", async () => {
      await seedTrendingPostWithWorker("golden-joy-001", {
        reactions: 6000,
        comments: 600,
        shares: 200,
      });
      await seedTrendingPostWithWorker("golden-calm-001", {
        reactions: 8000,
        comments: 800,
        shares: 300,
      });

      const res = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 5, mainEmotion: Emotion.JOY },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toContain("golden-joy-001");
      expect(returnedIds).not.toContain("golden-calm-001");
    });

    it("T4.2: Querying mainEmotion = 'sadness' retrieves safe sad trending posts while excluding high-risk", async () => {
      await seedTrendingPostWithWorker("golden-sad-001", {
        reactions: 5000,
        comments: 500,
        shares: 150,
      });
      await seedTrendingPostWithWorker("golden-toxic-high-001", {
        reactions: 10000,
        comments: 1000,
        shares: 500,
      });

      const res = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 5, mainEmotion: Emotion.SADNESS },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toContain("golden-sad-001");
      expect(returnedIds).not.toContain("golden-toxic-high-001");
    });
  });

  // =========================================================================
  // SUITE T5: TRENDING SESSION SNAPSHOT & MULTI-PAGE PAGINATION
  // =========================================================================
  describe("Suite T5: Trending Session Snapshot & Multi-Page Pagination", () => {
    it("T5.1: Multi-page navigation across trending candidates guarantees 100% Zero Duplicates", async () => {
      // Seed 25 trending candidates
      for (let i = 0; i < 25; i++) {
        const post = goldenPosts[i];
        await seedTrendingPostWithWorker(post.postId, {
          reactions: 1000 + (25 - i) * 100,
          comments: 50,
          shares: 20,
        });
      }

      // Page 1
      const p1 = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 10 },
      });
      expect(p1.data).toHaveLength(10);
      expect(p1.hasNextPage).toBe(true);

      // Page 2
      const p2 = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 10, cursor: p1.nextCursor! },
      });
      expect(p2.data).toHaveLength(10);
      expect(p2.hasNextPage).toBe(true);

      // Page 3
      const p3 = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 10, cursor: p2.nextCursor! },
      });
      expect(p3.data.length).toBeGreaterThan(0);

      const allIds = [
        ...getReturnedPostIds(p1),
        ...getReturnedPostIds(p2),
        ...getReturnedPostIds(p3),
      ];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length); // 100% Zero Duplicates!
    });

    it("T5.2: Hydration self-healing skips deleted/orphan MongoDB posts without breaking Trending response", async () => {
      // Seed 2 posts into Redis ZSET
      await seedTrendingPostWithWorker("golden-joy-001", {
        reactions: 5000,
        comments: 500,
        shares: 100,
      });
      await seedTrendingPostWithWorker("golden-calm-001", {
        reactions: 4000,
        comments: 400,
        shares: 100,
      });

      // Delete golden-joy-001 from MongoDB post_snapshots to simulate orphan item
      await postSnapshotModel.deleteOne({ postId: "golden-joy-001" });

      const res = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 5 },
      });

      const returnedIds = getReturnedPostIds(res);
      // Orphan post is cleanly dropped during hydration, valid post is returned
      expect(returnedIds).not.toContain("golden-joy-001");
      expect(returnedIds).toContain("golden-calm-001");
    });

    it("T5.3: Expired trending session cursor gracefully triggers fallback session creation without error", async () => {
      await seedTrendingPostWithWorker("golden-joy-001", {
        reactions: 5000,
        comments: 500,
        shares: 100,
      });
      await seedTrendingPostWithWorker("golden-calm-001", {
        reactions: 4000,
        comments: 400,
        shares: 100,
      });

      const p1 = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 1 },
      });
      expect(p1.nextCursor).toBeDefined();

      // Flush Redis trending session keys to simulate TTL expiry
      const keys = await redisClient.keys("trending:session:*");
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }

      // Query Page 2 with expired cursor: fallback to new session cleanly
      const p2 = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 1, cursor: p1.nextCursor! },
      });

      expect(p2).toBeDefined();
      expect(p2.data.length).toBeGreaterThan(0);
      expect(p2.data[0].id).toBeDefined();
    });
    it("T5.4: Two-Tier Infinite Discovery safely applies Safety Guardrails and Re-ranking to dynamically fetched batches", async () => {
      // Seed 12 posts: First 10 are joy posts, 11th is HIGH risk toxic post, 12th is calm post
      for (let i = 1; i <= 10; i++) {
        const id = `golden-joy-0${i < 10 ? "0" + i : i}`;
        await seedTrendingPostWithWorker(id, {
          reactions: 5000 - i * 100,
          comments: 200,
          shares: 50,
        });
      }

      // 11th post: High engagement toxic post (mentalHealthRiskLevel = HIGH)
      await seedTrendingPostWithWorker("golden-toxic-high-001", {
        reactions: 3500,
        comments: 100,
        shares: 40,
      });

      // 12th post: Safe calm post
      await seedTrendingPostWithWorker("golden-calm-001", {
        reactions: 3000,
        comments: 100,
        shares: 30,
      });

      // Request Page 1 (offset 0 -> 10 items)
      const p1 = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 10 },
      });
      expect(p1.data).toHaveLength(10);
      expect(p1.hasNextPage).toBe(true);

      // Request Page 2 with cursor (triggers Two-Tier Infinite Discovery)
      const p2 = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 10, cursor: p1.nextCursor! },
      });

      const p2Ids = getReturnedPostIds(p2);
      // Verify that newly discovered batch filtered out HIGH risk post via Guardrails
      expect(p2Ids).not.toContain("golden-toxic-high-001");
      // Safe calm post is delivered
      expect(p2Ids).toContain("golden-calm-001");
    });
    it("T5.5: Scan-Limit Starvation Resilience: Deep infinite scrolling accumulates candidates across batches even when intermediate candidates are heavily pruned", async () => {
      mockUserEmotionState = {
        riskScore: 0.75,
        recentNegativityScore: 0.7,
        negativeRatio7d: 0.65,
        emotionVolatility7d: 0.5,
        emotionMomentum: 0.2,
        userEmotionPreference: { sadness: 0.85, neutral: 0.15 },
      };

      // 1. Seed initial 3 calm posts (totalLen = 3, so Page 1 with limit 2 has next page)
      await seedTrendingPostWithWorker("golden-calm-001", {
        reactions: 10000,
        comments: 1000,
        shares: 200,
      });
      await seedTrendingPostWithWorker("golden-calm-002", {
        reactions: 9000,
        comments: 900,
        shares: 180,
      });
      await seedTrendingPostWithWorker("golden-calm-003", {
        reactions: 8000,
        comments: 800,
        shares: 150,
      });

      // Request Page 1 (limit 2)
      const p1 = await trendingController.getTrending({
        userId: "user-distressed-t55",
        query: { limit: 2 },
      });
      const p1Ids = getReturnedPostIds(p1);
      expect(p1Ids).toHaveLength(2);
      expect(p1Ids[0]).toBe("golden-calm-001");
      expect(p1Ids[1]).toBe("golden-calm-002");
      expect(p1.hasNextPage).toBe(true);

      // 2. Dynamically seed a block of 10 extreme sad posts followed by 1 calm post
      for (let i = 2; i <= 11; i++) {
        const id = `golden-sad-0${i < 10 ? "0" + i : i}`;
        await seedTrendingPostWithWorker(id, {
          reactions: 5000 - i * 100,
          comments: 200,
          shares: 50,
        });
      }
      await seedTrendingPostWithWorker("golden-calm-004", {
        reactions: 3000,
        comments: 100,
        shares: 30,
      });

      // Request Page 2 (limit 2, with cursor, offset = 2)
      // Accumulation loop must bypass intermediate pruned posts and reach golden-calm-004 without starving
      const p2 = await trendingController.getTrending({
        userId: "user-distressed-t55",
        query: { limit: 2, cursor: p1.nextCursor! },
      });
      const p2Ids = getReturnedPostIds(p2);
      expect(p2Ids).toHaveLength(2);
      expect(p2Ids[0]).toBe("golden-calm-003");
      expect(p2Ids[1]).toBe("golden-calm-004");

      // Intermediate sad posts must remain pruned
      for (let i = 2; i <= 11; i++) {
        const id = `golden-sad-0${i < 10 ? "0" + i : i}`;
        expect(p2Ids).not.toContain(id);
      }
    });
  });

  // =========================================================================
  // SUITE T6: TRENDING SAFE SPACE INTERVENTION & CROSS-FEED COOLDOWN (SPRINT 3)
  // =========================================================================
  describe("Suite T6: Trending Safe Space Intervention & Cross-Feed Cooldown", () => {
    it("T6.1: Distressed user (Distress > 0.5) scrolling Trending Feed receives Safe Space Card at slot 5 on Page 1", async () => {
      mockUserEmotionState = {
        riskScore: 0.85,
        recentNegativityScore: 0.8,
        negativeRatio7d: 0.75,
        emotionVolatility7d: 0.5,
        emotionMomentum: 0.3,
        userEmotionPreference: { sadness: 0.7, neutral: 0.3 },
      };

      // Seed 12 calm & joyful trending posts so trending has >= 10 candidates
      for (let i = 1; i <= 12; i++) {
        await seedTrendingPostWithWorker(
          `golden-calm-${String(i).padStart(3, "0")}`,
          { reactions: 5000 + i * 100, comments: 200, shares: 50 },
        );
      }

      const res = await trendingController.getTrending({
        userId: "user-trending-distressed",
        query: { limit: 10 },
      });

      // 1. Array length is 11 (10 posts + 1 card)
      expect(res.data).toHaveLength(11);

      // 2. Slot 5 (index 4) is the Safe Space Intervention Card
      const card = res.data[4];
      expect(card.type).toBe(FeedEventType.INTERVENTION);
      expect(card.intervention).toBeDefined();
      expect(card.intervention?.type).toBe(
        InterventionType.AI_CHATBOT_SAFE_SPACE,
      );
      expect(card.intervention?.title).toBe("Góc nhỏ lắng nghe");
      expect(card.intervention?.buttonText).toBe("Trò chuyện cùng Trợ lý AI");

      // 3. Shared Redis Cooldown TTL key is set
      const cooldownKey = "feed:intervention:cooldown:user-trending-distressed";
      const ttl = await redisClient.ttl(cooldownKey);
      expect(ttl).toBeGreaterThan(0);
    });

    it("T6.2: Global Cross-Feed Cooldown: Active cooldown prevents duplicate card on repeated Trending visits within 12h", async () => {
      mockUserEmotionState = {
        riskScore: 0.85,
        recentNegativityScore: 0.8,
        negativeRatio7d: 0.75,
        emotionVolatility7d: 0.5,
        emotionMomentum: 0.3,
      };

      for (let i = 1; i <= 12; i++) {
        await seedTrendingPostWithWorker(
          `golden-calm-${String(i).padStart(3, "0")}`,
          { reactions: 5000 + i * 100, comments: 200, shares: 50 },
        );
      }

      // Actively set the shared cooldown key (as if user already saw the card on Personal Feed or earlier Trending)
      const cooldownKey = "feed:intervention:cooldown:user-trending-cooldown";
      await redisClient.set(cooldownKey, "1", "EX", 43200);

      const res = await trendingController.getTrending({
        userId: "user-trending-cooldown",
        query: { limit: 10 },
      });

      // Exactly 10 posts, no intervention card
      expect(res.data).toHaveLength(10);
      const hasIntervention = res.data.some(
        (item) => item.type === FeedEventType.INTERVENTION,
      );
      expect(hasIntervention).toBe(false);
    });

    it("T6.3: Guest user (unauthenticated) queries Trending Feed with zero intervention cards", async () => {
      for (let i = 1; i <= 12; i++) {
        await seedTrendingPostWithWorker(
          `golden-calm-${String(i).padStart(3, "0")}`,
          { reactions: 5000 + i * 100, comments: 200, shares: 50 },
        );
      }

      const res = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 10 },
      });

      expect(res.data).toHaveLength(10);
      const hasIntervention = res.data.some(
        (item) => item.type === FeedEventType.INTERVENTION,
      );
      expect(hasIntervention).toBe(false);
    });
  });
});
