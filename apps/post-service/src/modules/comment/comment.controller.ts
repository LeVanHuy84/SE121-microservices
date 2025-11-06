import { Controller } from '@nestjs/common';
import { CommentService } from './service/comment.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateCommentDTO,
  GetCommentQueryDTO,
  UpdateCommentDTO,
} from '@repo/dtos';
import { CommentQueryService } from './service/comment-query.service';

@Controller('comment')
export class CommentController {
  constructor(
    private commentService: CommentService,
    private readonly queryService: CommentQueryService
  ) {}

  @MessagePattern('create_comment')
  create(@Payload() payload: { userId: string; dto: CreateCommentDTO }) {
    return this.commentService.create(payload.userId, payload.dto);
  }

  @MessagePattern('find_comment_by_id')
  findById(@Payload() payload: { userRequestId: string; commentId: string }) {
    return this.queryService.findById(payload.userRequestId, payload.commentId);
  }

  @MessagePattern('find_comments_by_query')
  findByQuery(
    @Payload() payload: { userRequestId: string; query: GetCommentQueryDTO }
  ) {
    return this.queryService.findByQuery(payload.userRequestId, payload.query);
  }

  @MessagePattern('update_comment')
  update(
    @Payload()
    payload: {
      userId: string;
      commentId: string;
      dto: UpdateCommentDTO;
    }
  ) {
    return this.commentService.update(
      payload.userId,
      payload.commentId,
      payload.dto
    );
  }

  @MessagePattern('remove_comment')
  remove(@Payload() payload: { userId: string; commentId: string }) {
    return this.commentService.remove(payload.userId, payload.commentId);
  }
}
