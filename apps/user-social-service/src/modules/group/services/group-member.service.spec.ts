import { Test, TestingModule } from "@nestjs/testing";
import { RpcException } from "@nestjs/microservices";
import { GroupMemberService } from "./group-member.service";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import { GroupLogService } from "./group-log.service";
import { GroupCacheService } from "./group-cache.service";
import { GroupBufferService } from "./group-buffer.service";
import { UserService } from "src/modules/user/user.service";
import { GroupMemberStatus, GroupRole } from "@repo/dtos";

describe("GroupMemberService (Suite 3: TC-GRP-06 Trục xuất và cấm thành viên)", () => {
  let service: GroupMemberService;
  let mockDb: any;
  let mockTx: any;
  let mockLogService: any;
  let mockCacheService: any;
  let mockBufferService: any;
  let mockUserService: any;

  beforeEach(async () => {
    mockTx = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };

    mockDb = {
      transaction: jest.fn((cb) => cb(mockTx)),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };

    mockLogService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    mockCacheService = {
      delGroup: jest.fn().mockResolvedValue(undefined),
    };

    mockBufferService = {
      addLog: jest.fn().mockResolvedValue(undefined),
    };

    mockUserService = {
      findOne: jest.fn().mockResolvedValue({
        id: "target-member-id",
        firstName: "Bad",
        lastName: "Actor",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupMemberService,
        {
          provide: DRIZZLE,
          useValue: mockDb,
        },
        {
          provide: GroupLogService,
          useValue: mockLogService,
        },
        {
          provide: GroupCacheService,
          useValue: mockCacheService,
        },
        {
          provide: GroupBufferService,
          useValue: mockBufferService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
      ],
    }).compile();

    service = module.get<GroupMemberService>(GroupMemberService);
  });

  // ============================================================
  // TC-GRP-06: Trục xuất và cấm thành viên (banMember)
  // ============================================================
  it("TC-GRP-06: should ban member, log event and decrement group member count", async () => {
    const adminUserId = "admin-1";
    const groupId = "group-1";
    const targetMemberRecordId = "member-row-10";
    const targetUserId = "user-violator";

    // 1. target member
    mockTx.limit
      .mockResolvedValueOnce([
        {
          id: targetMemberRecordId,
          userId: targetUserId,
          groupId,
          role: GroupRole.MEMBER,
          status: GroupMemberStatus.ACTIVE,
        },
      ])
      // 2. executor member check
      .mockResolvedValueOnce([
        {
          userId: adminUserId,
          groupId,
          role: GroupRole.ADMIN,
        },
      ])
      // 3. updateMemberCount: select group
      .mockResolvedValueOnce([
        {
          id: groupId,
          members: 10,
        },
      ]);

    const result = await service.banMember(
      adminUserId,
      groupId,
      targetMemberRecordId,
    );

    expect(result).toBe(true);
    expect(mockDb.transaction).toHaveBeenCalled();
    // Verify member status updated to BANNED
    expect(mockTx.update).toHaveBeenCalled();
    // Verify member banned log written
    expect(mockLogService.log).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        groupId,
        userId: adminUserId,
        eventType: "MEMBER_BANNED",
      }),
    );
  });

  it("should prevent banning the group OWNER", async () => {
    mockTx.limit.mockResolvedValueOnce([
      {
        id: "owner-row",
        userId: "owner-user",
        groupId: "g-1",
        role: GroupRole.OWNER,
        status: GroupMemberStatus.ACTIVE,
      },
    ]);

    await expect(
      service.banMember("admin-1", "g-1", "owner-row"),
    ).rejects.toThrow(RpcException);
  });

  it("should prevent a user from banning himself", async () => {
    mockTx.limit
      .mockResolvedValueOnce([
        {
          id: "self-row",
          userId: "same-user",
          groupId: "g-1",
          role: GroupRole.MEMBER,
          status: GroupMemberStatus.ACTIVE,
        },
      ])
      .mockResolvedValueOnce([
        {
          userId: "same-user",
          groupId: "g-1",
          role: GroupRole.MEMBER,
        },
      ]);

    await expect(
      service.banMember("same-user", "g-1", "self-row"),
    ).rejects.toThrow(RpcException);
  });
});
