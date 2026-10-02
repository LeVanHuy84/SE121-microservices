import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  AnalysisResultEventPayload,
  Emotion,
  EventDestination,
  EventTopic,
  ModerationAction,
  ModerationEventPayload,
  ModerationLabel,
  PostEventType,
  Severity,
  TargetType,
} from "@repo/dtos";

import { Comment } from "src/entities/comment.entity";
import { ContentModeration } from "src/entities/content-moderation.entity";
import { OutboxEvent } from "src/entities/outbox.entity";
import { Post } from "src/entities/post.entity";
import { Share } from "src/entities/share.entity";
import {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from "typeorm";

@Injectable()
export class ConsumerService {
  private readonly logger = new Logger(ConsumerService.name);

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

  private normalizeModerationAction(
    action?: string | ModerationAction,
  ): ModerationAction {
    if (!action) return ModerationAction.HARD_BLOCK;
    const normalized = String(action).toUpperCase().replace(/-/g, "_");
    if (
      Object.values(ModerationAction).includes(normalized as ModerationAction)
    ) {
      return normalized as ModerationAction;
    }
    return ModerationAction.HARD_BLOCK;
  }

  private normalizeModerationLabel(
    label?: string | ModerationLabel,
  ): ModerationLabel {
    if (!label) return ModerationLabel.CLEAN;
    const normalized = String(label).toUpperCase().replace(/-/g, "_");
    if (
      Object.values(ModerationLabel).includes(normalized as ModerationLabel)
    ) {
      return normalized as ModerationLabel;
    }
    return ModerationLabel.CLEAN;
  }

  private normalizeSeverity(severity?: string | Severity): Severity {
    if (!severity) return Severity.NONE;
    const normalized = String(severity).toUpperCase().replace(/-/g, "_");
    if (Object.values(Severity).includes(normalized as Severity)) {
      return normalized as Severity;
    }
    return Severity.NONE;
  }

  async handleEmotionResult(
    payload: AnalysisResultEventPayload,
    manager?: EntityManager,
  ): Promise<void> {
    // 1. Process embedded moderation if present
    let isHardBlocked = false;
    if (payload.moderation) {
      isHardBlocked = await this.handleModerationResult(
        payload.moderation,
        manager,
      );
    }

    // Nếu đã bị HARD_BLOCK thì không tiếp tục cập nhật cảm xúc hoặc lưu đè entity
    if (isHardBlocked) {
      return;
    }

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

    const emotion = payload.primaryEmotion;
    const secondaryEmotions = payload.secondaryEmotions || [];
    const targetType = String(payload.targetType || "").toUpperCase();

    switch (targetType) {
      case TargetType.POST:
        const post = await postRepository.findOneBy({
          id: payload.targetId,
        });
        if (post && !post.isDeleted && emotion) {
          post.mainEmotion = emotion;
          post.secondaryEmotions = secondaryEmotions;
          await postRepository.save(post);
        }
        break;
      case TargetType.COMMENT:
        const comment = await commentRepository.findOneBy({
          id: payload.targetId,
        });
        if (comment && !comment.isDeleted && emotion) {
          comment.mainEmotion = emotion;
          comment.secondaryEmotions = secondaryEmotions;
          await commentRepository.save(comment);
        }
        break;
    }
  }

  async handleModerationResult(
    payload: ModerationEventPayload,
    manager?: EntityManager,
  ): Promise<boolean> {
    const txManager = manager ?? this.dataSource.manager;

    const action = this.normalizeModerationAction(payload.action);
    const targetType = String(payload.targetType || "").toUpperCase() as TargetType;

    let entity: Post | Comment | Share | null = null;

    switch (targetType) {
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

    if (!entity) {
      this.logger.warn(
        `Entity not found for targetId=${payload.targetId}, targetType=${targetType}`,
      );
      return action === ModerationAction.HARD_BLOCK;
    }

    // =====================================================
    // 1. SAVE CONTENT MODERATION (UPSERT)
    // =====================================================

    let moderation = await txManager.findOne(ContentModeration, {
      where: {
        targetId: payload.targetId,
        targetType: targetType,
      },
    });

    if (!moderation) {
      moderation = txManager.create(ContentModeration, {
        userId: payload.userId || entity.userId,
        targetId: payload.targetId,
        targetType: targetType,
      });
    }

    moderation.action = action;
    moderation.label = this.normalizeModerationLabel(payload.label);
    moderation.isViolation =
      payload.isViolation ?? (action === ModerationAction.HARD_BLOCK);
    moderation.mentalHealthSupport =
      payload.mentalHealthSupport ??
      (action === ModerationAction.ALLOW_WITH_SUPPORT);

    moderation.violations = Array.isArray(payload.violations)
      ? payload.violations.map((v) => ({
          category: v.category,
          reason: v.reason,
        }))
      : [];

    moderation.maxSeverity = this.normalizeSeverity(payload.maxSeverity);
    moderation.confidence = payload.confidence ?? 0;
    moderation.displayMessage = payload.displayMessage ?? "";

    await txManager.save(moderation);

    // =====================================================
    // 2. PROCESS BY ACTION (HARD_BLOCK vs WARNING vs SUPPORT vs ALLOW)
    // =====================================================

    if (action === ModerationAction.HARD_BLOCK) {
      entity.isDeleted = true;
      if (entity instanceof Post) {
        entity.moderationAction = ModerationAction.HARD_BLOCK;
        entity.hasWarning = false;
        entity.warningReason = payload.displayMessage;
      }
      await txManager.save(entity);

      if (targetType === TargetType.POST) {
        const postOutbox = txManager.create(OutboxEvent, {
          topic: EventTopic.POST,
          destination: EventDestination.KAFKA,
          eventType: PostEventType.REMOVED,
          payload: { postId: payload.targetId },
        });

        await txManager.save(postOutbox);
      }
    } else if (entity instanceof Post) {
      entity.moderationAction = action;
      if (action === ModerationAction.ALLOW_WITH_WARNING) {
        entity.hasWarning = true;
        entity.warningReason = payload.displayMessage;
      } else if (action === ModerationAction.ALLOW_WITH_SUPPORT) {
        entity.needsMentalSupport = true;
        entity.hasWarning = false;
      } else {
        entity.hasWarning = false;
      }
      await txManager.save(entity);
    }

    // =====================================================
    // 3. NOTIFICATION (Only send when user attention is required)
    // =====================================================

    const shouldSendNotification =
      action === ModerationAction.HARD_BLOCK ||
      action === ModerationAction.ALLOW_WITH_WARNING ||
      action === ModerationAction.ALLOW_WITH_SUPPORT ||
      Boolean(payload.isViolation) ||
      Boolean(payload.mentalHealthSupport);

    if (shouldSendNotification) {
      const defaultMessage =
        action === ModerationAction.HARD_BLOCK
          ? "Nội dung của bạn đã bị ẩn do vi phạm quy chuẩn cộng đồng."
          : action === ModerationAction.ALLOW_WITH_WARNING
            ? "Nội dung của bạn có lưu ý về quy chuẩn cộng đồng."
            : action === ModerationAction.ALLOW_WITH_SUPPORT
              ? "Nếu bạn đang cảm thấy căng thẳng hoặc cần chia sẻ, chúng tôi luôn ở đây để hỗ trợ bạn."
              : "Nội dung của bạn có dấu hiệu vi phạm quy chuẩn cộng đồng.";

      const message = payload.displayMessage || defaultMessage;

      const notiOutbox = txManager.create(OutboxEvent, {
        topic: "notification",
        destination: EventDestination.RABBITMQ,
        eventType: "base_noti",
        payload: {
          targetId: payload.targetId,
          targetType: targetType,
          actorName: "SentiMeta System",
          actorAvatar: "https://sentimeta.vercel.app/logo.svg",
          content: message,
          receivers: [entity.userId],
        },
      });

      await txManager.save(notiOutbox);
    }

    return action === ModerationAction.HARD_BLOCK;
  }

  // Backwards compatibility alias
  async handleModerationRejected(
    payload: ModerationEventPayload,
    manager?: EntityManager,
  ): Promise<boolean> {
    return this.handleModerationResult(payload, manager);
  }
}
