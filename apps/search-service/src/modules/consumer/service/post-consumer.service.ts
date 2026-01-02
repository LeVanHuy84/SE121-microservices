import { Injectable } from '@nestjs/common';
import { PostIndexService } from '../../post/post-index.service';
import { InferPostPayload, PostEventType } from '@repo/dtos';

@Injectable()
export class PostConsumerService {
  constructor(private readonly postIndexService: PostIndexService) {}

  createPostIndex(payload: InferPostPayload<PostEventType.CREATED>) {
    const { postId, userId, groupId, content, createdAt } = payload;
    this.postIndexService.indexDocument(postId, {
      id: postId,
      userId,
      groupId,
      content,
      createdAt,
    });
  }

  updatePostIndex(payload: InferPostPayload<PostEventType.UPDATED>) {
    const { postId, content } = payload;
    this.postIndexService.updatePartialDocument(postId, {
      content,
    });
  }

  removePostIndex(payload: InferPostPayload<PostEventType.REMOVED>) {
    const { postId } = payload;
    this.postIndexService.deleteDocument(postId);
  }
}
