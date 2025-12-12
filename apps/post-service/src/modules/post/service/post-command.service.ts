import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { EditHistory } from 'src/entities/edit-history.entity';
import { PostStat } from 'src/entities/post-stat.entity';
import { Post } from 'src/entities/post.entity';
import { Reaction } from 'src/entities/reaction.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Comment } from 'src/entities/comment.entity'; // nhớ import nếu chưa có

import {
  AnalysisEventType,
  Audience,
  CreatePostDTO,
  EventDestination,
  EventTopic,
  PostEventType,
  PostSnapshotDTO,
  RootType,
  TargetType,
  UpdatePostDTO,
} from '@repo/dtos';
import { PostCacheService } from './post-cache.service';
import { PostShortenMapper } from '../post-shorten.mapper';
import { OutboxService } from 'src/modules/event/outbox.service';

@Injectable()
export class PostCommandService {
  constructor(
    @InjectRepository(Post) private readonly postRepo: Repository<Post>,
    private readonly dataSource: DataSource,
    private readonly postCache: PostCacheService,
    private readonly outboxService: OutboxService
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
        entity
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
    dto: Partial<UpdatePostDTO>
  ): Promise<PostSnapshotDTO> {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post) throw new RpcException('Post not found');
    if (post.userId !== userId) throw new RpcException('Unauthorized');

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
              payload: { postId, content: dto.content },
            });

      await manager.save(outbox);
      if (dto.content) {
        await this.outboxService.updatedAnalysisEvent(
          manager,
          TargetType.POST,
          postId,
          dto.content
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
    if (!post) throw new RpcException('Post not found');
    if (post.userId !== userId) throw new RpcException('Unauthorized');

    await this.dataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .delete()
        .from(Reaction)
        .where('target_id = :postId AND target_type = :targetType', {
          postId,
          targetType: TargetType.POST,
        })
        .execute();

      await manager
        .createQueryBuilder()
        .delete()
        .from(Comment)
        .where('root_target_id = :postId AND root_target_type = :rootType', {
          postId,
          rootType: RootType.POST,
        })
        .execute();

      await manager.remove(post);

      // 🧹 Xóa cache Redis
      await this.postCache.removeCache(postId);

      const outbox = manager.create(OutboxEvent, {
        topic: EventTopic.POST,
        destination: EventDestination.KAFKA,
        eventType: PostEventType.REMOVED,
        payload: { postId },
      });

      await manager.save(outbox);
    });
    return true;
  }
}
