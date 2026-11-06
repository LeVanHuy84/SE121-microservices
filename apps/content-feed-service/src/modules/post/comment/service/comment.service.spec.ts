import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { CommentService } from "./comment.service";
import { CommentCacheService } from "./comment-cache.service";
import { StatsBufferService } from "src/modules/stats/stats.buffer.service";
import { RecentActivityBufferService } from "src/modules/event/recent-activity.buffer.service";
import { UserClientService } from "../../client/user-client.service";
import { OutboxService } from "src/modules/event/outbox.service";
import {
  CreateCommentDTO,
  EventDestination,
  EventTopic,
  RootType,
  TargetType,
} from "@repo/dtos";
import { OutboxEvent } from "src/entities/outbox.entity";

describe("CommentService (Suite 4: TC-POST-06 Bình luận lồng nhau)", () => {
  let service: CommentService;
  let mockDataSource: any;
  let mockCommentCache: any;
  let mockStatsBuffer: any;
  let mockRecentActivityBuffer: any;
  let mockUserClient: any;
  let mockOutboxService: any;
  let mockManager: any;
  let savedOutboxEvents: OutboxEvent[] = [];

  beforeEach(async () => {
    savedOutboxEvents = [];

    mockManager = {
      create: jest.fn((entityClass, vals) => ({ ...vals })),
      save: jest.fn(async (e) => {
        if (e.topic) {
          savedOutboxEvents.push(e);
        }
        return {
          id: e.id || "comment-uuid-1",
          createdAt: new Date(),
          ...e,
        };
      }),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => ({
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({ affected: 1 }),
        })),
      })),
      findOne: jest.fn().mockResolvedValue({
        id: "parent-comment-1",
        userId: "parent-author-1",
        content: "Original parent comment",
      }),
    };

    mockDataSource = {
      transaction: jest.fn(async (cb) => cb(mockManager)),
    };

    mockCommentCache = {
      del: jest.fn().mockResolvedValue(true),
    };

    mockStatsBuffer = {
      record: jest.fn(),
      updateStat: jest.fn().mockResolvedValue(undefined),
    };

    mockRecentActivityBuffer = {
      addRecentActivity: jest.fn().mockResolvedValue(undefined),
    };

    mockUserClient = {
      getTargetAuthor: jest.fn().mockResolvedValue("post-author-1"),
      getUserInfo: jest.fn().mockResolvedValue({
        id: "reply-author-1",
        firstName: "Reply",
        lastName: "Author",
      }),
    };

    mockOutboxService = {
      createAnalysisEvent: jest
        .fn()
        .mockResolvedValue({ id: "outbox-analysis" }),
      createUserActivityEvent: jest
        .fn()
        .mockResolvedValue({ id: "outbox-activity" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: CommentCacheService,
          useValue: mockCommentCache,
        },
        {
          provide: StatsBufferService,
          useValue: mockStatsBuffer,
        },
        {
          provide: RecentActivityBufferService,
          useValue: mockRecentActivityBuffer,
        },
        {
          provide: UserClientService,
          useValue: mockUserClient,
        },
        {
          provide: OutboxService,
          useValue: mockOutboxService,
        },
      ],
    }).compile();

    service = module.get<CommentService>(CommentService);
  });

  // ============================================================
  // TC-POST-06: Bình luận lồng nhau (Nested Comment)
  // ============================================================
  it("TC-POST-06: should create nested reply comment, increment stats, and create reply notification outbox event", async () => {
    const userId = "reply-author-1";
    const dto: CreateCommentDTO = {
      content: "I completely relate to your healing journey! Thank you.",
      rootId: "post-100",
      rootType: RootType.POST,
      parentId: "parent-comment-1",
    };

    const result = await service.create(userId, dto);

    expect(result).toBeDefined();
    expect(result.content).toBe(dto.content);
    expect(mockDataSource.transaction).toHaveBeenCalled();

    // Verify stats updated (increment commentStat on parent and post)
    expect(mockManager.getRepository).toHaveBeenCalled();

    // Verify reply notification outbox event generated
    const notificationEvent = savedOutboxEvents.find(
      (e) => e.destination === EventDestination.RABBITMQ,
    );
    expect(notificationEvent).toBeDefined();

    // Verify analysis event generated for AI emotion tracking
    expect(mockOutboxService.createAnalysisEvent).toHaveBeenCalledWith(
      mockManager,
      TargetType.COMMENT,
      expect.anything(),
    );
  });
});
