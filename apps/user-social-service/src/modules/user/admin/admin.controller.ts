import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { Payload } from "@nestjs/microservices";
import {
  CreateSystemUserDTO,
  DashboardQueryDTO,
  SystemRole,
  SystemUserQueryDTO,
} from "@repo/dtos";

@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @TcpMessagePattern("create-system-user")
  async createSystemUser(data: { dto: CreateSystemUserDTO; actorId: string }) {
    return this.adminService.createSystemUser(data.dto, data.actorId);
  }

  @TcpMessagePattern("update-system-user-role")
  async updateSystemUserRole(data: {
    userId: string;
    role: SystemRole;
    actorId: string;
  }) {
    return this.adminService.updateSystemUserRole(
      data.userId,
      data.role,
      data.actorId,
    );
  }

  @TcpMessagePattern("get-system-users")
  async getSystemUsers(filter: SystemUserQueryDTO) {
    return this.adminService.getSystemUsers(filter);
  }

  @TcpMessagePattern("ban-user")
  async banUser(data: { userId: string; actorId: string }) {
    return this.adminService.banUser(data.userId, data.actorId);
  }

  @TcpMessagePattern("unban-user")
  async unbanUser(data: { userId: string; actorId: string }) {
    return this.adminService.unbanUser(data.userId, data.actorId);
  }

  @TcpMessagePattern("user-dashboard")
  async getDashboard(@Payload() filter: DashboardQueryDTO) {
    return this.adminService.getDashboard(filter);
  }
}
