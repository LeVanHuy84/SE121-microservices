import { Controller } from '@nestjs/common';
import { CommentService } from './comment.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateCommentDTO,
  GetCommentQueryDTO,
  UpdateCommentDTO,
} from '@repo/dtos';

@Controller('comment')
export class CommentController {
  constructor(private commentService: CommentService) {}

  @MessagePattern('create_comment')
  create(@Payload() payload: { userId: string; dto: CreateCommentDTO }) {
    return this.commentService.create(payload.userId, payload.dto);
  }

  @MessagePattern('get_comment_by_id')
  getCommentById(@Payload() id: string) {
    return this.commentService.getCommentById(id);
  }

  @MessagePattern('get_comment_of_target')
  getComments(@Payload() query: GetCommentQueryDTO) {
    return this.commentService.getComments(query);
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

  @MessagePattern('delete_comment')
  delete(@Payload() id: string) {
    return this.commentService.delete(id);
  }
}
