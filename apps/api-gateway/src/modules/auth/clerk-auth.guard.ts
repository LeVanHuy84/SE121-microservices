// src/auth/clerk-auth.guard.ts

import { type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { IS_PUBLIC_KEY } from "src/common/decorators/public.decorator";

@Injectable()
export class ClerkAuthGuard extends AuthGuard("clerk") {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (process.env.ENABLE_LOAD_TEST_MODE === "true") {
      const req = context.switchToHttp().getRequest();
      const authHeader = req.headers?.authorization;
      const mockUserId =
        req.headers?.["x-mock-user-id"] ||
        (typeof authHeader === "string" &&
        authHeader.startsWith("Bearer mock_user_")
          ? authHeader.replace("Bearer ", "").trim()
          : null);

      if (mockUserId) {
        req.user = {
          userId: mockUserId,
          role: "user",
        };
        return true;
      }
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}
