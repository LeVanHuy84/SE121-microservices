import { Module } from '@nestjs/common';
import { GroupPermissionGuard } from './group-permission.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupMember } from 'src/entities/group-member.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GroupMember])],
  providers: [GroupPermissionGuard],
  exports: [GroupPermissionGuard],
})
export class GroupAuthorizationModule {}
