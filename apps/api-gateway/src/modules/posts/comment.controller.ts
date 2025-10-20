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
  CreateCommentDTO,
  GetCommentQueryDTO,
  UpdateCommentDTO,
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
  create(@Body() dto: CreateCommentDTO, @CurrentUserId() userId: string) {
    return this.client.send('create_comment', { userId, dto });
  }

  @Get('comment/:id')
  findById(@CurrentUserId() userRequestId: string, @Param('id') id: string) {
    return this.client.send('find_comment_by_id', {
      userRequestId,
      commentId: id,
    });
  }

  @Get()
  findByQuery(
    @CurrentUserId() userRequestId: string,
    @Query() query: GetCommentQueryDTO
  ) {
    return this.client.send('find_comments_by_query', { userRequestId, query });
  }

  @Put(':id')
  update(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCommentDTO
  ) {
    return this.client.send('update_comment', { userId, id, dto });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.client.send('remove_comment', id);
  }
}
