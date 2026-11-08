import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { ConsumerService } from "./consumer.service";
import { Post } from "src/entities/post.entity";
import { Comment } from "src/entities/comment.entity";
import { ContentModeration } from "src/entities/content-moderation.entity";
import { OutboxEvent } from "src/entities/outbox.entity";
import {
  AnalysisResultEventPayload,
  Emotion,
  EventTopic,
  ModerationAction,
  ModerationLabel,
  PostEventType,
  TargetType,
} from "@repo/dtos";

describe("ConsumerService (Suite 7: TC-AI-01 -> TC-AI-03 Kết quả phân tích AI & Kiểm duyệt)", () => {
  let service: ConsumerService;
  let mockPostRepo: any;
  let mockCommentRepo: any;
  let mockDataSource: any;
  let mockManager: any;
  let savedOutboxEvents: OutboxEvent[] = [];

  beforeEach(async () => {
    savedOutboxEvents = [];

    mockManager = {
      findOne: jest.fn(),
      create: jest.fn((entityClass, vals) => ({ ...vals })),
      save: jest.fn(async (entity) => {
        if (entity.topic) {
          savedOutboxEvents.push(entity);
        }
        return entity;
      }),
      getRepository: jest.fn((entity) => {
        if (entity === Post) return mockPostRepo;
        if (entity === Comment) return mockCommentRepo;
        return mockPostRepo;
      }),
    };

    mockPostRepo = {
      findOneBy: jest.fn(),
      save: jest.fn(async (p) => p),
    };

    mockCommentRepo = {
      findOneBy: jest.fn(),
      save: jest.fn(async (c) => c),
    };

    mockDataSource = {
      manager: mockManager,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsumerService,
        {
          provide: getRepositoryToken(Post),
          useValue: mockPostRepo,
        },
        {
          provide: getRepositoryToken(Comment),
          useValue: mockCommentRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<ConsumerService>(ConsumerService);
  });

  // ============================================================
  // TC-AI-01: Tiếp nhận kết quả phân tích cảm xúc hợp lệ
  // ============================================================
  it("TC-AI-01: should update primary and secondary emotion on post entity", async () => {
    const existingPost: any = {
      id: "post-100",
      userId: "user-1",
      content: "Feeling so grateful and peaceful today!",
      isDeleted: false,
    };

    mockPostRepo.findOneBy.mockResolvedValueOnce(existingPost);

    const payload: AnalysisResultEventPayload = {
      targetId: "post-100",
      targetType: TargetType.POST,
      primaryEmotion: Emotion.JOY,
      secondaryEmotions: [Emotion.OPTIMISM],
    };

    await service.handleEmotionResult(payload, mockManager);

    expect(mockPostRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "post-100",
        mainEmotion: Emotion.JOY,
        secondaryEmotions: [Emotion.OPTIMISM],
      }),
    );
  });

  // ============================================================
  // TC-AI-02: Kiểm duyệt: Bài viết vi phạm mức độ nghiêm trọng (HARD_BLOCK)
  // ============================================================
  it("TC-AI-02: should mark post isDeleted=true, save ContentModeration, and emit POST REMOVED outbox event", async () => {
    const existingPost = new Post();
    existingPost.id = "post-toxic-1";
    existingPost.userId = "bad-actor";
    existingPost.content = "Violent hate speech content";
    existingPost.isDeleted = false;

    mockManager.findOne
      // 1. txManager.findOne(Post)
      .mockResolvedValueOnce(existingPost)
      // 2. txManager.findOne(ContentModeration) -> none
      .mockResolvedValueOnce(null);

    const payload: AnalysisResultEventPayload = {
      targetId: "post-toxic-1",
      targetType: TargetType.POST,
      primaryEmotion: Emotion.ANGER,
      moderation: {
        targetId: "post-toxic-1",
        targetType: TargetType.POST,
        action: ModerationAction.HARD_BLOCK,
        label: ModerationLabel.HATE_SPEECH,
        displayMessage: "Content blocked due to hate speech violation",
      },
    };

    await service.handleEmotionResult(payload, mockManager);

    // Verify post marked as deleted and hard blocked
    expect(mockManager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "post-toxic-1",
        isDeleted: true,
        moderationAction: ModerationAction.HARD_BLOCK,
      }),
    );

    // Verify ContentModeration record saved
    expect(mockManager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "post-toxic-1",
        action: ModerationAction.HARD_BLOCK,
        label: ModerationLabel.HATE_SPEECH,
      }),
    );

    // Verify outbox event POST REMOVED generated for fan-out rollback
    const removeEvent = savedOutboxEvents.find(
      (e) =>
        e.topic === EventTopic.POST &&
        (e as any).eventType === PostEventType.REMOVED,
    );
    expect(removeEvent).toBeDefined();
    expect((removeEvent as any).payload.postId).toBe("post-toxic-1");
  });

  // ============================================================
  // TC-AI-03: Kiểm duyệt: Bài viết cảnh báo (ALLOW_WITH_WARNING)
  // ============================================================
  it("TC-AI-03: should set hasWarning=true on post and save ContentModeration record without hard blocking", async () => {
    const existingPost = new Post();
    existingPost.id = "post-warning-1";
    existingPost.userId = "user-alice";
    existingPost.content = "Discussing difficult emotional experiences";
    existingPost.isDeleted = false;

    mockManager.findOne
      .mockResolvedValueOnce(existingPost)
      .mockResolvedValueOnce(null);

    mockPostRepo.findOneBy.mockResolvedValueOnce(existingPost);

    const payload: AnalysisResultEventPayload = {
      targetId: "post-warning-1",
      targetType: TargetType.POST,
      primaryEmotion: Emotion.SADNESS,
      moderation: {
        targetId: "post-warning-1",
        targetType: TargetType.POST,
        action: ModerationAction.ALLOW_WITH_WARNING,
        label: ModerationLabel.SENSITIVE,
        displayMessage: "May contain sensitive emotional topics",
      },
    };

    await service.handleEmotionResult(payload, mockManager);

    // Post remains NOT deleted, but flagged with warning
    expect(mockManager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "post-warning-1",
        isDeleted: false,
        hasWarning: true,
        warningReason: "May contain sensitive emotional topics",
      }),
    );

    // No POST REMOVED event emitted
    const removeEvent = savedOutboxEvents.find(
      (e) =>
        e.topic === EventTopic.POST &&
        (e as any).eventType === PostEventType.REMOVED,
    );
    expect(removeEvent).toBeUndefined();
  });
});
