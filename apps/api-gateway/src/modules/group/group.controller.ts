import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CreateGroupDTO, UpdateGroupDTO } from '@repo/dtos';
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
  findById(@Param('id') id: string) {
    return this.client.send('find_group_by_id', { id });
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
}
