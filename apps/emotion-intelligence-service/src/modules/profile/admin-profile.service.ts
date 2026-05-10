import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { RiskUsersQueryDto } from '@repo/dtos';
import { ProfileRepository } from './profile.repository';

@Injectable()
export class AdminProfileService {
  private readonly logger = new Logger(AdminProfileService.name);

  constructor(private readonly profileRepo: ProfileRepository) {}

  async listRiskUsers(query: RiskUsersQueryDto) {
    try {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      return await this.profileRepo.listRiskUsers(
        page,
        limit,
        query.riskLevel as any,
      );
    } catch (e) {
      this.logger.error('listRiskUsers failed', e as any);
      throw new RpcException({ statusCode: 500, message: 'LIST_RISK_FAILED' });
    }
  }
}
