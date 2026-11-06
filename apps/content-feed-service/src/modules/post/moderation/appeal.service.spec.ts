import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { RpcException } from "@nestjs/microservices";
import { ModerationAppealService } from "./appeal.service";
import { ModerationService } from "./moderation.service";
import { LogService } from "./log.service";
import { ContentModeration } from "src/entities/content-moderation.entity";
import { ModerationAppeal } from "src/entities/moderation-appeal.entity";
import { Post } from "src/entities/post.entity";
import { Comment } from "src/entities/comment.entity";
import { Share } from "src/entities/share.entity";
import { AppealStatus, CreateAppealRequestDTO } from "@repo/dtos";

describe("ModerationAppealService (Suite 7: TC-AI-04 Kháng nghị kiểm duyệt)", () => {
  let service: ModerationAppealService;
  let mockContentModerationRepo: any;
  let mockModerationAppealRepo: any;
  let mockModerationService: any;
  let mockPostRepo: any;
  let mockCommentRepo: any;
  let mockShareRepo: any;
  let mockLogService: any;

  beforeEach(async () => {
    mockContentModerationRepo = {
      findOne: jest.fn(),
    };

    mockModerationAppealRepo = {
      findOne: jest.fn(),
      create: jest.fn((vals) => ({
        ...vals,
        id: "appeal-101",
        status: AppealStatus.PENDING,
      })),
      save: jest.fn(async (a) => a),
    };

    mockModerationService = {
      applyFinalDecision: jest.fn().mockResolvedValue(true),
    };

    mockPostRepo = {
      findOne: jest.fn(),
    };

    mockCommentRepo = {
      findOne: jest.fn(),
    };

    mockShareRepo = {
      findOne: jest.fn(),
    };

    mockLogService = {
      createAuditLog: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationAppealService,
        {
          provide: getRepositoryToken(ContentModeration),
          useValue: mockContentModerationRepo,
        },
        {
          provide: getRepositoryToken(ModerationAppeal),
          useValue: mockModerationAppealRepo,
        },
        {
          provide: ModerationService,
          useValue: mockModerationService,
        },
        {
          provide: getRepositoryToken(Post),
          useValue: mockPostRepo,
        },
        {
          provide: getRepositoryToken(Comment),
          useValue: mockCommentRepo,
        },
        {
          provide: getRepositoryToken(Share),
          useValue: mockShareRepo,
        },
        {
          provide: LogService,
          useValue: mockLogService,
        },
      ],
    }).compile();

    service = module.get<ModerationAppealService>(ModerationAppealService);
  });

  // ============================================================
  // TC-AI-04: Kháng nghị kiểm duyệt bài viết (ModerationAppeal)
  // ============================================================
  it("TC-AI-04: should create PENDING moderation appeal when user submits valid request", async () => {
    const userId = "author-alice";
    const moderationId = "mod-rec-1";
    const dto: CreateAppealRequestDTO = {
      moderationId,
      reason:
        "This was a supportive message quoting a clinical psychology paper, not hate speech.",
    };

    mockContentModerationRepo.findOne.mockResolvedValueOnce({
      id: moderationId,
      userId,
      targetId: "post-1",
    });

    mockModerationAppealRepo.findOne.mockResolvedValueOnce(null); // No existing pending appeal

    const result = await service.createAppeal(userId, dto);

    expect(result).toBeDefined();
    expect(result.moderationId).toBe(moderationId);
    expect(result.status).toBe(AppealStatus.PENDING);
    expect(mockModerationAppealRepo.save).toHaveBeenCalled();
  });

  it("should reject appeal if moderation record does not belong to the user", async () => {
    mockContentModerationRepo.findOne.mockResolvedValueOnce({
      id: "mod-rec-1",
      userId: "other-user",
    });

    await expect(
      service.createAppeal("intruder-user", {
        moderationId: "mod-rec-1",
        reason: "Let me appeal this",
      }),
    ).rejects.toThrow(RpcException);
  });

  it("should reject appeal if an appeal is already pending for this record", async () => {
    mockContentModerationRepo.findOne.mockResolvedValueOnce({
      id: "mod-rec-1",
      userId: "author-alice",
    });

    mockModerationAppealRepo.findOne.mockResolvedValueOnce({
      id: "appeal-prev",
      status: AppealStatus.PENDING,
    });

    await expect(
      service.createAppeal("author-alice", {
        moderationId: "mod-rec-1",
        reason: "Duplicate appeal",
      }),
    ).rejects.toThrow(RpcException);
  });
});
