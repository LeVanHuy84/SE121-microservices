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
import { ContentModeration } from 'src/entities/content-moderation.entity';
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
    let notificationMessage: string;

    switch (payload.targetType) {
      case TargetType.POST:
        entity = await txManager.findOne(Post, {
          where: { id: payload.targetId },
        });
        notificationMessage = `Bài viết ""${(entity?.content ?? '').slice(0, 100)}""... của bạn đã bị gỡ do vi phạm chính sách cộng đồng.`;
        break;

      case TargetType.COMMENT:
        entity = await txManager.findOne(Comment, {
          where: { id: payload.targetId },
        });
        notificationMessage = `Bình luận ""${(entity?.content ?? '').slice(0, 100)}""... của bạn đã bị gỡ do vi phạm chính sách cộng đồng.`;
        break;

      case TargetType.SHARE:
        entity = await txManager.findOne(Share, {
          where: { id: payload.targetId },
        });
        notificationMessage = `Bài chia sẻ ""${(entity?.content ?? '').slice(0, 100)}""... của bạn đã bị gỡ do vi phạm chính sách cộng đồng.`;
        break;
    }

    if (!entity) return;

    // =====================================================
    // 1. SAVE CONTENT MODERATION (UPSERT)
    // =====================================================

    let moderation = await txManager.findOne(ContentModeration, {
      where: {
        targetId: payload.targetId,
        targetType: payload.targetType,
      },
    });

    if (!moderation) {
      moderation = txManager.create(ContentModeration, {
        userId: payload.userId,
        targetId: payload.targetId,
        targetType: payload.targetType,
      });
    }

    moderation.violations = Array.isArray(payload.violations)
      ? payload.violations.map((v) => ({
          category: v.category,
          reason: v.reason,
        }))
      : [];

    moderation.maxSeverity = payload.maxSeverity as any;
    moderation.confidence = payload.confidence;
    moderation.displayMessage = payload.displayMessage;

    await txManager.save(moderation);

    // =====================================================
    // 2. SOFT DELETE CONTENT
    // =====================================================

    entity.isDeleted = true;
    await txManager.save(entity);

    // =====================================================
    // 3. POST EVENT (nếu là post)
    // =====================================================

    if (payload.targetType === TargetType.POST) {
      const postOutbox = txManager.create(OutboxEvent, {
        topic: EventTopic.POST,
        destination: EventDestination.KAFKA,
        eventType: PostEventType.REMOVED,
        payload: { postId: payload.targetId },
      });

      await txManager.save(postOutbox);
    }

    // =====================================================
    // 4. NOTIFICATION
    // =====================================================

    const notiOutbox = txManager.create(OutboxEvent, {
      topic: 'notification',
      destination: EventDestination.RABBITMQ,
      eventType: 'base_noti',
      payload: {
        targetId: payload.targetId,
        targetType: payload.targetType,
        actorName: 'SentiMeta System',
        actorAvatar: 'https://sentimeta.vercel.app/logo.svg',
        content: notificationMessage,
        receivers: [entity.userId],
      },
    });

    await txManager.save(notiOutbox);
  }
}
