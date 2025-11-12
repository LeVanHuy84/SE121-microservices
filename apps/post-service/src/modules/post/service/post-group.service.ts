import { Inject, Injectable } from '@nestjs/common';
import {
  CreatePostDTO,
  EventDestination,
  EventTopic,
  GroupPermission,
  GroupPrivacy,
  PostEventType,
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
  async create(userId: string, dto: CreatePostDTO): Promise<PostSnapshotDTO> {
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

      // Nếu không phải bài private thì emit event
      const info = await this.postCache.getGroupUserPermission(
        userId,
        dto.groupId
      );

      if (!info.isMember) {
        throw new RpcException('User is not a member of the group');
      }

      if (
        info.requireApproval === false ||
        info.permissions.includes(GroupPermission.APPROVE_POST)
      ) {
        post.postGroupInfo.status = PostGroupStatus.PUBLISHED;
        await this.createOutboxEvent(manager, post);
      } else {
        post.postGroupInfo.status = PostGroupStatus.PENDING;
      }

      if (info.privacy === GroupPrivacy.PRIVATE) {
        post.postGroupInfo.isPrivateGroup = true;
      }

      const entity = await manager.save(post);

      return PostShortenMapper.toPostSnapshotDTO(entity);
    });
  }

  async approvePost(userId: string, postId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const post = await manager.findOne(Post, {
        where: { id: postId },
        relations: ['postGroupInfo'],
      });
      if (!post || !post.postGroupInfo)
        throw new RpcException('Post not found');

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
        await this.createOutboxEvent(manager, post);
      }
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
}
