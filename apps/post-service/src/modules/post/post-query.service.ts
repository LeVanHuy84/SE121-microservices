import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Post } from 'src/entities/post.entity';
import { In, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  GetPostQueryDTO,
  PageResponse,
  PostResponseDTO,
  ReactionType,
  TargetType,
} from '@repo/dtos';
import { RpcException } from '@nestjs/microservices';
import { Reaction } from 'src/entities/reaction.entity';

@Injectable()
export class PostQueryService {
  constructor(
    @InjectRepository(Post) private postRepo: Repository<Post>,
    @InjectRepository(Reaction)
    private readonly reactionRepo: Repository<Reaction>
  ) {}

  async findById(
    userRequestId: string,
    postId: string
  ): Promise<PostResponseDTO> {
    const post = await this.postRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.postStat', 'stat')
      .where('p.id = :postId', { postId })
      .getOne();

    if (!post) throw new RpcException('Post not found');

    const userReaction = await this.reactionRepo.findOne({
      where: {
        userId: userRequestId,
        targetType: TargetType.POST,
        targetId: postId,
      },
      select: ['reactionType'],
    });

    const dto = plainToInstance(PostResponseDTO, post, {
      excludeExtraneousValues: true,
    });
    dto.reactedType = userReaction?.reactionType ?? undefined;
    return dto;
  }

  async getMyPosts(
    currentUserId: string,
    query: GetPostQueryDTO
  ): Promise<PageResponse<PostResponseDTO>> {
    const { page, limit, feeling } = query;

    const qb = this.postRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.postStat', 'stat')
      .where('p.userId = :userId', { userId: currentUserId })
      .orderBy('p.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (feeling) qb.andWhere('p.feeling = :feeling', { feeling });

    const [posts, total] = await qb.getManyAndCount();
    if (!posts.length) return new PageResponse([], total, page, limit);

    const postIds = posts.map((p) => p.id);
    const reactions = await this.reactionRepo.find({
      where: {
        userId: currentUserId,
        targetType: TargetType.POST,
        targetId: In(postIds),
      },
      select: ['targetId', 'reactionType'],
    });

    const reactionMap = new Map(
      reactions.map((r) => [r.targetId, r.reactionType])
    );

    const postDTOs = posts.map((post) => this.mapToPostDTO(post, reactionMap));

    return new PageResponse(postDTOs, total, page, limit);
  }

  // ----------------------------------------
  // 👀 2️⃣ Lấy post của người dùng khác (public)
  // ----------------------------------------
  async getUserPosts(
    userId: string,
    currentUserId: string,
    query: GetPostQueryDTO
  ): Promise<PageResponse<PostResponseDTO>> {
    const { page, limit, feeling } = query;

    const qb = this.postRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.postStat', 'stat')
      .where('p.userId = :userId', { userId })
      .orderBy('p.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (feeling) qb.andWhere('p.feeling = :feeling', { feeling });

    const [posts, total] = await qb.getManyAndCount();
    if (!posts.length) return new PageResponse([], total, page, limit);

    const postIds = posts.map((p) => p.id);
    const reactions = await this.reactionRepo.find({
      where: {
        userId: currentUserId,
        targetType: TargetType.POST,
        targetId: In(postIds),
      },
      select: ['targetId', 'reactionType'],
    });

    const reactionMap = new Map(
      reactions.map((r) => [r.targetId, r.reactionType])
    );

    const postDTOs = posts.map((post) => {
      const dto = plainToInstance(PostResponseDTO, post, {
        excludeExtraneousValues: true,
      });
      dto.reactedType = reactionMap.get(post.id);
      return dto;
    });

    return new PageResponse(postDTOs, total, page, limit);
  }

  async getPostsBatch(ids: string[]): Promise<PostResponseDTO[]> {
    if (!ids.length) return [];

    const posts = await this.postRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.postStat', 'stat')
      .where('p.id IN (:...ids)', { ids })
      .getMany();

    return posts.map((post) =>
      plainToInstance(PostResponseDTO, post, {
        excludeExtraneousValues: true,
      })
    );
  }

  private mapToPostDTO(
    post: Post,
    reactionMap: Map<string, ReactionType | undefined>
  ): PostResponseDTO {
    return {
      id: post.id,
      userId: post.userId,
      groupId: post.groupId,
      feeling: post.feeling,
      content: post.content,
      media: post.media,
      audience: post.audience,
      postStat: post.postStat,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      reactedType: reactionMap.get(post.id),
    };
  }
}
