import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { getModelToken, MongooseModule } from "@nestjs/mongoose";
import { getRedisConnectionToken } from "@nestjs-modules/ioredis";
import { MongoDBContainer, StartedMongoDBContainer } from "@testcontainers/mongodb";
import { RedisContainer, StartedRedisContainer } from "@testcontainers/redis";
import Redis from "ioredis";
import mongoose, { Model } from "mongoose";
import { of } from "rxjs";
import {
  FeedEventType,
  ModerationAction,
  Audience,
} from "@repo/dtos";

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

describe("Feed Plumbing & Infrastructure E2E Test Suite (Testcontainers)", () => {
  let mongoContainer: StartedMongoDBContainer;
  let redisContainer: StartedRedisContainer;
  let redisClient: Redis;
  let mongoConnection: typeof mongoose;

  let app: INestApplication;
  let personalFeedController: PersonalFeedController;
  let trendingController: TrendingController;

  let feedItemModel: Model<FeedItemDocument>;
  let postSnapshotModel: Model<PostSnapshotDocument>;
  let shareSnapshotModel: Model<ShareSnapshotDocument>;

  // Increase timeout for container pulling/starting
  jest.setTimeout(180000);

  beforeAll(async () => {
    // 1. Start Ephemeral Redis & MongoDB Containers
    console.log("[Testcontainers] Starting ephemeral Redis container...");
    redisContainer = await new RedisContainer("redis:7-alpine").start();

    console.log("[Testcontainers] Starting ephemeral MongoDB container...");
    mongoContainer = await new MongoDBContainer("mongo:6.0").start();

    const redisHost = redisContainer.getHost();
    const redisPort = redisContainer.getPort();
    const rawMongoUri = mongoContainer.getConnectionString();
    const mongoUri = rawMongoUri.includes("?")
      ? `${rawMongoUri}&directConnection=true`
      : `${rawMongoUri}?directConnection=true`;

    console.log(`[Testcontainers] Redis online at ${redisHost}:${redisPort}`);
    console.log(`[Testcontainers] MongoDB online at ${mongoUri}`);

    // 2. Initialize Real Connections
    redisClient = new Redis({
      host: redisHost,
      port: redisPort,
      maxRetriesPerRequest: 3,
    });

    mongoConnection = await mongoose.connect(mongoUri, {
      directConnection: true,
    });

    // 3. Build NestJS Testing Module with Real Mongo & Real Redis
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongoUri, { directConnection: true }),
        MongooseModule.forFeature([
          { name: FeedItem.name, schema: FeedItemSchema },
          { name: PostSnapshot.name, schema: PostSnapshotSchema },
          { name: ShareSnapshot.name, schema: ShareSnapshotSchema },
        ]),
      ],
      controllers: [PersonalFeedController, TrendingController],
      providers: [
        PersonalFeedService,
        TrendingService,
        SnapshotRepository,
        {
          provide: getRedisConnectionToken(),
          useValue: redisClient,
        },
        {
          provide: ScoreCombinerService,
          useValue: {
            normalizeBaseScore: jest.fn().mockImplementation((score: number) => score / 1000),
            combine: jest.fn().mockReturnValue(0.7),
            calcScore: jest.fn().mockImplementation((post, distress) => {
              const eng =
                (post.stats?.reactions || 0) +
                (post.stats?.comments || 0) * 2;
              return 1.0 + Math.log(1 + eng);
            }),
          },
        },
        {
          provide: EmotionFeatureService,
          useValue: {
            getEmotionFeatures: jest.fn().mockResolvedValue({
              riskScore: 0.1,
              recentNegativityScore: 0.1,
              negativeRatio7d: 0.1,
              emotionVolatility7d: 0.1,
              emotionMomentum: 0.0,
            }),
            calcDistress: jest.fn().mockReturnValue(0.1),
            calcIsoPrincipleScore: jest.fn().mockReturnValue(0.5),
            calcEmotionScore: jest.fn().mockReturnValue(0.5),
          },
        },
        {
          provide: AffinityService,
          useValue: {
            getAffinity: jest.fn().mockResolvedValue({ category: {}, author: {} }),
            calcAffinityScore: jest.fn().mockReturnValue(0.1),
          },
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
                res[id] = { id, firstName: "Author", lastName: "Mock", avatarUrl: "" };
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
            send: jest.fn().mockReturnValue(of({})),
            emit: jest.fn().mockReturnValue(of(true)),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    personalFeedController = moduleFixture.get<PersonalFeedController>(
      PersonalFeedController,
    );
    trendingController =
      moduleFixture.get<TrendingController>(TrendingController);

    feedItemModel = moduleFixture.get<Model<FeedItemDocument>>(
      getModelToken(FeedItem.name),
    );
    postSnapshotModel = moduleFixture.get<Model<PostSnapshotDocument>>(
      getModelToken(PostSnapshot.name),
    );
    shareSnapshotModel = moduleFixture.get<Model<ShareSnapshotDocument>>(
      getModelToken(ShareSnapshot.name),
    );
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (redisClient) {
      await redisClient.quit();
    }
    if (mongoConnection) {
      await mongoose.disconnect();
    }
    if (redisContainer) {
      await redisContainer.stop();
    }
    if (mongoContainer) {
      await mongoContainer.stop();
    }
  });

  beforeEach(async () => {
    // Clean real container databases for 100% test isolation
    await redisClient.flushall();
    await feedItemModel.deleteMany({});
    await postSnapshotModel.deleteMany({});
    await shareSnapshotModel.deleteMany({});
  });

  // =========================================================================
  // TEST SUITE 1: REAL REDIS SESSION SNAPSHOT PAGINATION
  // =========================================================================
  describe("Suite 1: Real Redis Session Snapshot Pagination", () => {
    it("CTC1: Initial request creates real Redis List snapshot with TTL and returns Page 1", async () => {
      const now = new Date();

      // Seed 25 items directly into real MongoDB
      const feedDocs: any[] = [];
      const postDocs: any[] = [];
      for (let i = 1; i <= 25; i++) {
        const postId = `c-post-${i}`;
        feedDocs.push({
          userId: "user-c1",
          postId,
          snapshotId: postId,
          refId: postId,
          eventType: FeedEventType.POST,
          createdAt: new Date(now.getTime() - i * 1000),
        });
        postDocs.push({
          postId,
          snapshotId: postId,
          refId: postId,
          userId: `author-${i}`,
          content: `Real Mongo Post ${i}`,
          audience: Audience.PUBLIC,
          moderationAction: ModerationAction.ALLOW,
          postCreatedAt: new Date(now.getTime() - i * 1000),
          stats: { reactions: i * 5, comments: i, shares: 0 },
          mediaPreviews: [],
          emotionFeature: {
            primaryEmotion: "joy",
            confidence: 0.9,
            scores: { joy: 0.9 },
          },
        });
      }
      await feedItemModel.insertMany(feedDocs);
      await postSnapshotModel.insertMany(postDocs);

      // Call Controller
      const res = await personalFeedController.getUserFeeds({
        userId: "user-c1",
        query: { limit: 10 },
      });

      expect(res.data).toHaveLength(10);
      expect(res.hasNextPage).toBe(true);
      expect(res.nextCursor).toBeDefined();

      // Top item ranking verification (c-post-25 has highest engagement stats)
      expect((res.data[0].item as any).postId).toBe("c-post-25");

      // Verify that Redis contains the exact key and 25 items
      const keys = await redisClient.keys("feed:session:user-c1:all:*");
      expect(keys).toHaveLength(1);

      const listLen = await redisClient.llen(keys[0]);
      expect(listLen).toBe(25);

      const ttl = await redisClient.ttl(keys[0]);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(1200); // 20 minutes
    });

    it("CTC2: Multi-page consecutive navigation guarantees 100% Zero Duplicates on real DB", async () => {
      const now = new Date();
      const feedDocs: any[] = [];
      const postDocs: any[] = [];
      for (let i = 1; i <= 25; i++) {
        const postId = `c-post-seq-${i}`;
        feedDocs.push({
          userId: "user-c2",
          postId,
          snapshotId: postId,
          refId: postId,
          eventType: FeedEventType.POST,
          createdAt: new Date(now.getTime() - i * 1000),
        });
        postDocs.push({
          postId,
          snapshotId: postId,
          refId: postId,
          userId: `author-${i}`,
          content: `Sequential Post ${i}`,
          audience: Audience.PUBLIC,
          moderationAction: ModerationAction.ALLOW,
          postCreatedAt: new Date(now.getTime() - i * 1000),
          stats: { reactions: i, comments: 0, shares: 0 },
          mediaPreviews: [],
        });
      }
      await feedItemModel.insertMany(feedDocs);
      await postSnapshotModel.insertMany(postDocs);

      // Page 1
      const p1 = await personalFeedController.getUserFeeds({
        userId: "user-c2",
        query: { limit: 10 },
      });
      expect(p1.data).toHaveLength(10);
      expect(p1.hasNextPage).toBe(true);

      // Page 2
      const p2 = await personalFeedController.getUserFeeds({
        userId: "user-c2",
        query: { limit: 10, cursor: p1.nextCursor! },
      });
      expect(p2.data).toHaveLength(10);
      expect(p2.hasNextPage).toBe(true);

      // Page 3
      const p3 = await personalFeedController.getUserFeeds({
        userId: "user-c2",
        query: { limit: 10, cursor: p2.nextCursor! },
      });
      expect(p3.data).toHaveLength(5);
      expect(p3.hasNextPage).toBe(false);

      // Strict Zero Duplication Assertion
      const allIds = [
        ...p1.data.map((x) => x.id),
        ...p2.data.map((x) => x.id),
        ...p3.data.map((x) => x.id),
      ];
      expect(allIds).toHaveLength(25);
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(25);
    });

    it("CTC2b: Edge case: Identical scores and stats across 25 posts - tie-breaker preserves deterministic order and zero duplicates", async () => {
      const fixedDate = new Date("2026-10-25T10:00:00Z");
      const feedDocs: any[] = [];
      const postDocs: any[] = [];

      for (let i = 1; i <= 25; i++) {
        const postId = `c-post-tied-${i.toString().padStart(2, "0")}`;
        feedDocs.push({
          userId: "user-c-tied",
          postId,
          snapshotId: postId,
          refId: postId,
          eventType: FeedEventType.POST,
          createdAt: fixedDate,
        });
        postDocs.push({
          postId,
          snapshotId: postId,
          refId: postId,
          userId: "author-shared",
          content: `Identical metrics post ${i}`,
          audience: Audience.PUBLIC,
          moderationAction: ModerationAction.ALLOW,
          postCreatedAt: fixedDate,
          stats: { reactions: 10, comments: 2, shares: 1 },
          mediaPreviews: [],
          emotionFeature: {
            primaryEmotion: "joy",
            confidence: 0.8,
            scores: { joy: 0.8 },
          },
        });
      }
      await feedItemModel.insertMany(feedDocs);
      await postSnapshotModel.insertMany(postDocs);

      // Page 1
      const p1 = await personalFeedController.getUserFeeds({
        userId: "user-c-tied",
        query: { limit: 10 },
      });
      expect(p1.data).toHaveLength(10);
      expect(p1.hasNextPage).toBe(true);

      // Page 2
      const p2 = await personalFeedController.getUserFeeds({
        userId: "user-c-tied",
        query: { limit: 10, cursor: p1.nextCursor! },
      });
      expect(p2.data).toHaveLength(10);
      expect(p2.hasNextPage).toBe(true);

      // Page 3
      const p3 = await personalFeedController.getUserFeeds({
        userId: "user-c-tied",
        query: { limit: 10, cursor: p2.nextCursor! },
      });
      expect(p3.data).toHaveLength(5);
      expect(p3.hasNextPage).toBe(false);

      // 1. Strict Zero Duplication and Full Coverage Assertion under identical scores
      const allIds = [
        ...p1.data.map((x) => x.id),
        ...p2.data.map((x) => x.id),
        ...p3.data.map((x) => x.id),
      ];
      expect(allIds).toHaveLength(25);
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(25);

      // 2. Strict Tie-breaker Ordering: Sorted descending by itemId (b.itemId.localeCompare(a.itemId))
      const expectedSortedIds = [...allIds].sort((a, b) => b.localeCompare(a));
      expect(allIds).toEqual(expectedSortedIds);

      // 3. Determinism: Repeating request on Page 1 from existing session yields identical order
      const p1Repeat = await personalFeedController.getUserFeeds({
        userId: "user-c-tied",
        query: { limit: 10 },
      });
      expect(p1Repeat.data.map((x) => x.id)).toEqual(p1.data.map((x) => x.id));
    });

    it("CTC2c: Deep Archive Pagination - When initial candidate batch is exhausted, seamless expansion fetches older historical posts from MongoDB with zero duplicates", async () => {
      const now = new Date();

      // Seed 15 newer posts (Batch 1: 1 hour ago)
      const feedDocsBatch1: any[] = [];
      const postDocsBatch1: any[] = [];
      for (let i = 1; i <= 15; i++) {
        const postId = `c-post-new-${i.toString().padStart(2, "0")}`;
        feedDocsBatch1.push({
          userId: "user-deep-archive",
          postId,
          snapshotId: postId,
          refId: postId,
          eventType: FeedEventType.POST,
          createdAt: new Date(now.getTime() - i * 1000),
        });
        postDocsBatch1.push({
          postId,
          snapshotId: postId,
          refId: postId,
          userId: `author-${i}`,
          content: `Newer Post ${i}`,
          audience: Audience.PUBLIC,
          moderationAction: ModerationAction.ALLOW,
          postCreatedAt: new Date(now.getTime() - i * 1000),
          stats: { reactions: i * 5, comments: i, shares: 0 },
          mediaPreviews: [],
        });
      }
      await feedItemModel.insertMany(feedDocsBatch1);
      await postSnapshotModel.insertMany(postDocsBatch1);

      // Page 1: Fetches 10 items from initial 15 candidates
      const p1 = await personalFeedController.getUserFeeds({
        userId: "user-deep-archive",
        query: { limit: 10 },
      });
      expect(p1.data).toHaveLength(10);
      expect(p1.hasNextPage).toBe(true);

      // Page 2: Fetches remaining 5 items from initial 15 candidates
      const p2 = await personalFeedController.getUserFeeds({
        userId: "user-deep-archive",
        query: { limit: 5, cursor: p1.nextCursor! },
      });
      expect(p2.data).toHaveLength(5);

      // Now seed 10 older historical posts (Batch 2: 2 days ago)
      const twoDaysAgo = now.getTime() - 2 * 24 * 3600 * 1000;
      const feedDocsBatch2: any[] = [];
      const postDocsBatch2: any[] = [];
      for (let i = 1; i <= 10; i++) {
        const postId = `c-post-old-${i.toString().padStart(2, "0")}`;
        feedDocsBatch2.push({
          userId: "user-deep-archive",
          postId,
          snapshotId: postId,
          refId: postId,
          eventType: FeedEventType.POST,
          createdAt: new Date(twoDaysAgo - i * 1000),
        });
        postDocsBatch2.push({
          postId,
          snapshotId: postId,
          refId: postId,
          userId: `author-old-${i}`,
          content: `Older Historical Post ${i}`,
          audience: Audience.PUBLIC,
          moderationAction: ModerationAction.ALLOW,
          postCreatedAt: new Date(twoDaysAgo - i * 1000),
          stats: { reactions: i * 2, comments: 1, shares: 0 },
          mediaPreviews: [],
        });
      }
      await feedItemModel.insertMany(feedDocsBatch2);
      await postSnapshotModel.insertMany(postDocsBatch2);

      // Page 3: Calls with p2.nextCursor -> Triggers Deep Archive Expansion from MongoDB!
      const p3 = await personalFeedController.getUserFeeds({
        userId: "user-deep-archive",
        query: { limit: 10, cursor: p2.nextCursor! },
      });
      expect(p3.data).toHaveLength(10);
      expect(p3.hasNextPage).toBe(false);

      // Verify all 25 items across p1, p2, p3 are completely unique
      const allIds = [
        ...p1.data.map((x) => x.id),
        ...p2.data.map((x) => x.id),
        ...p3.data.map((x) => x.id),
      ];
      expect(allIds).toHaveLength(25);
      expect(new Set(allIds).size).toBe(25);
    });
  });

  // =========================================================================
  // TEST SUITE 2: DUAL-TIER SAFETY GUARDRAILS ON REAL MONGO REPOSITORY
  // =========================================================================
  describe("Suite 2: Dual-tier Safety Guardrails with Real MongoDB", () => {
    it("CTC3: Tier 1 Hard Drop: Real post with mentalHealthRiskLevel HIGH is never in feed", async () => {
      const now = new Date();

      await feedItemModel.create({
        userId: "user-guard",
        postId: "post-safe",
        snapshotId: "post-safe",
        refId: "post-safe",
        eventType: FeedEventType.POST,
        createdAt: now,
      });
      await postSnapshotModel.create({
        postId: "post-safe",
        snapshotId: "post-safe",
        refId: "post-safe",
        userId: "author-safe",
        content: "A safe supportive post",
        audience: Audience.PUBLIC,
        moderationAction: ModerationAction.ALLOW,
        postCreatedAt: now,
        mediaPreviews: [],
        emotionFeature: {
          primaryEmotion: "joy",
          confidence: 0.9,
          mentalHealthRiskLevel: "none",
        },
      });

      await feedItemModel.create({
        userId: "user-guard",
        postId: "post-toxic",
        snapshotId: "post-toxic",
        refId: "post-toxic",
        eventType: FeedEventType.POST,
        createdAt: now,
      });
      await postSnapshotModel.create({
        postId: "post-toxic",
        snapshotId: "post-toxic",
        refId: "post-toxic",
        userId: "author-toxic",
        content: "Dangerous harmful self-harm content",
        audience: Audience.PUBLIC,
        moderationAction: ModerationAction.HARD_BLOCK,
        postCreatedAt: now,
        mediaPreviews: [],
        emotionFeature: {
          primaryEmotion: "sadness",
          confidence: 0.95,
          mentalHealthRiskLevel: "HIGH", // Tier 1 trigger
        },
      });

      const res = await personalFeedController.getUserFeeds({
        userId: "user-guard",
        query: { limit: 10 },
      });

      expect(res.data).toHaveLength(1);
      expect(res.data[0].id).not.toBe("post-toxic");
    });
  });

  // =========================================================================
  // TEST SUITE 3: REAL REDIS TRENDING FEED VIRALITY & SESSION RE-RANKING
  // =========================================================================
  describe("Suite 3: Real Redis Trending Feed Virality & Session Re-ranking", () => {
    it("CTC4: Authenticated user trending query creates trending:session in real Redis", async () => {
      const now = new Date();

      // Seed 15 posts in Mongo
      const postDocs: any[] = [];
      for (let i = 1; i <= 15; i++) {
        const postId = `trend-p-${i}`;
        postDocs.push({
          postId,
          snapshotId: postId,
          refId: postId,
          userId: `author-${i}`,
          content: `Trending candidate ${i}`,
          audience: Audience.PUBLIC,
          moderationAction: ModerationAction.ALLOW,
          postCreatedAt: now,
          stats: { reactions: i * 10, comments: i * 2, shares: i },
          mediaPreviews: [],
        });
        // Populate real Redis ZSET trending:scores
        await redisClient.zadd("post:score", i * 100, postId);
        await redisClient.hset(`post:rank:${postId}`, {
          label: "joy",
          scores: JSON.stringify({ joy: 0.8 }),
          intensity: "0.8",
          confidence: "0.8",
          mentalHealthRiskLevel: "none",
          riskHintLevel: "none",
          authorId: `author-${i}`,
        });
      }
      await postSnapshotModel.insertMany(postDocs);

      const res = await trendingController.getTrending({
        userId: "user-trend-auth",
        query: { limit: 5 },
      });

      expect(res.data).toHaveLength(5);
      expect(res.hasNextPage).toBe(true);
      expect(res.nextCursor).toBeDefined();

      // Verify that trending session key exists in real Redis
      const keys = await redisClient.keys("trending:session:*");
      expect(keys.length).toBeGreaterThanOrEqual(1);

      const sessionItems = await redisClient.lrange(keys[0], 0, -1);
      expect(sessionItems.length).toBe(15);
    });

    it("CTC4b: Infinite Trending Streaming - Automatically pulls next batch from Redis ZSET when initial snapshot is exhausted", async () => {
      const now = new Date();

      // Seed 10 initial trending posts in Mongo and Redis ZSET
      const initialPosts: any[] = [];
      for (let i = 1; i <= 10; i++) {
        const postId = `trend-inf-${i}`;
        initialPosts.push({
          postId,
          snapshotId: postId,
          refId: postId,
          userId: `author-${i}`,
          content: `Initial Trending Candidate ${i}`,
          audience: Audience.PUBLIC,
          moderationAction: ModerationAction.ALLOW,
          postCreatedAt: now,
          stats: { reactions: i * 10, comments: i, shares: 0 },
          mediaPreviews: [],
        });
        await redisClient.zadd("post:score", i * 100, postId);
        await redisClient.hset(`post:rank:${postId}`, {
          label: "joy",
          scores: JSON.stringify({ joy: 0.8 }),
          intensity: "0.8",
          confidence: "0.8",
          mentalHealthRiskLevel: "none",
          riskHintLevel: "none",
          authorId: `author-${i}`,
        });
      }
      await postSnapshotModel.insertMany(initialPosts);

      // Page 1: Fetches 5 items (offset 0..4)
      const p1 = await trendingController.getTrending({
        userId: "user-inf-trend",
        query: { limit: 5 },
      });
      expect(p1.data).toHaveLength(5);
      expect(p1.hasNextPage).toBe(true);

      // Page 2: Fetches 5 items (offset 5..9) - exhausts initial 10 candidates
      const p2 = await trendingController.getTrending({
        userId: "user-inf-trend",
        query: { limit: 5, cursor: p1.nextCursor! },
      });
      expect(p2.data).toHaveLength(5);

      // Dynamically add 5 more trending posts to Redis ZSET
      const extendedPosts: any[] = [];
      for (let i = 11; i <= 15; i++) {
        const postId = `trend-inf-${i}`;
        extendedPosts.push({
          postId,
          snapshotId: postId,
          refId: postId,
          userId: `author-${i}`,
          content: `Extended Trending Candidate ${i}`,
          audience: Audience.PUBLIC,
          moderationAction: ModerationAction.ALLOW,
          postCreatedAt: now,
          stats: { reactions: i * 5, comments: 1, shares: 0 },
          mediaPreviews: [],
        });
        await redisClient.zadd("post:score", i * 50, postId);
        await redisClient.hset(`post:rank:${postId}`, {
          label: "joy",
          scores: JSON.stringify({ joy: 0.8 }),
          intensity: "0.8",
          confidence: "0.8",
          mentalHealthRiskLevel: "none",
          riskHintLevel: "none",
          authorId: `author-${i}`,
        });
      }
      await postSnapshotModel.insertMany(extendedPosts);

      // Page 3: Calls with p2.nextCursor -> Triggers Infinite Extension from Redis ZSET!
      const p3 = await trendingController.getTrending({
        userId: "user-inf-trend",
        query: { limit: 5, cursor: p2.nextCursor! },
      });
      expect(p3.data).toHaveLength(5);
      expect(p3.hasNextPage).toBe(false);

      // Verify all 15 trending items across p1, p2, p3 are completely unique
      const allTrendingIds = [
        ...p1.data.map((x) => x.id),
        ...p2.data.map((x) => x.id),
        ...p3.data.map((x) => x.id),
      ];
      expect(allTrendingIds).toHaveLength(15);
      expect(new Set(allTrendingIds).size).toBe(15);
    });

    it("CTC5: Guest user (unauthenticated) queries trending feed with zero crash", async () => {
      for (let i = 1; i <= 10; i++) {
        const postId = `guest-trend-${i}`;
        await postSnapshotModel.create({
          postId,
          userId: `author-${i}`,
          content: `Trending candidate ${i}`,
          audience: Audience.PUBLIC,
          moderationAction: ModerationAction.ALLOW,
          postCreatedAt: new Date(),
          stats: { reactions: i * 10, comments: i * 2, shares: i },
          mediaPreviews: [],
        });
        await redisClient.zadd("post:score", i * 100, postId);
        await redisClient.hset(`post:rank:${postId}`, {
          label: "joy",
          scores: JSON.stringify({ joy: 0.8 }),
          intensity: "0.8",
          confidence: "0.8",
          mentalHealthRiskLevel: "none",
          riskHintLevel: "none",
          authorId: `author-${i}`,
        });
      }

      const res = await trendingController.getTrending({
        userId: undefined,
        query: { limit: 5 },
      });

      expect(res.data).toBeDefined();
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.hasNextPage).toBe(true);
    });
  });
});
