import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  Audience,
  CursorPageResponse,
  GetGroupPostQueryDTO,
  GetPostQueryDTO,
  GroupPermission,
  GroupPrivacy,
  PostGroupStatus,
  PostResponseDTO,
  PostSnapshotDTO,
  ReactionType,
  TargetType,
} from '@repo/dtos';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
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
    if (!post || post.isDeleted) throw new RpcException('Post not found');

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
  ): Promise<CursorPageResponse<PostSnapshotDTO>> {
    const qb = this.buildPostQuery(query)
      .where('p.userId = :userId', { userId: currentUserId })
      .andWhere('p.groupId IS NULL');

    const ids = await qb
      .select(['p.id', 'p.createdAt', 'p.isDeleted'])
      .getMany();
    if (ids.length === 0) return new CursorPageResponse([], null, false);

    const hasNextPage = ids.length > query.limit;
    if (hasNextPage) ids.pop(); // bỏ bản ghi dư ra
    const postIds = ids.map((p) => p.id);

    const posts = await this.postCache.getPostsBatch(postIds);
    if (!posts.length) return new CursorPageResponse([], null, false);

    return this.buildPagedPostResponse(currentUserId, posts, hasNextPage);
  }

  // ----------------------------------------
  // 🌍 2️⃣ Bài viết của người khác (tuỳ quan hệ)
  // ----------------------------------------
  async getUserPosts(
    userId: string,
    currentUserId: string,
    query: GetPostQueryDTO
  ): Promise<CursorPageResponse<PostSnapshotDTO>> {
    const relation = await this.postCache.getRelationship(
      currentUserId,
      userId,
      async () => {
        return await lastValueFrom(
          this.socialClient.send('get_relationship_status', {
            userId: currentUserId,
            targetId: userId,
          })
        );
      }
    );

    const qb = this.buildPostQuery(query)
      .where('p.userId = :userId', { userId })
      .andWhere('p.groupId IS NULL');

    if (userId === currentUserId) {
      // chính mình → xem hết
    } else if (['BLOCKED', 'BLOCKED_BY'].includes(relation)) {
      return new CursorPageResponse([], null, false);
    } else if (relation === 'FRIENDS') {
      qb.andWhere('p.audience IN (:...audiences)', {
        audiences: [Audience.PUBLIC, Audience.FRIENDS],
      });
    } else {
      qb.andWhere('p.audience = :audience', { audience: Audience.PUBLIC });
    }

    const ids = await qb
      .select(['p.id', 'p.createdAt', 'p.isDeleted'])
      .getMany();
    if (ids.length === 0) return new CursorPageResponse([], null, false);

    const hasNextPage = ids.length > query.limit;
    if (hasNextPage) ids.pop();
    const postIds = ids.map((p) => p.id);

    const posts = await this.postCache.getPostsBatch(postIds);
    if (!posts.length) return new CursorPageResponse([], null, false);
    return this.buildPagedPostResponse(currentUserId, posts, hasNextPage);
  }

  // ----------------------------------------
  // Get group posts
  // ----------------------------------------
  async getGroupPost(
    groupId: string,
    userId: string,
    query: GetGroupPostQueryDTO
  ): Promise<CursorPageResponse<PostSnapshotDTO>> {
    const memberInfo = await this.postCache.getGroupUserPermission(
      userId,
      groupId
    );
    const status = query.status || PostGroupStatus.PUBLISHED;

    // Nếu là bài đã duyệt
    if (status === PostGroupStatus.PUBLISHED) {
      if (memberInfo.privacy === GroupPrivacy.PRIVATE && !memberInfo.isMember) {
        throw new RpcException('User is not a member of the group');
      }
    } else {
      const canReview = memberInfo.permissions.includes(
        GroupPermission.APPROVE_POST
      );
      if (!canReview) {
        throw new RpcException('No permission to view pending/rejected posts');
      }
    }

    const qb = this.buildPostQuery(query)
      .innerJoin('p.postGroupInfo', 'pgi')
      .where('p.groupId = :groupId', { groupId })
      .andWhere('pgi.status = :status', { status });

    const ids = await qb
      .select(['p.id', 'p.createdAt', 'p.isDeleted'])
      .getMany();
    if (ids.length === 0) return new CursorPageResponse([], null, false);

    const hasNextPage = ids.length > query.limit;
    if (hasNextPage) ids.pop();
    const postIds = ids.map((p) => p.id);

    const posts = await this.postCache.getPostsBatch(postIds);
    if (!posts.length) return new CursorPageResponse([], null, false);

    return this.buildPagedPostResponse(userId, posts, hasNextPage);
  }

  // ----------------------------------------
  // ⚙️ Helpers chung
  // ----------------------------------------
  private buildPostQuery(query: GetPostQueryDTO) {
    const { cursor, limit, feeling, mainEmotion } = query;
    const qb = this.postRepo
      .createQueryBuilder('p')
      .where('p.isDeleted = false')
      .orderBy('p.createdAt', 'DESC')
      .take(limit + 1); // lấy dư 1 record để xác định hasNextPage

    if (cursor) {
      qb.andWhere('p.createdAt < :cursor', { cursor });
    }

    if (feeling) qb.andWhere('p.feeling = :feeling', { feeling });
    if (mainEmotion)
      qb.andWhere('p.mainEmotion = :mainEmotion', { mainEmotion });
    return qb;
  }

  private async buildPagedPostResponse(
    currentUserId: string,
    posts: Post[],
    hasNextPage: boolean
  ): Promise<CursorPageResponse<PostSnapshotDTO>> {
    const postIds = posts.map((p) => p.id);
    const reactionMap = await this.getReactedTypesBatch(currentUserId, postIds);
    const postDTOs = PostShortenMapper.toPostSnapshotDTOs(posts, reactionMap);

    let nextCursor: string | null = null;
    if (hasNextPage && posts.length > 0) {
      const lastPost = posts[posts.length - 1];
      const createdAt =
        lastPost.createdAt instanceof Date
          ? lastPost.createdAt
          : new Date(lastPost.createdAt);

      nextCursor = createdAt.toISOString();
    }

    return new CursorPageResponse(postDTOs, nextCursor, hasNextPage);
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
        return await lastValueFrom(
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
