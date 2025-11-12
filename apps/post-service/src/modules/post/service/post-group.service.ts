import { Inject, Injectable } from '@nestjs/common';
import {
  CreatePostDTO,
  EventDestination,
  EventTopic,
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
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { OutboxEvent } from 'src/entities/outbox.entity';

@Injectable()
export class PostGroupService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject('GROUP_SERVICE')
    private readonly groupClient: ClientProxy
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

      console.log('groupId', dto.groupId);

      // Nếu không phải bài private thì emit event
      const checkInfo = await lastValueFrom(
        this.groupClient.send('check_before_create_post', {
          groupId: dto.groupId,
          userId,
        })
      );

      if (checkInfo.canPost) {
        post.postGroupInfo.status = PostGroupStatus.PUBLISHED;
        await this.createOutboxEvent(manager, post);
      } else {
        post.postGroupInfo.status = PostGroupStatus.PENDING;
      }

      if (checkInfo.groupPrivacy === GroupPrivacy.PRIVATE) {
        post.postGroupInfo.isPrivateGroup = true;
      }

      const entity = await manager.save(post);

      return PostShortenMapper.toPostSnapshotDTO(entity);
    });
  }

  async approvePost(postId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const post = await manager.findOne(Post, {
        where: { id: postId },
        relations: ['postGroupInfo'],
      });
      if (!post || !post.postGroupInfo)
        throw new RpcException('Post not found');
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
