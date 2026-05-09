import {
  Controller,
  Get,
  Inject,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { AuditLogQuery, SystemRole, GetUserActivityLogQuery } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { RequireRole } from 'src/common/decorators/require-role.decorator';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('logs')
export class LogController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.LOG_SERVICE)
    private client: ClientProxy,
  ) {}

  @Get()
  @RequireRole(SystemRole.ADMIN)
  getAuditLog(@Query() query: AuditLogQuery) {
    return this.client.send('get_audit_log', query);
  }

  @Get('user-activities')
  getUserActivityLog(
    @CurrentUserId() userId: string,
    @Query() query: GetUserActivityLogQuery,
  ) {
    if (!userId) {
      throw new UnauthorizedException();
    }

    // Ensure actorId is the authenticated user
    const payload = { ...query, actorId: userId } as any;
    return this.client.send('get_user_activity_log', payload);
  }
}
