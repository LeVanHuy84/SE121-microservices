import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { RpcException } from "@nestjs/microservices";
import { PostCommandService } from "./post-command.service";
import { PostCacheService } from "./post-cache.service";
import { OutboxService } from "src/modules/event/outbox.service";
import { Post } from "src/entities/post.entity";
import { OutboxEvent } from "src/entities/outbox.entity";
import {
  Audience,
  CreatePostDTO,
  EventTopic,
  MediaType,
  PostEventType,
  TargetType,
  UpdatePostDTO,
} from "@repo/dtos";

describe("PostCommandService (Suite 4: TC-POST-01 -> TC-POST-04)", () => {
  let service: PostCommandService;
  let mockPostRepo: any;
  let mockDataSource: any;
  let mockPostCache: any;
  let mockOutboxService: any;
  let mockManager: any;
  let savedOutboxEvents: OutboxEvent[] = [];

  beforeEach(async () => {
    savedOutboxEvents = [];

    mockManager = {
      create: jest.fn((entityClass, values) => ({
        ...values,
      })),
      save: jest.fn(async (entity) => {
        if (entity.topic) {
          savedOutboxEvents.push(entity);
        }
        return {
          id: entity.id || "post-uuid-1",
          createdAt: new Date(),
          ...entity,
        };
      }),
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
      remove: jest.fn().mockResolvedValue(true),
    };

    mockDataSource = {
      transaction: jest.fn(async (cb) => cb(mockManager)),
    };

    mockPostRepo = {
      findOneBy: jest.fn(),
    };

    mockPostCache = {
      del: jest.fn().mockResolvedValue(true),
      removeCache: jest.fn().mockResolvedValue(true),
    };

    mockOutboxService = {
      createAnalysisEvent: jest
        .fn()
        .mockResolvedValue({ id: "outbox-analysis" }),
      updatedAnalysisEvent: jest
        .fn()
        .mockResolvedValue({ id: "outbox-updated-analysis" }),
      createUserActivityEvent: jest
        .fn()
        .mockResolvedValue({ id: "outbox-activity" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostCommandService,
        {
          provide: getRepositoryToken(Post),
          useValue: mockPostRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: PostCacheService,
          useValue: mockPostCache,
        },
        {
          provide: OutboxService,
          useValue: mockOutboxService,
        },
      ],
    }).compile();

    service = module.get<PostCommandService>(PostCommandService);
  });

  // ============================================================
  // TC-POST-01: Tạo bài viết công khai kèm hình ảnh
  // ============================================================
  it("TC-POST-01: should create public post with media and emit MEDIA, POST and ANALYSIS outbox events", async () => {
    const userId = "user-alice";
    const dto: CreatePostDTO = {
      content: "Hello from mental health community! #mindfulness",
      audience: Audience.PUBLIC,
      media: [
        {
          publicId: "cloudinary_img_1",
          url: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
          type: MediaType.IMAGE,
        },
        {
          publicId: "cloudinary_img_2",
          url: "https://res.cloudinary.com/demo/image/upload/sample2.jpg",
          type: MediaType.IMAGE,
        },
      ],
    };

    const result = await service.create(userId, dto);

    expect(result).toBeDefined();
    expect(result.content).toBe(dto.content);
    expect(mockDataSource.transaction).toHaveBeenCalled();

    // Verify MEDIA outbox event
    const mediaEvent = savedOutboxEvents.find(
      (e) => e.topic === EventTopic.MEDIA,
    );
    expect(mediaEvent).toBeDefined();
    expect((mediaEvent as any).payload.items).toHaveLength(2);

    // Verify POST outbox event
    const postEvent = savedOutboxEvents.find(
      (e) => e.topic === EventTopic.POST,
    );
    expect(postEvent).toBeDefined();
    expect((postEvent as any).eventType).toBe(PostEventType.CREATED);

    // Verify ANALYSIS outbox event
    expect(mockOutboxService.createAnalysisEvent).toHaveBeenCalledWith(
      mockManager,
      TargetType.POST,
      expect.anything(),
    );
  });

  // ============================================================
  // TC-POST-02: Tạo bài viết chế độ riêng tư (ONLY_ME)
  // ============================================================
  it("TC-POST-02: should create private post without POST outbox event, but still emit ANALYSIS event", async () => {
    const userId = "user-alice";
    const dto: CreatePostDTO = {
      content: "Private healing diary - only for me",
      audience: Audience.ONLY_ME,
    };

    const result = await service.create(userId, dto);

    expect(result).toBeDefined();

    // Verify NO POST outbox event created for private posts (prevents fan-out)
    const postEvent = savedOutboxEvents.find(
      (e) => e.topic === EventTopic.POST,
    );
    expect(postEvent).toBeUndefined();

    // But ANALYSIS is still performed for mental health risk tracking
    expect(mockOutboxService.createAnalysisEvent).toHaveBeenCalledWith(
      mockManager,
      TargetType.POST,
      expect.anything(),
    );
  });

  // ============================================================
  // TC-POST-03: Chỉnh sửa nội dung bài viết (updatePost)
  // ============================================================
  it("TC-POST-03: should update post content, save EditHistory and clear Redis cache", async () => {
    const userId = "user-author-1";
    const postId = "post-100";
    const existingPost: any = {
      id: postId,
      userId,
      content: "Original text before editing",
      audience: Audience.PUBLIC,
      media: [],
      createdAt: new Date(),
    };

    mockPostRepo.findOneBy.mockResolvedValueOnce(existingPost);

    const dto: UpdatePostDTO = {
      content: "Updated content with deeper emotional reflection",
    };

    const result = await service.update(userId, postId, dto);

    expect(result).toBeDefined();
    expect(mockPostCache.removeCache).toHaveBeenCalledWith(postId);
    expect(mockManager.save).toHaveBeenCalled();
  });

  it("TC-POST-03b: should reject updating post if requester is not the author", async () => {
    mockPostRepo.findOneBy.mockResolvedValueOnce({
      id: "post-100",
      userId: "original-author",
    });

    await expect(
      service.update("intruder-user", "post-100", { content: "Hacked!" }),
    ).rejects.toThrow(RpcException);
  });

  // ============================================================
  // TC-POST-04: Xóa bài viết cá nhân
  // ============================================================
  it("TC-POST-04: should remove post, cascade delete reactions and comments, and emit POST REMOVED event", async () => {
    const userId = "user-author-1";
    const postId = "post-100";
    const existingPost: any = {
      id: postId,
      userId,
      content: "Post to be deleted",
      media: [],
    };

    mockPostRepo.findOneBy.mockResolvedValueOnce(existingPost);

    const removed = await service.remove(userId, postId);

    expect(removed).toBe(true);
    expect(mockManager.remove).toHaveBeenCalledWith(existingPost);

    // Verify POST REMOVED event emitted
    const removeEvent = savedOutboxEvents.find(
      (e) =>
        e.topic === EventTopic.POST &&
        (e as any).eventType === PostEventType.REMOVED,
    );
    expect(removeEvent).toBeDefined();
    expect((removeEvent as any).payload.postId).toBe(postId);
  });

  it("TC-POST-04b: should reject deleting non-existent post", async () => {
    mockPostRepo.findOneBy.mockResolvedValueOnce(null);

    await expect(service.remove("user-1", "non-existent")).rejects.toThrow(
      RpcException,
    );
  });
});
