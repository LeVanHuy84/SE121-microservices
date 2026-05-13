import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  AdminGroupQuery,
  CreateGroupDTO,
  CursorPaginationDTO,
  SystemRole,
  UpdateGroupDTO,
  UpdateGroupSettingDTO,
} from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { RequireRole } from 'src/common/decorators/require-role.decorator';

@Controller('groups')
export class GroupController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.GROUP_SERVICE)
    private client: ClientProxy,
  ) {}

  @Get('health')
  healthCheck() {
    return this.client.send('health_check', {});
  }

  @Get('admin')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  getGroupByAdmin(@Query() filter: AdminGroupQuery) {
    return this.client.send('get_group_by_admin', filter);
  }

  @Get('my-groups')
  search(@Query() query: CursorPaginationDTO, @CurrentUserId() userId: string) {
    return this.client.send('get_my_groups', { userId, query });
  }

  @Get('recommendations')
  recommend(
    @Query() query: CursorPaginationDTO,
    @CurrentUserId() userId: string,
  ) {
    return this.client.send('recommend_groups', { userId, query });
  }

  @Get('invited-groups')
  getInvitedGroups(
    @Query() query: CursorPaginationDTO,
    @CurrentUserId() userId: string,
  ) {
    return this.client.send('get_invited_groups', { userId, query });
  }

  @Post()
  create(
    @CurrentUserId() userId: string,
    @Body() createGroupDto: CreateGroupDTO,
  ) {
    return this.client.send('create_group', { userId, dto: createGroupDto });
  }

  @Get(':groupId')
  findById(@Param('groupId') groupId: string, @CurrentUserId() userId: string) {
    return this.client.send('find_group_by_id', { userId, groupId });
  }

  @Patch(':groupId')
  update(
    @CurrentUserId() userId: string,
    @Param('groupId') groupId: string,
    @Body() updateGroupDto: Partial<UpdateGroupDTO>,
  ) {
    return this.client.send('update_group', {
      userId,
      groupId,
      dto: updateGroupDto,
    });
  }

  @Delete(':groupId')
  delete(@CurrentUserId() userId: string, @Param('groupId') groupId: string) {
    return this.client.send('delete_group', { userId, groupId });
  }

  // Setting
  @Get(':groupId/settings')
  getGroupSettings(
    @CurrentUserId() userId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.client.send('get-group-setting', { userId, groupId });
  }

  @Patch(':groupId/settings')
  updateGroupSettings(
    @CurrentUserId() userId: string,
    @Param('groupId') groupId: string,
    @Body() settings: UpdateGroupSettingDTO,
  ) {
    return this.client.send('update-group-setting', {
      userId,
      groupId,
      settings,
    });
  }
}
