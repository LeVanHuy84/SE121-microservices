import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ContentEntryQuery, DashboardQueryDTO, SystemRole } from '@repo/dtos';
import { lastValueFrom } from 'rxjs';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { RequireRole } from 'src/common/decorators/require-role.decorator';

@Controller('admins')
export class AdminController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.USER_SERVICE)
    private userClient: ClientProxy,
    @Inject(MICROSERVICES_CLIENTS.POST_SERVICE) private postClient: ClientProxy,
    @Inject(MICROSERVICES_CLIENTS.GROUP_SERVICE)
    private groupClient: ClientProxy
  ) {}

  // Content
  @Get('contents')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  getContentEntry(@Query() filter: ContentEntryQuery) {
    return this.postClient.send('get_content_entry', filter);
  }

  @Get('dashboard')
  @RequireRole(SystemRole.ADMIN)
  async getDashboard(@Query() filter: DashboardQueryDTO) {
    const userReport = await lastValueFrom(
      this.userClient.send('user-dashboard', filter)
    );
    const postReport = await lastValueFrom(
      this.postClient.send('get_post_dashboard', filter)
    );
    const groupReport = await lastValueFrom(
      this.groupClient.send('get_group_dashboard', filter)
    );

    return {
      totalUser: userReport.totalUsers,
      activeUsers: userReport.activeUsers,
      totalPosts: postReport.totalPosts,
      totalGroups: groupReport.totalGroups,
      pendingReports: postReport.pendingReports + groupReport.pendingReports,
    };
  }

  @Get('post-dashboard')
  @RequireRole(SystemRole.ADMIN)
  async getPostDashboard() {
    return this.postClient.send('get_7d_post_dashboard', {});
  }
}
