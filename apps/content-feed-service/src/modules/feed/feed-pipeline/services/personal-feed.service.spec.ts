import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { getRedisToken } from "@nestjs-modules/ioredis";
import { PersonalFeedService } from "./personal-feed.service";
import { FeedItem } from "../../mongo/schema/feed-item.schema";
import { SnapshotRepository } from "../../mongo/repository/snapshot.repository";
import { AffinityService } from "../../affinity/affinity.service";
import { EmotionFeatureService } from "src/modules/ranking/services/emotion-feature.service";
import { FeedInterleaverService } from "./feed-interleaver.service";
import { FeedHydrationService } from "./feed-hydration.service";
import { PersonalFeedHelper } from "../helpers/personal-feed.helper";

describe("PersonalFeedService (Suite 6: TC-RNK-04 & TC-RNK-05 Xếp hạng bảng tin & Session Cursor)", () => {
  let service: PersonalFeedService;
  let mockFeedItemModel: any;
  let mockSnapshotRepo: any;
  let mockAffinityService: any;
  let mockEmotionService: any;
  let mockInterleaverService: any;
  let mockHydrationService: any;
  let mockRedis: any;

  beforeEach(async () => {
    mockFeedItemModel = {
      find: jest.fn(() => ({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      })),
    };

    mockSnapshotRepo = {
      findPostSnapshotsByIds: jest.fn().mockResolvedValue([]),
    };

    mockAffinityService = {
      getAffinities: jest.fn().mockResolvedValue(new Map()),
    };

    mockEmotionService = {
      getEmotionFeatures: jest.fn().mockResolvedValue({
        userEmotionPreference: {},
        last24hEmotionDistribution: {},
        negativeRatio7d: 0,
        emotionVolatility7d: 0,
        riskScore: 0,
        recentNegativityScore: 0,
        emotionMomentum: 0,
      }),
      calculateDistressScore: jest.fn().mockReturnValue(0),
      rankPostEmotionScore: jest.fn().mockReturnValue(0.5),
    };

    mockInterleaverService = {
      maybeInterleaveSafeSpaceCard: jest.fn((dtos) => Promise.resolve(dtos)),
    };

    mockHydrationService = {
      hydrateFeedItemPage: jest.fn((userId, ids) =>
        Promise.resolve(
          ids.map((id: string) => ({
            id,
            postId: id,
            type: "POST",
            actorId: "actor-1",
            createdAt: new Date(),
          })),
        ),
      ),
    };

    mockRedis = {
      llen: jest.fn().mockResolvedValue(0),
      lrange: jest.fn().mockResolvedValue([]),
      rpush: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue(null),
      hset: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalFeedService,
        {
          provide: getModelToken(FeedItem.name),
          useValue: mockFeedItemModel,
        },
        {
          provide: SnapshotRepository,
          useValue: mockSnapshotRepo,
        },
        {
          provide: AffinityService,
          useValue: mockAffinityService,
        },
        {
          provide: EmotionFeatureService,
          useValue: mockEmotionService,
        },
        {
          provide: FeedInterleaverService,
          useValue: mockInterleaverService,
        },
        {
          provide: FeedHydrationService,
          useValue: mockHydrationService,
        },
        {
          provide: "default_IORedisModuleConnectionToken",
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<PersonalFeedService>(PersonalFeedService);
  });

  // ============================================================
  // TC-RNK-04: Trải nghiệm phân trang qua Redis Session Cursor
  // ============================================================
  it("TC-RNK-04: should read subsequent page from Redis session list without re-ranking pool", async () => {
    const userId = "user-alice";
    const sessionId = "session-uuid-123";
    const cursor = PersonalFeedHelper.encodeSessionCursor(sessionId, 10);

    // Mock Redis session has 30 ranked items
    mockRedis.llen.mockResolvedValueOnce(30);
    // Page 2: items from index 10 to 19
    const cachedPageIds = Array.from(
      { length: 10 },
      (_, i) => `post-id-${i + 10}`,
    );
    mockRedis.lrange.mockResolvedValueOnce(cachedPageIds);

    const result = await service.getUserFeed(userId, { cursor, limit: 10 });

    expect(result).toBeDefined();
    expect(result.data).toHaveLength(10);
    expect(result.data[0].id).toBe("post-id-10");
    // Verify it read directly from Redis session
    expect(mockRedis.lrange).toHaveBeenCalledWith(
      expect.stringContaining(sessionId),
      10,
      19,
    );
    // Notice: feedItemModel.find was NOT called because session hit avoided candidate re-query
    expect(mockFeedItemModel.find).not.toHaveBeenCalled();
    expect(result.hasNextPage).toBe(true);
  });

  // ============================================================
  // TC-RNK-05: Khởi tạo phiên mới & Hết hạn phân trang sau 20 phút (1200s TTL)
  // ============================================================
  it("TC-RNK-05: should create new session with 1200s TTL when cursor is absent or session is expired", async () => {
    const userId = "user-alice";

    // Mock MongoDB returns candidate items
    const candidates = Array.from({ length: 15 }, (_, i) => ({
      _id: `feed-item-${i}`,
      itemId: `post-${i}`,
      postId: `post-${i}`,
      actorId: `author-${i}`,
      createdAt: new Date(),
    }));

    mockFeedItemModel.find.mockReturnValueOnce({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValueOnce(candidates),
    });

    jest.spyOn(service as any, "rankItems").mockResolvedValueOnce({
      ranked: candidates.map((c) => ({
        itemId: c.postId,
        finalScore: 0.8,
        distress: 0,
      })),
      distress: 0,
    });

    const result = await service.getUserFeed(userId, { limit: 10 });

    expect(result).toBeDefined();
    expect(result.data).toHaveLength(10);

    // Verify Redis cached the session and set 1200s TTL
    expect(mockRedis.rpush).toHaveBeenCalled();
    expect(mockRedis.expire).toHaveBeenCalledWith(
      expect.stringContaining("feed:session:"),
      1200,
    );
  });
});
