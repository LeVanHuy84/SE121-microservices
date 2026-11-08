import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { ReactionService } from "./reaction.service";
import { Reaction } from "src/entities/reaction.entity";
import { StatsBufferService } from "../stats/stats.buffer.service";
import { RecentActivityBufferService } from "../event/recent-activity.buffer.service";
import { UserClientService } from "../client/user-client.service";
import { EventTopic, ReactDTO, ReactionType, TargetType } from "@repo/dtos";
import { OutboxEvent } from "src/entities/outbox.entity";

describe("ReactionService (Suite 4: TC-POST-05 Thả cảm xúc trên bài viết)", () => {
  let service: ReactionService;
  let mockReactionRepo: any;
  let mockDataSource: any;
  let mockStatBuffer: any;
  let mockRecentActivityBuffer: any;
  let mockUserClient: any;
  let mockManager: any;
  let mockTxRepo: any;
  let savedOutboxEvents: OutboxEvent[] = [];

  beforeEach(async () => {
    savedOutboxEvents = [];

    mockTxRepo = {
      findOne: jest.fn(),
      create: jest.fn((vals) => ({ ...vals })),
      save: jest.fn(async (e) => ({ id: "reaction-1", ...e })),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
    };

    mockManager = {
      getRepository: jest.fn().mockReturnValue(mockTxRepo),
      create: jest.fn((entityClass, vals) => ({ ...vals })),
      findOne: jest.fn().mockResolvedValue({
        id: "post-100",
        userId: "post-author-1",
      }),
      save: jest.fn(async (e) => {
        if (e.topic) {
          savedOutboxEvents.push(e);
        }
        return e;
      }),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
    };

    mockDataSource = {
      transaction: jest.fn(async (cb) => cb(mockManager)),
    };

    mockReactionRepo = {
      createQueryBuilder: jest.fn(),
    };

    mockStatBuffer = {
      record: jest.fn(),
      updateMultipleStats: jest.fn().mockResolvedValue(undefined),
    };

    mockRecentActivityBuffer = {
      addRecentActivity: jest.fn().mockResolvedValue(undefined),
    };

    mockUserClient = {
      getTargetAuthor: jest.fn().mockResolvedValue("author-user-1"),
      getUserInfo: jest.fn().mockResolvedValue({
        id: "reactor-user-1",
        firstName: "Reactor",
        lastName: "User",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReactionService,
        {
          provide: getRepositoryToken(Reaction),
          useValue: mockReactionRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: StatsBufferService,
          useValue: mockStatBuffer,
        },
        {
          provide: RecentActivityBufferService,
          useValue: mockRecentActivityBuffer,
        },
        {
          provide: UserClientService,
          useValue: mockUserClient,
        },
      ],
    }).compile();

    service = module.get<ReactionService>(ReactionService);
  });

  // ============================================================
  // TC-POST-05: Thả cảm xúc (Reaction) trên bài viết
  // ============================================================
  it("TC-POST-05a: should create reaction, emit INTERACTION outbox event, and push to stats buffer", async () => {
    const userId = "reactor-user-1";
    const dto: ReactDTO = {
      targetId: "post-100",
      targetType: TargetType.POST,
      reactionType: ReactionType.LIKE,
    };

    mockTxRepo.findOne.mockResolvedValueOnce(null); // No existing reaction

    const result = await service.react(userId, dto);

    expect(result).toBe(true);
    expect(mockDataSource.transaction).toHaveBeenCalled();
    expect(mockTxRepo.save).toHaveBeenCalled();

    // Verify INTERACTION outbox event created
    const interactionEvent = savedOutboxEvents.find(
      (e) => e.topic === EventTopic.INTERACTION,
    );
    expect(interactionEvent).toBeDefined();

    // Verify stats buffer updated for post
    expect(mockStatBuffer.updateMultipleStats).toHaveBeenCalledWith(
      TargetType.POST,
      "post-100",
      expect.arrayContaining([
        expect.objectContaining({ delta: 1, subType: "LIKE" }),
      ]),
    );
  });

  it("TC-POST-05b: should switch reaction when user changes reaction type", async () => {
    const userId = "reactor-user-1";
    const dto: ReactDTO = {
      targetId: "post-100",
      targetType: TargetType.POST,
      reactionType: ReactionType.LOVE,
    };

    // User previously reacted with LIKE
    mockTxRepo.findOne.mockResolvedValueOnce({
      id: "reaction-1",
      userId,
      targetId: "post-100",
      targetType: TargetType.POST,
      reactionType: ReactionType.LIKE,
    });

    const result = await service.react(userId, dto);

    expect(result).toBe(true);
    // Verify buffer recorded both -1 for LIKE and +1 for LOVE
    expect(mockStatBuffer.updateMultipleStats).toHaveBeenCalledWith(
      TargetType.POST,
      "post-100",
      expect.arrayContaining([
        expect.objectContaining({ delta: -1 }),
        expect.objectContaining({ delta: 1 }),
      ]),
    );
  });
});
