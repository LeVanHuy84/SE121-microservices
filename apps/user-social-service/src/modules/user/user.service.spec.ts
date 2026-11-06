import { Test, TestingModule } from "@nestjs/testing";
import { UserService } from "./user.service";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import { OutboxService } from "../event/outbox.service";
import { CreateUserDTO, UpdateUserDTO, UserEventType } from "@repo/dtos";
import { USER_STATUS } from "src/constants";

describe("UserService (Suite 1: Quản lý Người dùng và Đồng bộ Hồ sơ)", () => {
  let service: UserService;
  let mockDb: any;
  let mockRedis: any;
  let mockOutboxService: any;
  let mockTx: any;

  beforeEach(async () => {
    mockTx = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      onConflictDoNothing: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([
        {
          id: "user-123",
          email: "test@example.com",
          status: USER_STATUS.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockImplementation(() =>
        Promise.resolve([
          {
            id: "user-update-1",
            email: "alice@example.com",
            userId: "user-update-1",
            status: USER_STATUS.ACTIVE,
            firstName: "Alice",
            lastName: "Smith",
            bio: "Old bio",
            privacySettings: {
              allowProactiveIntervention: false,
              profileVisibility: "PUBLIC",
            },
          },
        ]),
      ),
      limit: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };

    mockDb = {
      transaction: jest.fn((cb) => cb(mockTx)),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockImplementation(() => Promise.resolve([])),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      query: {
        users: {
          findMany: jest.fn(),
          findFirst: jest.fn(),
        },
      },
    };

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue("OK"),
      del: jest.fn().mockResolvedValue(1),
    };

    mockOutboxService = {
      createUserOutboxEvent: jest.fn().mockResolvedValue([]),
      createRecommendationProfileEmbeddingRequestedEvent: jest
        .fn()
        .mockResolvedValue([]),
      createOutboxEventWithTransaction: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: DRIZZLE,
          useValue: mockDb,
        },
        {
          provide: "default_IORedisModuleConnectionToken",
          useValue: mockRedis,
        },
        {
          provide: OutboxService,
          useValue: mockOutboxService,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // TC-US-01: Tạo tài khoản người dùng mới từ Clerk Webhook
  // ============================================================
  it("TC-US-01: should create new user and profile in transaction, emit outbox events and invalidate cache", async () => {
    const dto: CreateUserDTO = {
      id: "clerk_user_1",
      email: "alice@example.com",
      firstName: "Alice",
      lastName: "Smith",
      role: "user" as any,
      bio: "Software Engineer",
      location: "San Francisco",
      company: "Tech Corp",
      jobTitle: "Senior Developer",
      school: "MIT",
      interests: ["coding", "ai", "music"],
    };

    mockTx.returning.mockResolvedValueOnce([
      {
        id: "clerk_user_1",
        email: "alice@example.com",
        status: USER_STATUS.ACTIVE,
      },
    ]);
    mockTx.where.mockImplementationOnce(() =>
      Promise.resolve([{ id: "role-1", name: "user" }]),
    );

    const result = await service.create(dto);

    expect(result).toBeDefined();
    expect(result.id).toBe("clerk_user_1");
    expect(result.email).toBe("alice@example.com");
    expect(mockDb.transaction).toHaveBeenCalled();
    expect(mockRedis.del).toHaveBeenCalledWith("users:all");
    expect(mockOutboxService.createUserOutboxEvent).toHaveBeenCalledWith(
      mockDb,
      UserEventType.CREATED,
      expect.objectContaining({
        userId: "clerk_user_1",
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Smith",
      }),
    );
    expect(
      mockOutboxService.createRecommendationProfileEmbeddingRequestedEvent,
    ).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        userId: "clerk_user_1",
        triggeredBy: "user.created",
      }),
    );
  });

  // ============================================================
  // TC-US-02: Xử lý tạo tài khoản trùng lặp userId (Idempotent Webhook)
  // ============================================================
  it("TC-US-02: should handle duplicate userId gracefully and return existing user", async () => {
    const dto: CreateUserDTO = {
      id: "clerk_duplicate_1",
      email: "duplicate@example.com",
      firstName: "Existing",
      lastName: "User",
      role: "user" as any,
    };

    // onConflictDoNothing returns empty array
    mockTx.returning.mockResolvedValueOnce([]);
    // Select existing user
    mockTx.where.mockImplementationOnce(() =>
      Promise.resolve([
        {
          id: "clerk_duplicate_1",
          email: "duplicate@example.com",
          status: USER_STATUS.ACTIVE,
        },
      ]),
    );

    const result = await service.create(dto);

    expect(result).toBeDefined();
    expect(result.id).toBe("clerk_duplicate_1");
    expect(mockRedis.del).toHaveBeenCalledWith("users:all");
  });

  // ============================================================
  // TC-US-03: Cập nhật hồ sơ cá nhân và cài đặt riêng tư (allowProactiveIntervention)
  // ============================================================
  it("TC-US-03: should update profile and privacySettings including allowProactiveIntervention", async () => {
    const userId = "user-update-1";
    const dto: UpdateUserDTO = {
      bio: "Updated bio for mental health awareness",
      privacySettings: {
        allowProactiveIntervention: true,
        profileVisibility: "FRIENDS_ONLY",
      } as any,
    };

    const existingUser = {
      id: userId,
      email: "alice@example.com",
      profile: {
        firstName: "Alice",
        lastName: "Smith",
        bio: "Old bio",
        privacySettings: {
          allowProactiveIntervention: false,
          profileVisibility: "PUBLIC",
        },
      },
    };

    mockDb.query.users.findFirst.mockResolvedValueOnce(existingUser);
    jest.spyOn(service, "findOne").mockResolvedValueOnce({
      id: userId,
      email: "alice@example.com",
      bio: "Updated bio for mental health awareness",
      privacySettings: {
        allowProactiveIntervention: true,
        profileVisibility: "FRIENDS_ONLY",
      },
    } as any);

    const result = await service.update(userId, dto);

    expect(result).toBeDefined();
    expect(result.id).toBe(userId);
    expect(mockDb.transaction).toHaveBeenCalled();
    expect(mockOutboxService.createUserOutboxEvent).toHaveBeenCalledWith(
      expect.anything(),
      UserEventType.UPDATED,
      expect.objectContaining({
        userId,
        bio: "Updated bio for mental health awareness",
        privacySettings: expect.objectContaining({
          allowProactiveIntervention: true,
          profileVisibility: "FRIENDS_ONLY",
        }),
      }),
    );
  });

  // ============================================================
  // TC-US-04: Tự động sinh semanticProfileText cho tìm kiếm ngữ nghĩa
  // ============================================================
  it("TC-US-04: should generate formatted semanticProfileText from user profile fields", () => {
    const profile = {
      firstName: "John",
      lastName: "Doe",
      bio: "Passionate about mental well-being and tech",
      location: "Hanoi, Vietnam",
      jobTitle: "Lead Architect",
      company: "MindCare Inc",
      school: "HUST",
      interests: ["psychology", "meditation", "running"],
    };

    const semanticText = (service as any).buildSemanticProfileText(profile);

    expect(semanticText).toContain("name: John Doe");
    expect(semanticText).toContain(
      "bio: Passionate about mental well-being and tech",
    );
    expect(semanticText).toContain("location: Hanoi, Vietnam");
    expect(semanticText).toContain("work: Lead Architect at MindCare Inc");
    expect(semanticText).toContain("school: HUST");
    expect(semanticText).toContain(
      "interests: psychology, meditation, running",
    );
  });

  // ============================================================
  // TC-US-05: Truy vấn hàng loạt người dùng (getUsersBatch)
  // ============================================================
  it("TC-US-05: should return list of active users matching given batch of IDs", async () => {
    const ids = ["user-1", "user-2"];
    const mockUsers = [
      {
        id: "user-1",
        email: "user1@example.com",
        status: USER_STATUS.ACTIVE,
        profile: {
          firstName: "User",
          lastName: "One",
          postCount: 5,
          friendCount: 12,
        },
      },
      {
        id: "user-2",
        email: "user2@example.com",
        status: USER_STATUS.ACTIVE,
        profile: {
          firstName: "User",
          lastName: "Two",
          postCount: 1,
          friendCount: 3,
        },
      },
    ];

    mockDb.query.users.findMany.mockResolvedValueOnce(mockUsers);

    const result = await service.getUsersBatch(ids);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("user-1");
    expect(result[0].firstName).toBe("User");
    expect(result[1].id).toBe("user-2");
    expect(result[1].lastName).toBe("Two");
  });

  // ============================================================
  // Post and Friend count increment / decrement
  // ============================================================
  it("should increment and decrement postCount and friendCount", async () => {
    mockDb.where.mockReturnValue({});

    await service.incrementPostCount("user-1");
    expect(mockDb.update).toHaveBeenCalled();

    await service.decrementPostCount("user-1");
    expect(mockDb.update).toHaveBeenCalled();

    await service.incrementFriendCount(["user-1", "user-2"]);
    expect(mockDb.update).toHaveBeenCalled();

    await service.decrementFriendCount(["user-1", "user-2"]);
    expect(mockDb.update).toHaveBeenCalled();
  });
});
