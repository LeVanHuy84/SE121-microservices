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
    const [userReport, postReport, groupReport] = await Promise.all([
      lastValueFrom(this.userClient.send('user-dashboard', filter)),
      lastValueFrom(this.postClient.send('get_post_dashboard', filter)),
      lastValueFrom(this.groupClient.send('get_group_dashboard', filter)),
    ]);

    return {
      activeUsers: userReport.activeUsers,
      totalPosts: postReport.totalPosts,
      totalGroups: groupReport.totalGroups,
      pendingReports: postReport.pendingReports + groupReport.pendingReports,
    };
  }

  @Get('content-chart')
  @RequireRole(SystemRole.ADMIN)
  async getPostDashboard(@Query() filter: DashboardQueryDTO) {
    return this.postClient.send('get_content_chart', filter);
  }

  @Get('report-chart')
  @RequireRole(SystemRole.ADMIN)
  async getReportChart(@Query() filter: DashboardQueryDTO) {
    const [contentReport, groupReport] = await Promise.all([
      lastValueFrom(this.postClient.send('get_content_report_chart', filter)),
      lastValueFrom(this.groupClient.send('get_group_report_chart', filter)),
    ]);

    const map = new Map<
      string,
      {
        date: string;
        pendingCount: number;
        resolvedCount: number;
        rejectedCount: number;
      }
    >();

    // helper merge
    const merge = (items: any[]) => {
      items.forEach((item) => {
        if (!map.has(item.date)) {
          map.set(item.date, {
            date: item.date,
            pendingCount: 0,
            resolvedCount: 0,
            rejectedCount: 0,
          });
        }

        const target = map.get(item.date)!;
        target.pendingCount += item.pendingCount || 0;
        target.resolvedCount += item.resolvedCount || 0;
        target.rejectedCount += item.rejectedCount || 0;
      });
    };

    merge(contentReport);
    merge(groupReport);

    // sort theo ngày tăng dần (frontend rất thích)
    return Array.from(map.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }
}
