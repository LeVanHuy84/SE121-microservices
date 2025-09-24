import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CreateCommentDto,
  GetCommentQueryDto,
  UpdateCommentDto,
} from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('comments')
export class CommentController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.POST_SERVICE)
    private client: ClientProxy
  ) {}

  @Post()
  create(@Body() dto: CreateCommentDto, @CurrentUserId() userId: string) {
    return this.client.send('create_comment', { userId, dto });
  }

  @Get('comment/:id')
  getCommentById(@Param('id') id: string) {
    return this.client.send('get_comment_by_id', id);
  }

  @Get()
  getComments(@Query() query: GetCommentQueryDto) {
    return this.client.send('get_comment_of_target', query);
  }

  @Put(':id')
  update(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCommentDto
  ) {
    return this.client.send('update_comment', { userId, id, dto });
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.client.send('delete_comment', id);
  }
}
