import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CreateSystemUserDTO,
  SystemRole,
  SystemUserQueryDTO,
} from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { RequireRole } from 'src/common/decorators/require-role.decorator';
@Controller('users/admin')
export class AdminUserController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.USER_SERVICE)
    private client: ClientProxy
  ) {}

  @Get('system-users')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  getSystemUsers(@Query() filter: SystemUserQueryDTO) {
    return this.client.send('get-system-users', filter);
  }

  @Post('system-users')
  @RequireRole(SystemRole.ADMIN)
  createSystemUser(
    @Body() dto: CreateSystemUserDTO,
    @CurrentUserId() actorId: string
  ) {
    return this.client.send('create-system-user', { dto, actorId });
  }

  @Patch('system-users/:userId/role')
  @RequireRole(SystemRole.ADMIN)
  updateSystemUserRole(
    @Param('userId') userId: string,
    @Body('role') role: SystemRole,
    @CurrentUserId() actorId: string
  ) {
    console.log('Updating system user role...', userId);
    return this.client.send('update-system-user-role', {
      userId,
      role,
      actorId,
    });
  }

  @Post(':userId/ban')
  @RequireRole(SystemRole.MODERATOR, SystemRole.ADMIN)
  banUser(@Param('userId') userId: string, @CurrentUserId() actorId: string) {
    return this.client.send('ban-user', { userId, actorId });
  }

  @Post(':userId/unban')
  @RequireRole(SystemRole.MODERATOR, SystemRole.ADMIN)
  unbanUser(@Param('userId') userId: string, @CurrentUserId() actorId: string) {
    return this.client.send('unban-user', { userId, actorId });
  }
}
