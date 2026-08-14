import { Injectable } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import { EditHistory } from "src/entities/edit-history.entity";
import { PostStat } from "src/entities/post-stat.entity";
import { Post } from "src/entities/post.entity";
import { Reaction } from "src/entities/reaction.entity";
import { OutboxEvent } from "src/entities/outbox.entity";
import { Comment } from "src/entities/comment.entity"; // nhớ import nếu chưa có

import {
  ActivityType,
  Audience,
  CreatePostDTO,
  EventDestination,
  EventTopic,
  MediaDeleteItem,
  MediaEventPayloads,
  MediaEventType,
  MediaType,
  PostEventType,
  PostSnapshotDTO,
  RootType,
  TargetType,
  UpdatePostDTO,
} from "@repo/dtos";
import { PostCacheService } from "./post-cache.service";
import { PostShortenMapper } from "../post-shorten.mapper";
import { OutboxService } from "src/modules/event/outbox.service";

@Injectable()
export class PostCommandService {
  constructor(
    @InjectRepository(Post) private readonly postRepo: Repository<Post>,
    private readonly dataSource: DataSource,
    private readonly postCache: PostCacheService,
    private readonly outboxService: OutboxService,
  ) {}

  // ----------------------------------------
  // 📝 Tạo post
  // ----------------------------------------
  async create(userId: string, dto: CreatePostDTO): Promise<PostSnapshotDTO> {
    return this.dataSource.transaction(async (manager) => {
      const post = manager.create(Post, {
        ...dto,
        userId,
        postStat: manager.create(PostStat),
      });
      const entity = await manager.save(post);

      const mediaPayload:
        | MediaEventPayloads[MediaEventType.CONTENT_ID_ASSIGNED]
        | null =
        post.media && post.media.length > 0
          ? {
              contentId: entity.id,
              items: post.media
                .filter(
                  (m): m is typeof m & { publicId: string } => !!m.publicId,
                )
                .map((m) => ({
                  publicId: m.publicId,
                  url: m.url,
                  type: m.type,
                })),
            }
          : null;

      if (mediaPayload) {
        const mediaOutbox = manager.create(OutboxEvent, {
          topic: EventTopic.MEDIA,
          destination: EventDestination.KAFKA,
          eventType: MediaEventType.CONTENT_ID_ASSIGNED,
          payload: mediaPayload,
        });
        await manager.save(mediaOutbox);
      }

      // Nếu không phải bài private thì emit event
      if (dto.audience !== Audience.ONLY_ME) {
        const outbox = manager.create(OutboxEvent, {
          topic: EventTopic.POST,
          destination: EventDestination.KAFKA,
          eventType: PostEventType.CREATED,
          payload: {
            postId: entity.id,
            userId: entity.userId,
            groupId: entity.groupId ?? undefined,
            audience: entity.audience,
            content: entity.content,
            mediaPreviews: post.media?.slice(0, 4),
            mediaRemaining: Math.max(0, (post.media?.length ?? 0) - 4),
            createdAt: entity.createdAt,
          },
        });
        await manager.save(outbox);
      }

      await this.outboxService.createAnalysisEvent(
        manager,
        TargetType.POST,
        entity,
      );

      await this.outboxService.createUserActivityEvent(
        manager,
        ActivityType.POST_CREATED,
        {
          actorId: userId,
          activityType: ActivityType.POST_CREATED,
          targetId: entity.id,
          contentPreview: entity.content.slice(0, 100),
          metadata: {
            audience: entity.audience,
          },
          createdAt: entity.createdAt,
        },
      );

      return PostShortenMapper.toPostSnapshotDTO(entity);
    });
  }

  // ----------------------------------------
  // ✏️ Cập nhật post
  // ----------------------------------------
  async update(
    userId: string,
    postId: string,
    dto: UpdatePostDTO,
  ): Promise<PostSnapshotDTO> {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post)
      throw new RpcException({
        statusCode: 404,
        message: "Post not found",
      });
    if (post.userId !== userId)
      throw new RpcException({
        statusCode: 403,
        message: "Unauthorized",
      });

    return this.dataSource.transaction(async (manager) => {
      // Lưu lịch sử chỉnh sửa
      if (dto.content && dto.content !== post.content) {
        const history = manager.create(EditHistory, {
          oldContent: post.content,
          post,
        });
        await manager.save(history);
      }

      Object.assign(post, dto);
      const updated = await manager.save(post);

      // 🧹 Xóa cache Redis
      await this.postCache.removeCache(postId);

      // Emit outbox event
      const outbox =
        dto.audience === Audience.ONLY_ME
          ? manager.create(OutboxEvent, {
              topic: EventTopic.POST,
              destination: EventDestination.KAFKA,
              eventType: PostEventType.REMOVED,
              payload: { postId },
            })
          : manager.create(OutboxEvent, {
              topic: EventTopic.POST,
              destination: EventDestination.KAFKA,
              eventType: PostEventType.UPDATED,
              payload: { postId, content: dto.content, audience: dto.audience },
            });

      await manager.save(outbox);
      if (dto.content) {
        await this.outboxService.updatedAnalysisEvent(
          manager,
          TargetType.POST,
          postId,
          dto.content,
        );
      }

      return PostShortenMapper.toPostSnapshotDTO(updated);
    });
  }

  // ----------------------------------------
  // 🗑️ Xóa post
  // ----------------------------------------
  async remove(userId: string, postId: string): Promise<boolean> {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post) {
      throw new RpcException({
        statusCode: 404,
        message: "Post not found",
      });
    }

    if (post.userId !== userId) {
      throw new RpcException({
        statusCode: 403,
        message: "Unauthorized",
      });
    }

    // -------------------------------
    // Build media delete payload
    // -------------------------------
    let mediaPayload:
      | MediaEventPayloads[MediaEventType.DELETE_REQUESTED]
      | null = null;

    if (post.media && post.media.length > 0) {
      const items: MediaDeleteItem[] = post.media
        .filter((m): m is typeof m & { publicId: string } => !!m.publicId)
        .map((m) => ({
          publicId: m.publicId,
          resourceType:
            m.type === MediaType.IMAGE
              ? ("image" as const)
              : ("video" as const),
        }));

      if (items.length > 0) {
        mediaPayload = { items };
      }
    }

    // -------------------------------
    // Transaction
    // -------------------------------
    await this.dataSource.transaction(async (manager) => {
      // Xóa reaction của post
      await manager
        .createQueryBuilder()
        .delete()
        .from(Reaction)
        .where("target_id = :postId AND target_type = :targetType", {
          postId,
          targetType: TargetType.POST,
        })
        .execute();

      // Xóa comment gốc của post
      await manager
        .createQueryBuilder()
        .delete()
        .from(Comment)
        .where("root_target_id = :postId AND root_target_type = :rootType", {
          postId,
          rootType: RootType.POST,
        })
        .execute();

      // Xóa post
      await manager.remove(post);

      // 🧹 Xóa cache (best-effort, không phải source of truth)
      await this.postCache.removeCache(postId);

      // Outbox: Post removed
      const postOutbox = manager.create(OutboxEvent, {
        topic: EventTopic.POST,
        destination: EventDestination.KAFKA,
        eventType: PostEventType.REMOVED,
        payload: { postId },
      });

      await manager.save(postOutbox);

      // Outbox: Media delete requested
      if (mediaPayload) {
        const mediaOutbox = manager.create(OutboxEvent, {
          topic: EventTopic.MEDIA,
          destination: EventDestination.KAFKA,
          eventType: MediaEventType.DELETE_REQUESTED,
          payload: mediaPayload,
        });

        await manager.save(mediaOutbox);
      }
    });

    return true;
  }
}
