import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { EditHistory } from 'src/entities/edit-history.entity';
import { PostStat } from 'src/entities/post-stat.entity';
import { Post } from 'src/entities/post.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { DataSource, Repository } from 'typeorm';
import {
  Audience,
  CreatePostDTO,
  EventTopic,
  PostEventType,
  RootType,
  TargetType,
  UpdatePostDTO,
} from '@repo/dtos';
import { Reaction } from 'src/entities/reaction.entity';

@Injectable()
export class PostCommandService {
  constructor(
    @InjectRepository(Post) private readonly postRepo: Repository<Post>,
    private readonly dataSource: DataSource
  ) {}

  async create(userId: string, dto: CreatePostDTO): Promise<Post> {
    return this.dataSource.transaction(async (manager) => {
      const post = manager.create(Post, {
        ...dto,
        userId,
        postStat: manager.create(PostStat),
      });
      const entity = await manager.save(post);

      // nếu không phải bài private thì emit event
      if (dto.audience !== Audience.ONLY_ME) {
        const outbox = manager.create(OutboxEvent, {
          topic: EventTopic.POST,
          eventType: PostEventType.CREATED,
          payload: {
            postId: entity.id,
            userId: entity.userId,
            groupId: entity.groupId ?? undefined,
            content: entity.content,
            mediaPreviews: post.media?.slice(0, 5),
            mediaRemaining: Math.max(0, (post.media?.length ?? 0) - 5),
            createdAt: entity.createdAt,
          },
        });
        await manager.save(outbox);
      }

      return entity;
    });
  }

  async update(
    userId: string,
    postId: string,
    dto: Partial<UpdatePostDTO>
  ): Promise<Post> {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post) throw new RpcException('Post not found');
    if (post.userId !== userId) throw new RpcException('Unauthorized');

    return this.dataSource.transaction(async (manager) => {
      if (dto.content && dto.content !== post.content) {
        const history = manager.create(EditHistory, {
          oldContent: post.content,
          post,
        });
        await manager.save(history);
      }

      Object.assign(post, dto);
      const updated = await manager.save(post);

      // Nếu bài chuyển về ONLY_ME → có thể outbox gửi REMOVE event
      if (dto.audience === Audience.ONLY_ME) {
        const outbox = manager.create(OutboxEvent, {
          topic: EventTopic.POST,
          eventType: PostEventType.REMOVED,
          payload: { postId },
        });
        await manager.save(outbox);
      } else {
        const outbox = manager.create(OutboxEvent, {
          topic: EventTopic.POST,
          eventType: PostEventType.UPDATED,
          payload: {
            postId,
            content: dto.content,
          },
        });
        await manager.save(outbox);
      }

      return updated;
    });
  }

  async remove(userId: string, postId: string): Promise<void> {
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

      const outbox = manager.create(OutboxEvent, {
        topic: EventTopic.POST,
        eventType: PostEventType.REMOVED,
        payload: { postId },
      });

      await manager.save(outbox);
    });
  }
}
