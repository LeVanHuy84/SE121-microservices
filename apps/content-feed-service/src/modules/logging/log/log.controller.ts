import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { LogService } from "./log.service";

import { AuditLogQuery, GetUserActivityLogQuery } from "@repo/dtos";

@Controller("log")
export class LogController {
  constructor(private readonly logService: LogService) {}

  @TcpMessagePattern("get_audit_log")
  async getAuditLog(query: AuditLogQuery) {
    return this.logService.getAuditLog(query);
  }

  @TcpMessagePattern("get_user_activity_log")
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
