// src/common/decorators/require-group-permission.decorator.ts
import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { GroupPermission } from '@repo/dtos';
import { GroupPermissionGuard } from 'src/modules/group-authorization/group-permission.guard';

export const RequireGroupPermission = (action: GroupPermission) =>
  applyDecorators(
    SetMetadata('group_permission', action),
    UseGuards(GroupPermissionGuard),
  );
