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
import { CreateShareDTO, PaginationDTO, UpdateShareDTO } from '@repo/dtos';
import { share } from 'rxjs';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('shares')
export class ShareController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.POST_SERVICE)
    private client: ClientProxy
  ) {}

  @Post()
  sharePost(@CurrentUserId() userId: string, @Body() dto: CreateShareDTO) {
    return this.client.send('share_post', { userId, dto });
  }

  @Patch('share/:id')
  update(
    @CurrentUserId() userId: string,
    @Param('id') shareId: string,
    @Body() dto: UpdateShareDTO
  ) {
    this.client.send('update_share_post', { userId, shareId, dto });
  }

  @Get('share/:id')
  findById(@Param('id') id: string) {
    return this.client.send('find_share_by_id', id);
  }

  @Get('user/:id')
  findByUserId(@Param('id') userId: string, @Query() query: PaginationDTO) {
    return this.client.send('find_share_by_user_id', { userId, query });
  }

  @Delete('share/:id')
  remove(@CurrentUserId() userId: string, @Param('id') shareId: string) {
    return this.client.send('remove_share', { userId, shareId });
  }
}
