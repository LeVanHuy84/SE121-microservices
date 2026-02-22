import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AnalysisResultEventPayload,
  Emotion,
  EventDestination,
  EventTopic,
  ModerationEventPayload,
  PostEventType,
  TargetType,
} from '@repo/dtos';
import { Comment } from 'src/entities/comment.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Post } from 'src/entities/post.entity';
import { Share } from 'src/entities/share.entity';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class ConsumerService {
  constructor(
    @InjectRepository(Post) private readonly postRepository: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Share)
    private readonly shareRepository: Repository<Share>,
    private readonly dataSource: DataSource,
  ) {}

  async handleEmotionResult(
    payload: AnalysisResultEventPayload,
  ): Promise<void> {
    // Xử lý sự kiện CREATED ở đây
    switch (payload.targetType) {
      case TargetType.POST:
        const post = await this.postRepository.findOneBy({
          id: payload.targetId,
        });
        if (post) {
          post.mainEmotion = payload.finalEmotion as Emotion;
          await this.postRepository.save(post);
        }
        break;
      case TargetType.COMMENT:
        const comment = await this.commentRepository.findOneBy({
          id: payload.targetId,
        });
        if (comment) {
          comment.mainEmotion = payload.finalEmotion as Emotion;
          await this.commentRepository.save(comment);
        }
        break;
    }
  }

  async handleModerationRejected(
    payload: ModerationEventPayload,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      let entity: Post | Comment | Share | null = null;

      switch (payload.targetType) {
        case TargetType.POST:
          entity = await manager.findOne(Post, {
            where: { id: payload.targetId },
          });
          break;

        case TargetType.COMMENT:
          entity = await manager.findOne(Comment, {
            where: { id: payload.targetId },
          });
          break;

        case TargetType.SHARE:
          entity = await manager.findOne(Share, {
            where: { id: payload.targetId },
          });
          break;
      }

      if (!entity) return;

      // Soft delete
      entity.isDeleted = true;
      await manager.save(entity);

      // Nếu là POST → emit removed event
      if (payload.targetType === TargetType.POST) {
        const postOutbox = manager.create(OutboxEvent, {
          topic: EventTopic.POST,
          destination: EventDestination.KAFKA,
          eventType: PostEventType.REMOVED,
          payload: { postId: payload.targetId },
        });

        await manager.save(postOutbox);
      }

      // Notification outbox
      const notiOutbox = manager.create(OutboxEvent, {
        topic: 'notification',
        destination: EventDestination.RABBITMQ,
        eventType: 'base_noti',
        payload: {
          targetId: payload.targetId,
          targetType: payload.targetType,
          actorName: 'SentiMeta System',
          actorAvatar: 'https://sentimeta.vercel.app/logo.svg',
          content: (entity.content ?? '').slice(0, 100),
          receivers: [entity.userId],
        },
      });

      await manager.save(notiOutbox);
    });
  }
}
