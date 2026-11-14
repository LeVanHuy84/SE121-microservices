import { Test, TestingModule } from "@nestjs/testing";
import { RpcException } from "@nestjs/microservices";
import { GroupJoinRequestService } from "./group-request.service";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import { GroupLogService } from "./group-log.service";
import { GroupBufferService } from "./group-buffer.service";
import { UserService } from "src/modules/user/user.service";
import {
  GroupMemberStatus,
  GroupPermission,
  GroupPrivacy,
  GroupRole,
  JoinRequestStatus,
} from "@repo/dtos";

describe("GroupJoinRequestService (Suite 3: TC-GRP-05 Yêu cầu tham gia nhóm)", () => {
  let service: GroupJoinRequestService;
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
      returning: jest.fn(),
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
      buffer: jest.fn().mockResolvedValue(undefined),
    };

    mockUserService = {
      findOne: jest.fn().mockResolvedValue({
        id: "user-request-1",
        firstName: "Nguyen",
        lastName: "Van B",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupJoinRequestService,
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

    service = module.get<GroupJoinRequestService>(GroupJoinRequestService);
  });

  // ============================================================
  // TC-GRP-05: Xử lý yêu cầu tham gia nhóm (JoinRequest)
  // ============================================================
  it("TC-GRP-05a: should create PENDING join request for private group", async () => {
    const groupId = "group-private-1";
    const userId = "user-requester-1";

    // 1. validateGroup -> returns private group
    mockTx.limit
      .mockResolvedValueOnce([
        { id: groupId, privacy: GroupPrivacy.PRIVATE, members: 5 },
      ]) // validateGroup: groups
      .mockResolvedValueOnce([{ maxMembers: 100 }]) // validateGroup: groupSettings
      .mockResolvedValueOnce([]) // validateMemberStatus: groupMembers
      .mockResolvedValueOnce([]) // not invited: groupInvites
      .mockResolvedValueOnce([]); // createJoinRequest: no existing groupJoinRequests

    const mockCreatedRequest = {
      id: "req-101",
      groupId,
      userId,
      status: JoinRequestStatus.PENDING,
      createdAt: new Date(),
    };
    mockTx.returning.mockResolvedValueOnce([mockCreatedRequest]);

    const result = await service.requestToJoin(groupId, userId);

    expect(result.success).toBe(true);
    expect(mockTx.insert).toHaveBeenCalled();
  });

  it("TC-GRP-05b: should approve join request and add user as MEMBER", async () => {
    const requestId = "req-101";
    const approverId = "admin-1";

    const joinRequest = {
      id: requestId,
      groupId: "group-1",
      userId: "user-applicant",
      status: JoinRequestStatus.PENDING,
    };

    // 1. fetch joinRequest
    mockTx.where
      .mockReturnValueOnce({
        limit: jest.fn().mockResolvedValueOnce([joinRequest]),
      })
      // approver permissions
      .mockReturnValueOnce({
        limit: jest.fn().mockResolvedValueOnce([
          {
            userId: approverId,
            role: GroupRole.ADMIN,
            customPermissions: [GroupPermission.APPROVE_MEMBERS],
          },
        ]),
      })
      // group & settings
      .mockReturnValueOnce({
        limit: jest
          .fn()
          .mockResolvedValueOnce([{ id: "group-1", members: 10 }]),
      })
      .mockReturnValueOnce({
        limit: jest
          .fn()
          .mockResolvedValueOnce([{ groupId: "group-1", maxMembers: 100 }]),
      });

    mockTx.returning.mockResolvedValueOnce([{ id: "member-new" }]);

    const approved = await service.approveRequest(requestId, approverId);

    expect(approved).toBe(true);
    expect(mockTx.update).toHaveBeenCalled();
  });
});
