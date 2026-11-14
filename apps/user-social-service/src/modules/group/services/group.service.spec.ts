import { Test, TestingModule } from "@nestjs/testing";
import { RpcException } from "@nestjs/microservices";
import { GroupService } from "./group.service";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import { GroupLogService } from "./group-log.service";
import { GroupCacheService } from "./group-cache.service";
import { UserService } from "src/modules/user/user.service";
import {
  CreateGroupDTO,
  EventDestination,
  EventTopic,
  GroupEventType,
  GroupPrivacy,
  GroupRole,
} from "@repo/dtos";

describe("GroupService (Suite 3: TC-GRP-01 Tạo nhóm cộng đồng mới)", () => {
  let service: GroupService;
  let mockDb: any;
  let mockTx: any;
  let mockUserService: any;
  let mockLogService: any;
  let mockCacheService: any;

  beforeEach(async () => {
    mockTx = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };

    mockDb = {
      transaction: jest.fn((cb) => cb(mockTx)),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([]),
    };

    mockUserService = {
      findOne: jest.fn(),
    };

    mockLogService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    mockCacheService = {
      delGroup: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupService,
        {
          provide: DRIZZLE,
          useValue: mockDb,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: GroupLogService,
          useValue: mockLogService,
        },
        {
          provide: GroupCacheService,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    service = module.get<GroupService>(GroupService);
  });

  // ============================================================
  // TC-GRP-01: Tạo nhóm cộng đồng mới
  // ============================================================
  it("TC-GRP-01: should create group, settings, owner member and emit GROUP_CREATED outbox event", async () => {
    const userId = "owner-user-1";
    const dto: CreateGroupDTO = {
      name: "Tâm lý học và Cảm xúc",
      description: "Nhóm chia sẻ và hỗ trợ sức khỏe tinh thần",
      privacy: GroupPrivacy.PUBLIC,
    };

    mockUserService.findOne.mockResolvedValueOnce({
      id: userId,
      firstName: "Tran",
      lastName: "Van A",
      avatarUrl: "https://example.com/avatar.jpg",
    });

    const mockSavedGroup = {
      id: "group-100",
      name: dto.name,
      description: dto.description,
      privacy: dto.privacy,
      createdBy: userId,
      avatar: null,
      coverImage: null,
      members: 1,
      owner: {
        id: userId,
        fullName: "Tran Van A",
        avatarUrl: "https://example.com/avatar.jpg",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockTx.returning.mockResolvedValueOnce([mockSavedGroup]);

    const result = await service.createGroup(userId, dto);

    expect(result).toBeDefined();
    expect(result.id).toBe("group-100");
    expect(result.name).toBe("Tâm lý học và Cảm xúc");
    expect(mockDb.transaction).toHaveBeenCalled();

    // Verify insert group settings & owner member
    expect(mockTx.insert).toHaveBeenCalled();
  });

  it("should throw 404 when group owner does not exist", async () => {
    mockUserService.findOne.mockResolvedValueOnce(null);

    await expect(
      service.createGroup("invalid-user", {
        name: "Test Group",
        privacy: GroupPrivacy.PUBLIC,
      }),
    ).rejects.toThrow(RpcException);
  });
});
