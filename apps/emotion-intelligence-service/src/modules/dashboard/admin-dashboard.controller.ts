import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AdminDashboardService } from './admin-dashboard.service';
import { DashboardOverviewResponseDto } from '@repo/dtos';

@Controller()
export class AdminDashboardController {
  constructor(private readonly adminService: AdminDashboardService) {}

  @MessagePattern('emotion-admin.dashboard.overview')
  async getOverview(
    @Payload() _payload: any,
  ): Promise<DashboardOverviewResponseDto> {
    return this.adminService.getOverview();
  }
}
