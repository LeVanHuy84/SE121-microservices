import { Module } from '@nestjs/common';
import { GroupPermissionGuard } from './group-permission.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupRoleGuard } from './group-role.guard';

@Module({
  imports: [TypeOrmModule.forFeature([GroupMember])],
  providers: [GroupPermissionGuard, GroupRoleGuard],
  exports: [GroupPermissionGuard, GroupRoleGuard],
})
export class GroupAuthorizationModule {}
