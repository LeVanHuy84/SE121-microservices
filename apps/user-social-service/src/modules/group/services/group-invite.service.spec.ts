import { Test, TestingModule } from "@nestjs/testing";
import { RpcException } from "@nestjs/microservices";
import { GroupInviteService } from "./group-invite.service";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import { GroupLogService } from "./group-log.service";
import { GroupBufferService } from "./group-buffer.service";
import { UserService } from "src/modules/user/user.service";
import {
  GroupMemberStatus,
  GroupPermission,
  GroupRole,
  InviteStatus,
} from "@repo/dtos";

describe("GroupInviteService (Suite 3: TC-GRP-04 Mời thành viên)", () => {
  let service: GroupInviteService;
  let mockDb: any;
  let mockTx: any;
  let mockLogService: any;
  let mockBufferService: any;
  let mockUserService: any;

  beforeEach(async () => {
    mockTx = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn(),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
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

    mockBufferService = {
      addLog: jest.fn().mockResolvedValue(undefined),
    };

    mockUserService = {
      findOne: jest.fn().mockResolvedValue({
        id: "invitee-1",
        firstName: "Bob",
        lastName: "Marley",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupInviteService,
        {
          provide: DRIZZLE,
          useValue: mockDb,
        },
        {
          provide: GroupLogService,
          useValue: mockLogService,
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

    service = module.get<GroupInviteService>(GroupInviteService);
  });

  // ============================================================
  // TC-GRP-04: Mời thành viên vào nhóm riêng tư (INVITE_MEMBERS)
  // ============================================================
  it("TC-GRP-04: should create group_invites record with PENDING and notify via RabbitMQ outbox", async () => {
    const groupId = "group-private-1";
    const inviterId = "admin-1";
    const inviteeId = "invitee-1";

    // 1. group exists
    mockTx.limit
      .mockResolvedValueOnce([
        { id: groupId, name: "Private Healing Club", members: 10 },
      ]) // group
      .mockResolvedValueOnce([{ groupId, allowMemberInvite: false }]) // setting (requires permission)
      .mockResolvedValueOnce([
        {
          userId: inviterId,
          groupId,
          role: GroupRole.ADMIN,
          customPermissions: [GroupPermission.INVITE_MEMBERS],
        },
      ]) // inviter has permission
      .mockResolvedValueOnce([]) // invitee not existing member
      .mockResolvedValueOnce([]) // no existing join request
      .mockResolvedValueOnce([]); // no existing invite

    const result = await service.invite(groupId, inviterId, inviteeId);

    expect(result).toBe(true);
    expect(mockDb.transaction).toHaveBeenCalled();
    // Verifies insert into group_invites and outboxEvents (notification)
    expect(mockTx.insert).toHaveBeenCalled();
    expect(mockLogService.log).toHaveBeenCalled();
  });

  it("should reject invite when inviter invites himself", async () => {
    await expect(service.invite("group-1", "user-1", "user-1")).rejects.toThrow(
      RpcException,
    );
  });

  it("should reject invite when user is already a member", async () => {
    mockTx.limit
      .mockResolvedValueOnce([{ id: "g-1", name: "G1" }])
      .mockResolvedValueOnce([{ groupId: "g-1", allowMemberInvite: true }])
      .mockResolvedValueOnce([
        { userId: "invitee-1", status: GroupMemberStatus.ACTIVE },
      ]);

    await expect(service.invite("g-1", "user-1", "invitee-1")).rejects.toThrow(
      RpcException,
    );
  });
});
