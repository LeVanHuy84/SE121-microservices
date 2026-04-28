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
import {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from 'typeorm';

@Injectable()
export class ConsumerService {
  constructor(
    @InjectRepository(Post) private readonly postRepository: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    private readonly dataSource: DataSource,
  ) {}

  private getRepository<T extends ObjectLiteral>(
    manager: EntityManager | undefined,
    entity: EntityTarget<T>,
    fallback: Repository<T>,
  ): Repository<T> {
    return manager ? manager.getRepository(entity) : fallback;
  }

  async handleEmotionResult(
    payload: AnalysisResultEventPayload,
    manager?: EntityManager,
  ): Promise<void> {
    const postRepository = this.getRepository(
      manager,
      Post,
      this.postRepository,
    );
    const commentRepository = this.getRepository(
      manager,
      Comment,
      this.commentRepository,
    );

    // Xử lý sự kiện CREATED ở đây
    switch (payload.targetType) {
      case TargetType.POST:
        const post = await postRepository.findOneBy({
          id: payload.targetId,
        });
        if (post) {
          post.mainEmotion = payload.finalEmotion as Emotion;
          await postRepository.save(post);
        }
        break;
      case TargetType.COMMENT:
        const comment = await commentRepository.findOneBy({
          id: payload.targetId,
        });
        if (comment) {
          comment.mainEmotion = payload.finalEmotion as Emotion;
          await commentRepository.save(comment);
        }
        break;
    }
  }

  async handleModerationRejected(
    payload: ModerationEventPayload,
    manager?: EntityManager,
  ): Promise<void> {
    const txManager = manager ?? this.dataSource.manager;
    let entity: Post | Comment | Share | null = null;

    switch (payload.targetType) {
      case TargetType.POST:
        entity = await txManager.findOne(Post, {
          where: { id: payload.targetId },
        });
        break;

      case TargetType.COMMENT:
        entity = await txManager.findOne(Comment, {
          where: { id: payload.targetId },
        });
        break;

      case TargetType.SHARE:
        entity = await txManager.findOne(Share, {
          where: { id: payload.targetId },
        });
        break;
    }

    if (!entity) return;

    // Soft delete
    entity.isDeleted = true;
    await txManager.save(entity);

    // Nếu là POST → emit removed event
    if (payload.targetType === TargetType.POST) {
      const postOutbox = txManager.create(OutboxEvent, {
        topic: EventTopic.POST,
        destination: EventDestination.KAFKA,
        eventType: PostEventType.REMOVED,
        payload: { postId: payload.targetId },
      });

      await txManager.save(postOutbox);
    }

    // Notification outbox
    const notiOutbox = txManager.create(OutboxEvent, {
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

    await txManager.save(notiOutbox);
  }
}
