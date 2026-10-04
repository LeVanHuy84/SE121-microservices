import { Injectable, Logger } from '@nestjs/common';
import { PostIndexService } from '../../post/post-index.service';
import {
  AnalysisResultEventPayload,
  Emotion,
  InferPostPayload,
  ModerationAction,
  PostEventType,
  TargetType,
} from '@repo/dtos';

@Injectable()
export class PostConsumerService {
  private readonly logger = new Logger(PostConsumerService.name);

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

  handleEmotionResult(payload: AnalysisResultEventPayload) {
    if (payload.targetType !== TargetType.POST) return;

    if (payload.moderation?.action === ModerationAction.HARD_BLOCK) {
      this.logger.log(
        `Deleting post ${payload.targetId} from search index due to HARD_BLOCK moderation`,
      );
      this.postIndexService.deleteDocument(payload.targetId);
      return;
    }

    const { targetId, primaryEmotion } = payload;
    if (primaryEmotion) {
      this.postIndexService.updatePartialDocument(targetId, {
        mainEmotion: primaryEmotion,
      });
    }
  }
}
