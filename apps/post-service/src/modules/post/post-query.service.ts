import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Post } from 'src/entities/post.entity';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  GetPostQueryDTO,
  PageResponse,
  PostResponseDTO,
  PostStatus,
} from '@repo/dtos';
import { RpcException } from '@nestjs/microservices';
import { UserService } from '../user/user.service';

@Injectable()
export class PostQueryService {
  constructor(
    @InjectRepository(Post) private postRepo: Repository<Post>,
    private readonly userService: UserService
  ) {}

  async findById(postId: string): Promise<PostResponseDTO> {
    const post = await this.postRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.postStat', 'stat')
      .where('p.id = :postId', { postId })
      .getOne();

    if (!post) throw new RpcException('Post not found');

    const users = await this.userService.getUsersBatch([post.userId]);
    const dto = plainToInstance(PostResponseDTO, post, {
      excludeExtraneousValues: true,
    });
    dto.user = users[post.userId];
    return dto;
  }

  async findByUserId(
    userId: string,
    query: GetPostQueryDTO,
    currentUserId: string
  ): Promise<PageResponse<PostResponseDTO>> {
    const { page, limit, status, feeling } = query;
    const isOwner = userId === currentUserId;

    const qb = this.postRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.postStat', 'stat')
      .where('p.userId = :userId', { userId })
      .orderBy('p.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (isOwner) {
      if (status) qb.andWhere('p.status = :status', { status });
    } else {
      qb.andWhere('p.status = :status', { status: PostStatus.ACTIVE });
    }

    if (feeling) qb.andWhere('p.feeling = :feeling', { feeling });

    const [posts, total] = await qb.getManyAndCount();

    const userIds = [...new Set(posts.map((p) => p.userId))];
    const users = await this.userService.getUsersBatch(userIds);

    const postDTOs = posts.map((post) => {
      const dto = plainToInstance(PostResponseDTO, post, {
        excludeExtraneousValues: true,
      });
      dto.user = users[post.userId];
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

    const userIds = [...new Set(posts.map((p) => p.userId))];
    const users = await this.userService.getUsersBatch(userIds);

    return posts.map((post) => {
      const dto = plainToInstance(PostResponseDTO, post, {
        excludeExtraneousValues: true,
      });
      dto.user = users[post.userId];
      return dto;
    });
  }
}
