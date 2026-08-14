import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { CreateGroupReportDTO, GroupReportQuery, SystemRole } from "@repo/dtos";
import { MICROSERVICES_CLIENTS } from "src/common/constants";
import { CurrentUserId } from "src/common/decorators/current-user-id.decorator";
import { RequireRole } from "src/common/decorators/require-role.decorator";

@Controller("group-reports")
export class GroupReportController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.USER_SOCIAL_SERVICE)
    private client: ClientProxy,
  ) {}

  @Post("/:groupId")
  createGroupReport(
    @Param("groupId") groupId: string,
    @Body() createGroupReport: CreateGroupReportDTO,
    @CurrentUserId() reporterId: string,
  ) {
    return this.client.send("create_group_report", {
      groupId,
      reporterId,
      createGroupReport,
    });
  }

  @Get()
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  getGroupReports(@Query() filter: GroupReportQuery) {
    return this.client.send("get_group_reports", filter);
  }

  // domain này có thể bỏ
  @Get("/top-reported")
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  getTopReportedGroups(@Query("topN") topN: number) {
    return this.client.send("get_top_reported_groups", { topN });
  }

  @Post("/:groupId/ignore")
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  ignoreGroupReport(
    @Param("groupId") groupId: string,
    @CurrentUserId() actorId: string,
  ) {
    return this.client.send("ignore_group_report", { groupId, actorId });
  }

  @Post("/:groupId/ban")
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  banGroup(
    @Param("groupId") groupId: string,
    @CurrentUserId() actorId: string,
  ) {
    return this.client.send("ban_group", { groupId, actorId });
  }

  @Post("/:groupId/unban")
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  unbanGroup(
    @Param("groupId") groupId: string,
    @CurrentUserId() actorId: string,
  ) {
    return this.client.send("unban_group", { groupId, actorId });
  }
}
