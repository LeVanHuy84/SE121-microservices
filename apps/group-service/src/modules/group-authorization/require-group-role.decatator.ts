// src/common/decorators/require-group-role.decorator.ts
import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { GroupRole } from '@repo/dtos';
import { GroupRoleGuard } from 'src/modules/group-authorization/group-role.guard';

export const RequireGroupRole = (role: GroupRole) =>
  applyDecorators(SetMetadata('group_role', role), UseGuards(GroupRoleGuard));
