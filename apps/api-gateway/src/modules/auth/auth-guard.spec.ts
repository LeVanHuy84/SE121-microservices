import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ClerkAuthGuard } from "./clerk-auth.guard";
import { ClerkStrategy } from "./clerk.strategy";
import { RolesGuard } from "./roles.guard";
import { SystemRole } from "@repo/dtos";
import * as clerkBackend from "@clerk/backend";

jest.mock("@clerk/backend", () => ({
  verifyToken: jest.fn(),
}));

describe("Suite 1: Xác thực, Phân quyền & Bảo vệ Cổng (Auth & Roles Guard)", () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    jest.clearAllMocks();
    delete process.env.ENABLE_LOAD_TEST_MODE;
  });

  const createMockContext = (
    req: any = {},
    handler = () => {},
    targetClass = class {},
  ) =>
    ({
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
      getHandler: () => handler,
      getClass: () => targetClass,
    }) as unknown as ExecutionContext;

  describe("ClerkAuthGuard", () => {
    it("TC-GW-04: allows public endpoints annotated with @Public() without token", () => {
      const guard = new ClerkAuthGuard(reflector);
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);

      const context = createMockContext({ headers: {} });
      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it("TC-GW-05: bypasses authentication and assigns mock user in load test mode with x-mock-user-id", () => {
      process.env.ENABLE_LOAD_TEST_MODE = "true";
      const guard = new ClerkAuthGuard(reflector);

      const req: any = {
        headers: { "x-mock-user-id": "mock-test-user-123" },
      };
      const context = createMockContext(req);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(req.user).toEqual({
        userId: "mock-test-user-123",
        role: "user",
      });
    });

    it("TC-GW-05b: bypasses authentication in load test mode with Bearer mock_user_* header", () => {
      process.env.ENABLE_LOAD_TEST_MODE = "true";
      const guard = new ClerkAuthGuard(reflector);

      const req: any = {
        headers: { authorization: "Bearer mock_user_k6_999" },
      };
      const context = createMockContext(req);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(req.user).toEqual({
        userId: "mock_user_k6_999",
        role: "user",
      });
    });

    it("delegates to super.canActivate when endpoint is protected and not in load test mode", () => {
      const guard = new ClerkAuthGuard(reflector);
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(false);
      const superSpy = jest
        .spyOn(Object.getPrototypeOf(ClerkAuthGuard.prototype), "canActivate")
        .mockReturnValue(true as any);

      const context = createMockContext({ headers: {} });
      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(superSpy).toHaveBeenCalledWith(context);
    });
  });

  describe("ClerkStrategy", () => {
    const mockClerkClient: any = {};
    const mockConfigService: any = {
      get: jest.fn().mockReturnValue("test-clerk-secret-key"),
    };

    it("TC-GW-01: throws UnauthorizedException(401) when no authorization token is provided", async () => {
      const strategy = new ClerkStrategy(mockClerkClient, mockConfigService);
      const req: any = { headers: {} };

      await expect(strategy.validate(req)).rejects.toThrow(
        new UnauthorizedException("No token provided"),
      );
    });

    it("TC-GW-02: successfully validates valid JWT token and attaches user identity", async () => {
      const strategy = new ClerkStrategy(mockClerkClient, mockConfigService);
      const req: any = {
        headers: { authorization: "Bearer valid-clerk-jwt-token" },
      };

      (clerkBackend.verifyToken as jest.Mock).mockResolvedValue({
        sub: "user_clerk_12345",
        role: "admin",
      });

      const user = await strategy.validate(req);

      expect(user).toEqual({
        userId: "user_clerk_12345",
        role: "admin",
        raw: {
          sub: "user_clerk_12345",
          role: "admin",
        },
      });
      expect(clerkBackend.verifyToken).toHaveBeenCalledWith(
        "valid-clerk-jwt-token",
        expect.objectContaining({
          secretKey: "test-clerk-secret-key",
          clockSkewInMs: 60000,
        }),
      );
    });

    it("TC-GW-03: throws UnauthorizedException(401) when token verification fails or is expired", async () => {
      const strategy = new ClerkStrategy(mockClerkClient, mockConfigService);
      const req: any = {
        headers: { authorization: "Bearer expired-token" },
      };

      (clerkBackend.verifyToken as jest.Mock).mockRejectedValue(
        new Error("Token expired"),
      );
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await expect(strategy.validate(req)).rejects.toThrow(
        new UnauthorizedException("Invalid token"),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("RolesGuard", () => {
    it("TC-GW-06: blocks non-admin users from accessing @RequireRole('admin') routes", () => {
      const guard = new RolesGuard(reflector);
      jest
        .spyOn(reflector, "getAllAndOverride")
        .mockReturnValue([SystemRole.ADMIN]);

      const req: any = {
        user: { userId: "user-normal", role: SystemRole.USER },
      };
      const context = createMockContext(req);

      const canActivate = guard.canActivate(context);

      expect(canActivate).toBe(false);
    });

    it("allows access when user possesses the required role", () => {
      const guard = new RolesGuard(reflector);
      jest
        .spyOn(reflector, "getAllAndOverride")
        .mockReturnValue([SystemRole.ADMIN]);

      const req: any = {
        user: { userId: "user-admin", role: SystemRole.ADMIN },
      };
      const context = createMockContext(req);

      const canActivate = guard.canActivate(context);

      expect(canActivate).toBe(true);
    });

    it("allows access when route requires no specific role", () => {
      const guard = new RolesGuard(reflector);
      jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);

      const req: any = {
        user: { userId: "user-1", role: SystemRole.USER },
      };
      const context = createMockContext(req);

      const canActivate = guard.canActivate(context);

      expect(canActivate).toBe(true);
    });
  });
});
