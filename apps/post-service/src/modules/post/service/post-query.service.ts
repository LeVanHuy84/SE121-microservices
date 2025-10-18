import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  Audience,
  GetPostQueryDTO,
  PageResponse,
  PostResponseDTO,
  PostSnapshotDTO,
  ReactionType,
  TargetType,
} from '@repo/dtos';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { Reaction } from 'src/entities/reaction.entity';
import { Post } from 'src/entities/post.entity';
import { PostCacheService } from './post-cache.service';
import { PostShortenMapper } from '../post-shorten.mapper';

@Injectable()
export class PostQueryService {
  constructor(
    @InjectRepository(Post) private readonly postRepo: Repository<Post>,
    @InjectRepository(Reaction)
    private readonly reactionRepo: Repository<Reaction>,
    @Inject('SOCIAL_SERVICE') private readonly socialClient: ClientProxy,
    private readonly postCache: PostCacheService
  ) {}

  // ----------------------------------------
  // 🔍 Lấy post theo ID
  // ----------------------------------------
  async findById(
    userRequestId: string,
    postId: string
  ): Promise<PostResponseDTO> {
    const post = await this.postCache.getPost(postId);
    if (!post) throw new RpcException('Post not found');

    const [_, userReaction] = await Promise.all([
      this.ensureCanView(userRequestId, post),
      this.reactionRepo.findOne({
        where: {
          userId: userRequestId,
          targetType: TargetType.POST,
          targetId: postId,
        },
        select: ['reactionType'],
      }),
    ]);

    const dto = plainToInstance(PostResponseDTO, post, {
      excludeExtraneousValues: true,
    });
    dto.reactedType = userReaction?.reactionType;
    return dto;
  }

  // ----------------------------------------
  // 🧍‍♂️ 1️⃣ Bài viết của chính mình
  // ----------------------------------------
  async getMyPosts(
    currentUserId: string,
    query: GetPostQueryDTO
  ): Promise<PageResponse<PostSnapshotDTO>> {
    const qb = this.buildPostQuery(query).where('p.userId = :userId', {
      userId: currentUserId,
    });

    const [ids, total] = await qb.select('p.id').getManyAndCount();
    const postIds = ids.map((p) => p.id);

    const posts = await this.postCache.getPostsBatch(postIds);
    if (!posts.length)
      return new PageResponse([], total, query.page, query.limit);

    return this.buildPagedPostResponse(currentUserId, posts, total, query);
  }

  // ----------------------------------------
  // 🌍 2️⃣ Bài viết của người khác (tuỳ quan hệ)
  // ----------------------------------------
  async getUserPosts(
    userId: string,
    currentUserId: string,
    query: GetPostQueryDTO
  ): Promise<PageResponse<PostSnapshotDTO>> {
    const relation = await this.postCache.getRelationship(
      currentUserId,
      userId,
      async () => {
        return await firstValueFrom(
          this.socialClient.send('get_relationship_status', {
            userId: currentUserId,
            targetId: userId,
          })
        );
      }
    );

    const qb = this.buildPostQuery(query).where('p.userId = :userId', {
      userId,
    });

    if (userId === currentUserId) {
      // chính mình → xem hết
    } else if (['BLOCKED', 'BLOCKED_BY'].includes(relation)) {
      return new PageResponse([], 0, query.page, query.limit);
    } else if (relation === 'FRIENDS') {
      qb.andWhere('p.audience IN (:...audiences)', {
        audiences: [Audience.PUBLIC, Audience.FRIENDS],
      });
    } else {
      qb.andWhere('p.audience = :audience', { audience: Audience.PUBLIC });
    }

    const [ids, total] = await qb.select('p.id').getManyAndCount();
    const postIds = ids.map((p) => p.id);

    const posts = await this.postCache.getPostsBatch(postIds);
    if (!posts.length)
      return new PageResponse([], total, query.page, query.limit);

    return this.buildPagedPostResponse(currentUserId, posts, total, query);
  }

  // ----------------------------------------
  // ⚙️ Helpers chung
  // ----------------------------------------
  private buildPostQuery(query: GetPostQueryDTO) {
    const { page, limit, feeling } = query;
    const qb = this.postRepo
      .createQueryBuilder('p')
      .orderBy('p.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (feeling) qb.andWhere('p.feeling = :feeling', { feeling });
    return qb;
  }

  private async buildPagedPostResponse(
    currentUserId: string,
    posts: Post[],
    total: number,
    query: GetPostQueryDTO
  ): Promise<PageResponse<PostSnapshotDTO>> {
    const postIds = posts.map((p) => p.id);
    const reactionMap = await this.getReactedTypesBatch(currentUserId, postIds);

    const postDTOs = PostShortenMapper.toPostSnapshotDTOs(posts, reactionMap);
    return new PageResponse(postDTOs, total, query.page, query.limit);
  }

  private async getReactedTypesBatch(
    userId: string,
    postIds: string[]
  ): Promise<Map<string, ReactionType>> {
    if (!postIds.length) return new Map();
    const reactions = await this.reactionRepo.find({
      where: { userId, targetId: In(postIds), targetType: TargetType.POST },
    });
    return new Map(reactions.map((r) => [r.targetId, r.reactionType]));
  }

  private async ensureCanView(userId: string, post: Post): Promise<void> {
    if (post.userId === userId) return;

    const relation = await this.postCache.getRelationship(
      userId,
      post.userId,
      async () => {
        return await firstValueFrom(
          this.socialClient.send('get_relationship_status', {
            userId,
            targetId: post.userId,
          })
        );
      }
    );

    if (['BLOCKED', 'BLOCKED_BY'].includes(relation))
      throw new RpcException('Forbidden: You are blocked');

    if (post.audience === Audience.ONLY_ME)
      throw new RpcException('Forbidden: Private post');

    if (post.audience === Audience.FRIENDS && relation !== 'FRIENDS')
      throw new RpcException('Forbidden: Friends only');
  }
}
