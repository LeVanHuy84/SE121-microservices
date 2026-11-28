import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { runReadinessChecks } from "@repo/common";
import { Public } from "src/common/decorators/public.decorator";

@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  @Get("health")
  getHealth() {
    return {
      status: "ok",
      service: "api-gateway",
      uptime: Math.floor(process.uptime()),
    };
  }

  @Get("ready")
  async getReadiness() {
    const result = await runReadinessChecks();
    if (!result.ready) {
      throw new ServiceUnavailableException({
        status: "not_ready",
        service: "api-gateway",
        checks: result.checks,
      });
    }
    return {
      status: "ready",
      service: "api-gateway",
      checks: result.checks,
    };
  }
}
