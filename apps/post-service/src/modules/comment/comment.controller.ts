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

  @MessagePattern('find_comment_by_id')
  findById(@Payload() id: string) {
    return this.commentService.findById(id);
  }

  @MessagePattern('find_comments_by_query')
  findByQuery(@Payload() query: GetCommentQueryDTO) {
    return this.commentService.findByQuery(query);
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
  remove(@Payload() id: string) {
    return this.commentService.remove(id);
  }
}
