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
  FeedEventType,
  Emotion,
  InteractionType,
  Audience,
  ModerationAction,
  InterventionType,
} from "@repo/dtos";

import { PersonalFeedController } from "../../src/modules/feed/feed-pipeline/controllers/personal-feed.controller";
import { PersonalFeedService } from "../../src/modules/feed/feed-pipeline/services/personal-feed.service";
import { FeedInterleaverService } from "../../src/modules/feed/feed-pipeline/services/feed-interleaver.service";
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

describe("Personal Feed Recommendation & Ethical AI E2E Test Suite", () => {
  let mongoContainer: StartedMongoDBContainer;
  let redisContainer: StartedRedisContainer;
  let redisClient: Redis;
  let mongoConnection: typeof mongoose;

  let app: INestApplication;
  let personalFeedController: PersonalFeedController;
  let affinityService: AffinityService;

  let feedItemModel: Model<FeedItemDocument>;
  let postSnapshotModel: Model<PostSnapshotDocument>;
  let shareSnapshotModel: Model<ShareSnapshotDocument>;

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
      controllers: [PersonalFeedController],
      providers: [
        PersonalFeedService,
        FeedInterleaverService,
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

    personalFeedController = moduleFixture.get<PersonalFeedController>(
      PersonalFeedController,
    );
    affinityService = moduleFixture.get<AffinityService>(AffinityService);

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
    if (app) await app.close();
    if (redisClient) await redisClient.quit();
    if (mongoConnection) await mongoose.disconnect();
    if (redisContainer) await redisContainer.stop();
    if (mongoContainer) await mongoContainer.stop();
  });

  beforeEach(async () => {
    await redisClient.flushall();
    await feedItemModel.deleteMany({});
    await postSnapshotModel.deleteMany({});
    await shareSnapshotModel.deleteMany({});

    mockUserEmotionState = {
      riskScore: 0.1,
      recentNegativityScore: 0.1,
      negativeRatio7d: 0.1,
      emotionVolatility7d: 0.1,
      emotionMomentum: 0.0,
      userEmotionPreference: {},
    };

    // Seed 120 PhoBERT Golden Posts
    await postSnapshotModel.insertMany(goldenPosts);
  });

  // Helpers
  function getReturnedPostIds(res: { data: any[] }): string[] {
    return res.data.map((x) => x.item?.postId || x.id);
  }

  async function seedUserCandidateItems(
    userId: string,
    items: { postId: string; createdAt: Date }[],
  ) {
    const feedDocs = items.map((it) => ({
      userId,
      postId: it.postId,
      snapshotId: it.postId,
      refId: it.postId,
      eventType: FeedEventType.POST,
      createdAt: it.createdAt,
    }));
    await feedItemModel.insertMany(feedDocs);
  }

  async function seedUserCandidates(
    userId: string,
    postIds: string[],
    uniformTimestamp = true,
  ) {
    const now = Date.now();
    const items = postIds.map((postId, idx) => ({
      postId,
      createdAt: new Date(uniformTimestamp ? now : now - idx * 60000),
    }));
    await seedUserCandidateItems(userId, items);
  }

  // =========================================================================
  // SUITE R1: DYNAMIC ADAPTIVE SCORING DRIVEN BY EMA DISTRESS (4 TEST CASES)
  // =========================================================================
  describe("Suite R1: Dynamic Adaptive Scoring Driven by EMA Distress", () => {
    it("R1.1: Normal user state (Distress <= 0.3) prioritizes Recency over Emotional score", async () => {
      mockUserEmotionState = {
        riskScore: 0.1,
        recentNegativityScore: 0.1,
        negativeRatio7d: 0.1,
        emotionVolatility7d: 0.1,
        emotionMomentum: 0.0,
      };

      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      // Post A (brand new, joy 0.93) vs Post B (1 day old, joy 0.93)
      await seedUserCandidateItems("user-normal-r11", [
        { postId: "golden-joy-002", createdAt: new Date(oneDayAgo) },
        { postId: "golden-joy-001", createdAt: new Date(now) },
      ]);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-normal-r11",
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toHaveLength(2);
      expect(returnedIds[0]).toBe("golden-joy-001");
      expect(returnedIds[1]).toBe("golden-joy-002");
    });

    it("R1.2: Highly distressed user (Distress > 0.6) elevates Emotional Resonance over Recency", async () => {
      mockUserEmotionState = {
        riskScore: 0.85,
        recentNegativityScore: 0.8,
        negativeRatio7d: 0.75,
        emotionVolatility7d: 0.6,
        emotionMomentum: 0.3,
        userEmotionPreference: { sadness: 0.8, neutral: 0.2 },
      };

      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      // Post A: brand new viral post with low calming resonance (golden-joy-001)
      // Post B: 1-day old calming bridge post with high neutral score (golden-calm-001)
      await seedUserCandidateItems("user-distressed-r12", [
        { postId: "golden-joy-001", createdAt: new Date(now) },
        { postId: "golden-calm-001", createdAt: new Date(oneDayAgo) },
      ]);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-distressed-r12",
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toHaveLength(2);
      expect(returnedIds[0]).toBe("golden-calm-001");
      expect(returnedIds[1]).toBe("golden-joy-001");
    });

    it("R1.3: Stressed user (Distress = 0.7) suppresses Social Affinity of negative close connection posts in favor of calming casual connection content", async () => {
      mockUserEmotionState = {
        riskScore: 0.7,
        recentNegativityScore: 0.7,
        negativeRatio7d: 0.65,
        emotionVolatility7d: 0.5,
        emotionMomentum: 0.2,
        userEmotionPreference: { sadness: 0.7, neutral: 0.3 },
      };

      const userId = "user-stressed-r13";
      for (let i = 0; i < 5; i++) {
        await affinityService.updateAffinity({
          userId,
          category: "anger",
          authorId: "author-rage-1",
          type: InteractionType.REACT,
        });
      }

      const now = Date.now();
      await seedUserCandidateItems(userId, [
        { postId: "golden-rage-002", createdAt: new Date(now) },
        { postId: "golden-calm-001", createdAt: new Date(now) },
      ]);

      const res = await personalFeedController.getUserFeeds({
        userId,
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      // Social affinity weight is reduced during stress to prevent emotional contagion
      expect(returnedIds[0]).toBe("golden-calm-001");
    });

    it("R1.4: Normal user state (Distress = 0.2) maximizes Social Affinity weight for close connections", async () => {
      mockUserEmotionState = {
        riskScore: 0.15,
        recentNegativityScore: 0.15,
        negativeRatio7d: 0.1,
        emotionVolatility7d: 0.1,
        emotionMomentum: 0.0,
      };

      const userId = "user-normal-r14";
      for (let i = 0; i < 8; i++) {
        await affinityService.updateAffinity({
          userId,
          category: "joy",
          authorId: "author-joy-1",
          type: InteractionType.REACT,
        });
      }

      const now = Date.now();
      await seedUserCandidateItems(userId, [
        { postId: "golden-joy-002", createdAt: new Date(now) },
        { postId: "golden-joy-001", createdAt: new Date(now) },
      ]);

      const res = await personalFeedController.getUserFeeds({
        userId,
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      // Close friend's post is prioritized due to strong Social Affinity weight in normal mental state
      expect(returnedIds[0]).toBe("golden-joy-001");
    });
  });

  // =========================================================================
  // SUITE R2: ISO-PRINCIPLE MOOD TRANSITION & ANTI-TOXIC POSITIVITY (4 TEST CASES)
  // =========================================================================
  describe("Suite R2: Iso-Principle Mood Transition & Anti-Toxic Positivity", () => {
    it("R2.1: Sad distressed user strictly ranks Calming Bridge > Empathetic Sadness > Toxic Positivity Joy", async () => {
      mockUserEmotionState = {
        riskScore: 0.85,
        recentNegativityScore: 0.85,
        negativeRatio7d: 0.8,
        emotionVolatility7d: 0.6,
        emotionMomentum: 0.2,
        userEmotionPreference: { sadness: 0.85, neutral: 0.1, joy: 0.05 },
      };

      const testPostIds = [
        "golden-joy-001",
        "golden-sad-001",
        "golden-calm-001",
      ];
      await seedUserCandidates("user-sad-iso", testPostIds);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-sad-iso",
        query: { limit: 3 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toHaveLength(3);
      // Strict 3-stage Iso-principle order:
      // 1. Calming Bridge (golden-calm-001)
      // 2. Empathetic Sadness (golden-sad-001)
      // 3. Joy penalized for Toxic Positivity (golden-joy-001)
      expect(returnedIds[0]).toBe("golden-calm-001");
      expect(returnedIds[1]).toBe("golden-sad-001");
      expect(returnedIds[2]).toBe("golden-joy-001");
    });

    it("R2.2: High-anger user (Distress = 0.75) suppresses Provocative Debate in favor of Calming Content", async () => {
      mockUserEmotionState = {
        riskScore: 0.75,
        recentNegativityScore: 0.75,
        negativeRatio7d: 0.7,
        emotionVolatility7d: 0.6,
        emotionMomentum: 0.3,
        userEmotionPreference: { anger: 0.85, neutral: 0.15 },
      };

      await seedUserCandidates("user-anger-iso", [
        "golden-rage-002",
        "golden-calm-001",
      ]);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-anger-iso",
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds[0]).toBe("golden-calm-001");
    });

    it("R2.3: User with positive recovery momentum (M > 0) elevates Gentle Uplift content", async () => {
      mockUserEmotionState = {
        riskScore: 0.2,
        recentNegativityScore: 0.2,
        negativeRatio7d: 0.2,
        emotionVolatility7d: 0.2,
        emotionMomentum: 0.3,
        userEmotionPreference: { joy: 0.6, neutral: 0.3, sadness: 0.1 },
      };

      const testPostIds = ["golden-calm-001", "golden-joy-001"];
      await seedUserCandidates("user-recovering-iso", testPostIds);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-recovering-iso",
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds[0]).toBe("golden-joy-001");
    });

    it("R2.4: Fear/anxious user (Distress = 0.7) suppresses sensational fear posts in favor of calming content", async () => {
      mockUserEmotionState = {
        riskScore: 0.7,
        recentNegativityScore: 0.7,
        negativeRatio7d: 0.65,
        emotionVolatility7d: 0.55,
        emotionMomentum: 0.25,
        userEmotionPreference: { fear: 0.8, neutral: 0.2 },
      };

      await seedUserCandidates("user-fear-iso", [
        "golden-fear-001",
        "golden-calm-001",
      ]);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-fear-iso",
        query: { limit: 2 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds[0]).toBe("golden-calm-001");
    });
  });

  // =========================================================================
  // SUITE R3: ANTI-ECHO-CHAMBER & DOOMSCROLLING SUPPRESSION (3 TEST CASES)
  // =========================================================================
  describe("Suite R3: Anti-Echo-Chamber & Doomscrolling Suppression", () => {
    it("R3.1: Consecutive sadness candidates trigger Echo-Chamber Penalty and interleave calming content", async () => {
      mockUserEmotionState = {
        riskScore: 0.6,
        recentNegativityScore: 0.65,
        negativeRatio7d: 0.6,
        emotionVolatility7d: 0.4,
        emotionMomentum: 0.1,
        userEmotionPreference: { sadness: 0.8, neutral: 0.2 },
      };

      const postIds = [
        "golden-sad-001",
        "golden-sad-002",
        "golden-sad-003",
        "golden-sad-004",
        "golden-sad-005",
        "golden-sad-006",
        "golden-calm-001",
        "golden-calm-002",
      ];
      await seedUserCandidates("user-echo-r31", postIds);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-echo-r31",
        query: { limit: 5 },
      });

      const returnedIds = getReturnedPostIds(res);
      const calmIndex = returnedIds.findIndex((id) => id.includes("calm"));
      expect(calmIndex).toBeLessThan(3);
    });

    it("R3.2: Multi-page deep scrolling ensures diverse distribution (Ambient Interleaving)", async () => {
      mockUserEmotionState = {
        riskScore: 0.5,
        recentNegativityScore: 0.5,
        negativeRatio7d: 0.5,
        emotionVolatility7d: 0.3,
        emotionMomentum: 0.0,
      };

      const candidateIds = goldenPosts.slice(0, 30).map((p: any) => p.postId);
      await seedUserCandidates("user-scroll-diversity", candidateIds);

      const p1 = await personalFeedController.getUserFeeds({
        userId: "user-scroll-diversity",
        query: { limit: 10 },
      });
      const p2 = await personalFeedController.getUserFeeds({
        userId: "user-scroll-diversity",
        query: { limit: 10, cursor: p1.nextCursor! },
      });
      const p3 = await personalFeedController.getUserFeeds({
        userId: "user-scroll-diversity",
        query: { limit: 10, cursor: p2.nextCursor! },
      });

      const fullFeedIds = [
        ...getReturnedPostIds(p1),
        ...getReturnedPostIds(p2),
        ...getReturnedPostIds(p3),
      ];

      expect(fullFeedIds.length).toBeGreaterThanOrEqual(20);
      let consecutiveNegative = 0;
      let maxConsecutive = 0;
      for (const id of fullFeedIds) {
        if (id.includes("sad") || id.includes("rage") || id.includes("fear")) {
          consecutiveNegative++;
          maxConsecutive = Math.max(maxConsecutive, consecutiveNegative);
        } else {
          consecutiveNegative = 0;
        }
      }
      expect(maxConsecutive).toBeLessThan(4);
    });

    it("R3.3: Emotion filter (mainEmotion = sadness) safely retrieves safe sadness while excluding high-risk", async () => {
      const postIds = [
        "golden-sad-001",
        "golden-sad-002",
        "golden-toxic-high-001",
        "golden-joy-001",
      ];
      await seedUserCandidates("user-filter-sad", postIds);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-filter-sad",
        query: { limit: 10, mainEmotion: Emotion.SADNESS },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toContain("golden-sad-001");
      expect(returnedIds).not.toContain("golden-joy-001");
      expect(returnedIds).not.toContain("golden-toxic-high-001");
    });
  });

  // =========================================================================
  // SUITE R4: DUAL-TIER ETHICAL SAFETY GUARDRAILS (5 TEST CASES)
  // =========================================================================
  describe("Suite R4: Dual-Tier Ethical Safety Guardrails", () => {
    it("R4.1: Tier 1 Hard Drop: Post with mentalHealthRiskLevel === 'HIGH' is 100% excluded for normal user", async () => {
      mockUserEmotionState = { riskScore: 0.1, recentNegativityScore: 0.1 };

      const postIds = [
        "golden-calm-001",
        "golden-toxic-high-001",
        "golden-joy-001",
      ];
      await seedUserCandidates("user-guard-normal", postIds);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-guard-normal",
        query: { limit: 10 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).not.toContain("golden-toxic-high-001");
      expect(returnedIds).toContain("golden-calm-001");
    });

    it("R4.2: Tier 1 Hard Drop: Post with mentalHealthRiskLevel === 'HIGH' is 100% excluded for distressed user", async () => {
      mockUserEmotionState = { riskScore: 0.85, recentNegativityScore: 0.85 };

      const postIds = [
        "golden-calm-002",
        "golden-toxic-high-002",
        "golden-sad-001",
      ];
      await seedUserCandidates("user-guard-distressed", postIds);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-guard-distressed",
        query: { limit: 10 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).not.toContain("golden-toxic-high-002");
    });

    it("R4.3: Tier 2 Contextual Drop: hasWarning post appears for normal user with warning flag", async () => {
      mockUserEmotionState = {
        riskScore: 0.1,
        recentNegativityScore: 0.1,
        negativeRatio7d: 0.1,
        emotionVolatility7d: 0.1,
        emotionMomentum: 0.0,
      };

      const postIds = ["golden-warn-001", "golden-joy-001"];
      await seedUserCandidates("user-warn-normal", postIds);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-warn-normal",
        query: { limit: 5 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toContain("golden-warn-001");
      const postInDb = await postSnapshotModel.findOne({
        postId: "golden-warn-001",
      });
      expect(postInDb?.hasWarning).toBe(true);
    });

    it("R4.4: Tier 2 Contextual Drop: hasWarning post is suppressed/dropped when user is in distress (> 0.6)", async () => {
      mockUserEmotionState = {
        riskScore: 0.8,
        recentNegativityScore: 0.75,
        negativeRatio7d: 0.7,
        emotionVolatility7d: 0.6,
        emotionMomentum: 0.3,
      };

      const postIds = ["golden-calm-001", "golden-warn-005"];
      await seedUserCandidates("user-warn-distressed", postIds);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-warn-distressed",
        query: { limit: 5 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).not.toContain("golden-warn-005");
      expect(returnedIds).toContain("golden-calm-001");
    });

    it("R4.5: Tier 2 Contextual Drop: Sarcasm / conflict post is suppressed when user is in distress (> 0.6)", async () => {
      mockUserEmotionState = {
        riskScore: 0.8,
        recentNegativityScore: 0.8,
        negativeRatio7d: 0.7,
        emotionVolatility7d: 0.6,
        emotionMomentum: 0.2,
      };

      const postIds = ["golden-calm-001", "golden-rage-001"];
      await seedUserCandidates("user-conflict-distressed", postIds);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-conflict-distressed",
        query: { limit: 5 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).not.toContain("golden-rage-001");
      expect(returnedIds).toContain("golden-calm-001");
    });

    it("R4.6: Emotional Crisis with ALLOW_WITH_SUPPORT: Visible to healthy friend to offer support, but suppressed for distressed friend", async () => {
      // 1. Seed an emotional crisis post that needs support
      const crisisPostId = "crisis-support-post-01";
      await postSnapshotModel.create({
        postId: crisisPostId,
        snapshotId: crisisPostId,
        refId: crisisPostId,
        userId: "author-friend-in-need",
        content:
          "Mình đang cảm thấy kiệt sức và bế tắc, cần một ai đó lắng nghe...",
        audience: Audience.PUBLIC,
        moderationAction: ModerationAction.ALLOW_WITH_SUPPORT,
        needsMentalSupport: true,
        hasWarning: false,
        postCreatedAt: new Date(),
        mediaPreviews: [],
        emotionFeature: {
          primaryEmotion: "sadness",
          confidence: 0.9,
          mentalHealthRiskLevel: "mild",
        },
      });

      // 2. Healthy friend (distress = 0.1) looks at personal feed
      mockUserEmotionState = { riskScore: 0.1, recentNegativityScore: 0.1 };
      await seedUserCandidates("user-healthy-friend", [
        crisisPostId,
        "golden-calm-001",
      ]);

      const healthyRes = await personalFeedController.getUserFeeds({
        userId: "user-healthy-friend",
        query: { limit: 5 },
      });
      const healthyReturnedIds = getReturnedPostIds(healthyRes);
      expect(healthyReturnedIds).toContain(crisisPostId); // Visible so friend can help!

      // 3. Severely distressed friend (distress = 0.8) looks at personal feed
      mockUserEmotionState = {
        riskScore: 0.85,
        recentNegativityScore: 0.85,
        negativeRatio7d: 0.8,
        emotionVolatility7d: 0.7,
        emotionMomentum: 0.2,
      };
      await seedUserCandidates("user-distressed-friend", [
        crisisPostId,
        "golden-calm-001",
      ]);

      const distressedRes = await personalFeedController.getUserFeeds({
        userId: "user-distressed-friend",
        query: { limit: 5 },
      });
      const distressedReturnedIds = getReturnedPostIds(distressedRes);
      expect(distressedReturnedIds).not.toContain(crisisPostId); // Suppressed to avoid contagion!
      expect(distressedReturnedIds).toContain("golden-calm-001");
    });
  });

  // =========================================================================
  // SUITE R6: SESSION SNAPSHOT RESILIENCE & MULTI-PAGE CURSOR NAVIGATION (3 TEST CASES)
  // =========================================================================
  describe("Suite R6: Personal Feed Session Snapshot Resilience & Multi-Page Cursor Navigation", () => {
    it("R6.1: Multi-page navigation across 30 candidate posts guarantees 100% Zero Duplicates", async () => {
      const candidateIds = goldenPosts.slice(0, 30).map((p: any) => p.postId);
      await seedUserCandidates("user-paging-test", candidateIds);

      const p1 = await personalFeedController.getUserFeeds({
        userId: "user-paging-test",
        query: { limit: 10 },
      });
      expect(p1.data).toHaveLength(10);
      expect(p1.hasNextPage).toBe(true);

      const p2 = await personalFeedController.getUserFeeds({
        userId: "user-paging-test",
        query: { limit: 10, cursor: p1.nextCursor! },
      });
      expect(p2.data).toHaveLength(10);
      expect(p2.hasNextPage).toBe(true);

      const p3 = await personalFeedController.getUserFeeds({
        userId: "user-paging-test",
        query: { limit: 10, cursor: p2.nextCursor! },
      });
      expect(p3.data.length).toBeGreaterThan(0);

      const allIds = [
        ...p1.data.map((x) => x.id),
        ...p2.data.map((x) => x.id),
        ...p3.data.map((x) => x.id),
      ];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });

    it("R6.2: Orphan feed items (deleted post from Mongo) are filtered out cleanly without breaking feed response", async () => {
      const now = Date.now();
      await feedItemModel.create({
        userId: "user-orphan-test",
        postId: "post-does-not-exist-anywhere",
        snapshotId: "post-does-not-exist-anywhere",
        refId: "post-does-not-exist-anywhere",
        eventType: FeedEventType.POST,
        createdAt: new Date(now),
      });
      await feedItemModel.create({
        userId: "user-orphan-test",
        postId: "golden-calm-001",
        snapshotId: "golden-calm-001",
        refId: "golden-calm-001",
        eventType: FeedEventType.POST,
        createdAt: new Date(now - 1000),
      });

      const res = await personalFeedController.getUserFeeds({
        userId: "user-orphan-test",
        query: { limit: 10 },
      });

      const returnedIds = getReturnedPostIds(res);
      expect(returnedIds).toHaveLength(1);
      expect(returnedIds[0]).toBe("golden-calm-001");
    });

    it("R6.3: Expired session cursor gracefully triggers fallback session creation without error", async () => {
      const candidateIds = goldenPosts.slice(0, 15).map((p: any) => p.postId);
      await seedUserCandidates("user-fallback-test", candidateIds);

      const p1 = await personalFeedController.getUserFeeds({
        userId: "user-fallback-test",
        query: { limit: 5 },
      });
      expect(p1.nextCursor).toBeDefined();

      const keys = await redisClient.keys("feed:session:user-fallback-test:*");
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }

      const p2 = await personalFeedController.getUserFeeds({
        userId: "user-fallback-test",
        query: { limit: 5, cursor: p1.nextCursor! },
      });

      expect(p2).toBeDefined();
      expect(p2.data.length).toBeGreaterThan(0);
      expect(p2.data[0].id).toBeDefined();
    });
  });

  // =========================================================================
  // SUITE R7: AMBIENT SAFE SPACE INTERVENTION INTERLEAVING (SPRINT 3)
  // =========================================================================
  describe("Suite R7: Ambient Safe Space Intervention Interleaving", () => {
    it("R7.1: Distressed user (Distress > 0.5) receives Safe Space Card interleaved at slot 5 on Page 1", async () => {
      mockUserEmotionState = {
        riskScore: 0.85,
        recentNegativityScore: 0.8,
        negativeRatio7d: 0.75,
        emotionVolatility7d: 0.5,
        emotionMomentum: 0.3,
        userEmotionPreference: { sadness: 0.7, fear: 0.2, neutral: 0.1 },
      };

      const candidateIds = goldenPosts.slice(0, 15).map((p: any) => p.postId);
      await seedUserCandidates("user-distressed-safespace", candidateIds);

      // Query Page 1
      const res = await personalFeedController.getUserFeeds({
        userId: "user-distressed-safespace",
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

      // 3. Redis Cooldown TTL key is set
      const cooldownKey =
        "feed:intervention:cooldown:user-distressed-safespace";
      const ttl = await redisClient.ttl(cooldownKey);
      expect(ttl).toBeGreaterThan(0);
    });

    it("R7.2: Redis Cooldown prevents spamming Safe Space Card on repeated requests within 12h", async () => {
      mockUserEmotionState = {
        riskScore: 0.85,
        recentNegativityScore: 0.8,
        negativeRatio7d: 0.75,
        emotionVolatility7d: 0.5,
        emotionMomentum: 0.3,
        userEmotionPreference: { sadness: 0.7, fear: 0.2, neutral: 0.1 },
      };

      const candidateIds = goldenPosts.slice(0, 15).map((p: any) => p.postId);
      await seedUserCandidates("user-distressed-cooldown", candidateIds);

      // Actively set the 12h cooldown key in Redis
      const cooldownKey = "feed:intervention:cooldown:user-distressed-cooldown";
      await redisClient.set(cooldownKey, "1", "EX", 43200);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-distressed-cooldown",
        query: { limit: 10 },
      });

      // Returns exactly 10 posts, no intervention card
      expect(res.data).toHaveLength(10);
      const hasIntervention = res.data.some(
        (item) => item.type === FeedEventType.INTERVENTION,
      );
      expect(hasIntervention).toBe(false);
    });

    it("R7.3: Safe Space Card is strictly excluded from subsequent pages (Page 2, 3...)", async () => {
      // Clear cooldown to test page 2 isolation independently
      await redisClient.del("feed:intervention:cooldown:user-distressed-page2");

      mockUserEmotionState = {
        riskScore: 0.85,
        recentNegativityScore: 0.8,
        negativeRatio7d: 0.75,
        emotionVolatility7d: 0.5,
        emotionMomentum: 0.3,
      };

      const candidateIds = goldenPosts.slice(0, 20).map((p: any) => p.postId);
      await seedUserCandidates("user-distressed-page2", candidateIds);

      // Page 1
      const p1 = await personalFeedController.getUserFeeds({
        userId: "user-distressed-page2",
        query: { limit: 5 },
      });
      expect(p1.nextCursor).toBeDefined();

      // Page 2
      const p2 = await personalFeedController.getUserFeeds({
        userId: "user-distressed-page2",
        query: { limit: 5, cursor: p1.nextCursor! },
      });

      expect(p2.data.length).toBeGreaterThan(0);
      const hasInterventionOnP2 = p2.data.some(
        (item) => item.type === FeedEventType.INTERVENTION,
      );
      expect(hasInterventionOnP2).toBe(false);
    });

    it("R7.4: Emotionally stable user (Distress <= 0.5) does not receive Safe Space Card", async () => {
      mockUserEmotionState = {
        riskScore: 0.1,
        recentNegativityScore: 0.15,
        negativeRatio7d: 0.1,
        emotionVolatility7d: 0.1,
        emotionMomentum: -0.1,
        userEmotionPreference: { joy: 0.8, neutral: 0.2 },
      };

      const candidateIds = goldenPosts.slice(0, 10).map((p: any) => p.postId);
      await seedUserCandidates("user-stable-healthy", candidateIds);

      const res = await personalFeedController.getUserFeeds({
        userId: "user-stable-healthy",
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
