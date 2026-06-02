import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  BaseUserDTO,
  PageResponse,
  RiskUserDto,
  RiskUsersQueryDto,
} from '@repo/dtos';
import { ProfileRepository } from './profile.repository';
import { UserClientService } from '../client/user/user-client.service';

@Injectable()
export class AdminProfileService {
  private readonly logger = new Logger(AdminProfileService.name);

  constructor(
    private readonly profileRepo: ProfileRepository,
    private readonly userClient: UserClientService,
  ) {}

  async listRiskUsers(
    query: RiskUsersQueryDto,
  ): Promise<PageResponse<RiskUserDto>> {
    try {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const result = await this.profileRepo.listRiskUsers(
        page,
        limit,
        query.riskLevel as any,
      );

      const userIds = result.items.map((i) => i.userId);
      const users: Record<string, BaseUserDTO> =
        await this.userClient.getUserInfos(userIds);
      const data: RiskUserDto[] = result.items.map((item) => {
        const user = users[item.userId];
        return {
          user,
          riskItem: item,
        };
      });

      return new PageResponse(data, result.total, result.page, result.limit);
    } catch (e) {
      this.logger.error('listRiskUsers failed', e as any);
      throw new RpcException({ statusCode: 500, message: 'LIST_RISK_FAILED' });
    }
  }
}
