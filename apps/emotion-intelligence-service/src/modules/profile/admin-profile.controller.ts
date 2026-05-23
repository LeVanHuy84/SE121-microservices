import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { AdminProfileService } from './admin-profile.service';
import { PageResponse, RiskUserDto, RiskUsersQueryDto } from '@repo/dtos';

@Controller()
export class AdminProfileController {
  constructor(private readonly svc: AdminProfileService) {}

  @MessagePattern('emotion-admin.profile.risk-users')
  async listRiskUsers(
    payload: RiskUsersQueryDto,
  ): Promise<PageResponse<RiskUserDto>> {
    return this.svc.listRiskUsers(payload);
  }
}
