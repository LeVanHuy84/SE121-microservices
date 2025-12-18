import { Controller } from '@nestjs/common';
import { LogService } from './log.service';
import { MessagePattern } from '@nestjs/microservices';
import { AuditLogQuery } from '@repo/dtos';

@Controller('log')
export class LogController {
  constructor(private readonly logService: LogService) {}

  @MessagePattern('get_audit_log')
  async getAuditLog(query: AuditLogQuery) {
    return this.logService.getAuditLog(query);
  }
}
