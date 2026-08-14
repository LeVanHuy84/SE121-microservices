import { Controller } from "@nestjs/common";
import { LogService } from "./log.service";
import { MessagePattern } from "@nestjs/microservices";
import { AuditLogQuery, GetUserActivityLogQuery } from "@repo/dtos";

@Controller("log")
export class LogController {
  constructor(private readonly logService: LogService) {}

  @MessagePattern("get_audit_log")
  async getAuditLog(query: AuditLogQuery) {
    return this.logService.getAuditLog(query);
  }

  @MessagePattern("get_user_activity_log")
  async getUserActivityLog(
    query: GetUserActivityLogQuery & { actorId: string },
  ) {
    const { actorId, ...rest } = query as any;
    return this.logService.getUserActivityLog(
      actorId,
      rest as GetUserActivityLogQuery,
    );
  }
}
