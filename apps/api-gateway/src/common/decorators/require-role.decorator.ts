import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { SystemRole } from '@repo/dtos';
import { RolesGuard } from 'src/modules/auth/roles.guard';

export const SYSTEM_ROLE_KEY = 'system_role';

export const RequireRole = (...roles: SystemRole[]) =>
  applyDecorators(SetMetadata(SYSTEM_ROLE_KEY, roles), UseGuards(RolesGuard));
