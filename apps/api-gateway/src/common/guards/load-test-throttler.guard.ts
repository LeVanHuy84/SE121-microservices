import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

@Injectable()
export class LoadTestThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (process.env.ENABLE_LOAD_TEST_MODE === "true") {
      return true;
    }
    return super.shouldSkip(context);
  }
}
