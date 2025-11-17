import { Inject, Injectable } from '@nestjs/common';
import {
  CreatePostDTO,
  EventDestination,
  EventTopic,
  GroupEventLog,
  GroupPermission,
  GroupPrivacy,
  PostEventType,
  PostGroupEventPayload,
  PostGroupEventType,
  PostGroupStatus,
  PostSnapshotDTO,
} from '@repo/dtos';
import { PostStat } from 'src/entities/post-stat.entity';
import { Post } from 'src/entities/post.entity';
import { DataSource, EntityManager } from 'typeorm';
import { PostShortenMapper } from '../post-shorten.mapper';
import { PostGroupInfo } from 'src/entities/post-group-info.entity';
import { RpcException } from '@nestjs/microservices';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { PostCacheService } from './post-cache.service';

@Injectable()
export class PostGroupService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly postCache: PostCacheService
  ) {}

  // ----------------------------------------
  // 📝 Tạo post trong group
  // ----------------------------------------
  async create(
    userId: string,
    dto: CreatePostDTO
  ): Promise<{
    post: PostSnapshotDTO;
    status: PostGroupStatus;
    message: string;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const post = manager.create(Post, {
        ...dto,
        userId,
        postStat: manager.create(PostStat),
        postGroupInfo: manager.create(PostGroupInfo),
      });

      if (!dto.groupId) {
        throw new RpcException('Group ID is required for group posts');
      }

      const info = await this.postCache.getGroupUserPermission(
        userId,
        dto.groupId
      );

      if (!info.isMember) {
        throw new RpcException('User is not a member of the group');
      }

      // set status based on permissions/approval
      if (
        info.requireApproval === false ||
        info.permissions.includes(GroupPermission.APPROVE_POST)
      ) {
        post.postGroupInfo.status = PostGroupStatus.PUBLISHED;
      } else {
        post.postGroupInfo.status = PostGroupStatus.PENDING;
      }

      if (info.privacy === GroupPrivacy.PRIVATE) {
        post.postGroupInfo.isPrivateGroup = true;
      }

      // Save post first so it has id, timestamps, ... then create outbox if published
      const entity = await manager.save(post);

      if (entity.postGroupInfo?.status === PostGroupStatus.PUBLISHED) {
        await this.createOutboxEvent(manager, entity);
      } else {
        await this.createOutboxGroupEvent(
          manager,
          post,
          PostGroupEventType.POST_PENDING
        );
      }

      return {
        post: PostShortenMapper.toPostSnapshotDTO(entity),
        status: entity.postGroupInfo.status,
        message:
          entity.postGroupInfo.status === PostGroupStatus.PUBLISHED
            ? 'Your post has been published.'
            : 'Your post is pending approval by group admins.',
      };
    });
  }

  async approvePost(userId: string, postId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const post = await manager.findOne(Post, {
        where: { id: postId },
        relations: ['postGroupInfo'],
      });
      if (!post || !post.postGroupInfo)
        throw new RpcException('Post not found');

      if (post.postGroupInfo.status !== PostGroupStatus.PENDING) {
        throw new RpcException('Post is not pending approval');
      }

      const info = await this.postCache.getGroupUserPermission(
        userId,
        post.groupId
      );

      if (!info.permissions.includes(GroupPermission.APPROVE_POST)) {
        throw new RpcException('No permission to approve post');
      }

      post.postGroupInfo.status = PostGroupStatus.PUBLISHED;
      await manager.save(post.postGroupInfo);

      if (post) {
        await Promise.all([
          this.createOutboxEvent(manager, post),
          this.createOutboxGroupEvent(
            manager,
            post,
            PostGroupEventType.POST_APPROVED,
            userId
          ),
        ]);
      }
      return true;
    });
  }

  async rejectPost(userId: string, postId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const post = await manager.findOne(Post, {
        where: { id: postId },
        relations: ['postGroupInfo'],
      });
      if (!post || !post.postGroupInfo)
        throw new RpcException('Post not found');
      if (post.postGroupInfo.status !== PostGroupStatus.PENDING) {
        throw new RpcException('Post is not pending approval');
      }
      const info = await this.postCache.getGroupUserPermission(
        userId,
        post.groupId
      );
      if (!info.permissions.includes(GroupPermission.APPROVE_POST)) {
        throw new RpcException('No permission to reject post');
      }
      post.postGroupInfo.status = PostGroupStatus.REJECTED;
      await manager.save(post.postGroupInfo);
      if (post) {
        await this.createOutboxGroupEvent(
          manager,
          post,
          PostGroupEventType.POST_REJECTED,
          userId
        );
      }
      return true;
    });
  }

  // HELPER
  private async createOutboxEvent(manager: EntityManager, post: Post) {
    const outbox = manager.create(OutboxEvent, {
      topic: EventTopic.POST,
      destination: EventDestination.KAFKA,
      eventType: PostEventType.CREATED,
      payload: {
        postId: post.id,
        userId: post.userId,
        groupId: post.groupId,
        audience: post.audience,
        content: post.content,
        mediaPreviews: post.media?.slice(0, 4),
        mediaRemaining: Math.max(0, (post.media?.length ?? 0) - 4),
        createdAt: post.createdAt,
      },
    });
    await manager.save(outbox);
  }

  private async createOutboxGroupEvent(
    manager: EntityManager,
    post: Post,
    eventType: PostGroupEventType,
    actorId?: string
  ) {
    const payload: PostGroupEventPayload = {
      postId: post.id,
      userId: post.userId,
      groupId: post.groupId,
      content: post.content.slice(0, 100),
      actorId,
    };
    const outbox = manager.create(OutboxEvent, {
      topic: EventTopic.GROUP,
      destination: EventDestination.KAFKA,
      eventType,
      payload,
    });
    await manager.save(outbox);
  }
}
