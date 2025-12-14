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
  CreateGroupDTO,
  CursorPaginationDTO,
  UpdateGroupDTO,
  UpdateGroupSettingDTO,
} from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('groups')
export class GroupController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.GROUP_SERVICE)
    private client: ClientProxy
  ) {}

  @Get('health')
  healthCheck() {
    return this.client.send('health_check', {});
  }

  @Get('group/:id')
  findById(@Param('id') groupId: string, @CurrentUserId() userId: string) {
    return this.client.send('find_group_by_id', { userId, groupId });
  }

  @Get('my-groups')
  search(@Query() query: CursorPaginationDTO, @CurrentUserId() userId: string) {
    return this.client.send('get_my_groups', { userId, query });
  }

  @Get('recommendations')
  recommend(
    @Query() query: CursorPaginationDTO,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('recommend_groups', { userId, query });
  }

  @Post()
  create(
    @CurrentUserId() userId: string,
    @Body() createGroupDto: CreateGroupDTO
  ) {
    return this.client.send('create_group', { userId, dto: createGroupDto });
  }

  @Patch('group/:id')
  update(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() updateGroupDto: Partial<UpdateGroupDTO>
  ) {
    return this.client.send('update_group', {
      userId,
      groupId: id,
      dto: updateGroupDto,
    });
  }

  @Delete('group/:id')
  delete(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.client.send('delete_group', { userId, groupId: id });
  }

  // Setting
  @Get('group/:id/settings')
  getGroupSettings(
    @CurrentUserId() userId: string,
    @Param('id') groupId: string
  ) {
    return this.client.send('get-group-setting', { userId, groupId });
  }

  @Patch('group/:id/settings')
  updateGroupSettings(
    @CurrentUserId() userId: string,
    @Param('id') groupId: string,
    @Body() settings: UpdateGroupSettingDTO
  ) {
    return this.client.send('update-group-setting', {
      userId,
      groupId,
      settings,
    });
  }
}
