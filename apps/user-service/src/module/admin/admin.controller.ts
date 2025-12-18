import { Controller } from '@nestjs/common';
import { AdminService } from './admin.service';
import { MessagePattern } from '@nestjs/microservices';
import {
  CreateSystemUserDTO,
  SystemRole,
  SystemUserQueryDTO,
} from '@repo/dtos';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @MessagePattern('create-system-user')
  async createSystemUser(data: { dto: CreateSystemUserDTO; actorId: string }) {
    return this.adminService.createSystemUser(data.dto, data.actorId);
  }

  @MessagePattern('update-system-user-role')
  async updateSystemUserRole(data: {
    userId: string;
    role: SystemRole;
    actorId: string;
  }) {
    return this.adminService.updateSystemUserRole(
      data.userId,
      data.role,
      data.actorId
    );
  }

  @MessagePattern('get-system-users')
  async getSystemUsers(filter: SystemUserQueryDTO) {
    return this.adminService.getSystemUsers(filter);
  }

  @MessagePattern('ban-user')
  async banUser(data: { userId: string; actorId: string }) {
    return this.adminService.banUser(data.userId, data.actorId);
  }

  @MessagePattern('unban-user')
  async unbanUser(data: { userId: string; actorId: string }) {
    return this.adminService.unbanUser(data.userId, data.actorId);
  }
}
