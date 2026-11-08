import { Test, TestingModule } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { RpcException } from "@nestjs/microservices";
import { GroupPermissionGuard } from "./group-permission.guard";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import { GroupPermission, GroupRole } from "@repo/dtos";

describe("GroupPermissionGuard (Suite 3: RBAC Phân quyền nhóm)", () => {
  let guard: GroupPermissionGuard;
  let reflector: Reflector;
  let mockDb: any;
  let mockContext: any;

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupPermissionGuard,
        Reflector,
        {
          provide: DRIZZLE,
          useValue: mockDb,
        },
      ],
    }).compile();

    guard = module.get<GroupPermissionGuard>(GroupPermissionGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  const createMockContext = (data: any) => ({
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToRpc: () => ({
      getData: () => data,
    }),
  });

  // ============================================================
  // TC-GRP-02: Phân quyền: Thành viên thường (MEMBER) thực hiện duyệt bài
  // ============================================================
  it("TC-GRP-02: should block MEMBER without APPROVE_POST permission and throw RpcException(403)", async () => {
    jest.spyOn(reflector, "get").mockReturnValue(GroupPermission.APPROVE_POST);

    mockContext = createMockContext({
      userId: "user-member-1",
      groupId: "group-1",
    });

    // Mock member has role MEMBER and no custom permissions
    mockDb.limit.mockResolvedValue([
      {
        userId: "user-member-1",
        groupId: "group-1",
        role: GroupRole.MEMBER,
        customPermissions: [],
      },
    ]);

    await expect(guard.canActivate(mockContext)).rejects.toThrow(RpcException);
  });

  // ============================================================
  // TC-GRP-03: Phân quyền: Quản trị viên (ADMIN / OWNER) duyệt bài viết
  // ============================================================
  it("TC-GRP-03: should allow OWNER or ADMIN with APPROVE_POST permission", async () => {
    jest.spyOn(reflector, "get").mockReturnValue(GroupPermission.APPROVE_POST);

    // Test Case 3a: OWNER
    mockContext = createMockContext({
      userId: "user-owner-1",
      groupId: "group-1",
    });

    mockDb.limit.mockResolvedValueOnce([
      {
        userId: "user-owner-1",
        groupId: "group-1",
        role: GroupRole.OWNER,
      },
    ]);

    const ownerResult = await guard.canActivate(mockContext);
    expect(ownerResult).toBe(true);

    // Test Case 3b: ADMIN (has APPROVE_POST in ROLE_PERMISSIONS)
    mockDb.limit.mockResolvedValueOnce([
      {
        userId: "user-admin-1",
        groupId: "group-1",
        role: GroupRole.ADMIN,
      },
    ]);

    const adminResult = await guard.canActivate(mockContext);
    expect(adminResult).toBe(true);
  });

  it("should pass when no group permission is required on handler", async () => {
    jest.spyOn(reflector, "get").mockReturnValue(undefined);

    mockContext = createMockContext({
      userId: "user-1",
      groupId: "group-1",
    });

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
  });

  it("should throw 403 when user is not a member of the group", async () => {
    jest.spyOn(reflector, "get").mockReturnValue(GroupPermission.DELETE_POST);

    mockContext = createMockContext({
      userId: "outsider-1",
      groupId: "group-1",
    });

    mockDb.limit.mockResolvedValueOnce([]);

    await expect(guard.canActivate(mockContext)).rejects.toThrow(RpcException);
  });
});
