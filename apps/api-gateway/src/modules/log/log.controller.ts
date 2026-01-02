import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { AuditLogQuery, SystemRole } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { RequireRole } from 'src/common/decorators/require-role.decorator';

@Controller('logs')
export class LogController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.LOG_SERVICE)
    private client: ClientProxy
  ) {}

  @Get()
  @RequireRole(SystemRole.ADMIN)
  getAuditLog(@Query() query: AuditLogQuery) {
    return this.client.send('get_audit_log', query);
  }
}
