import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Post } from 'src/entities/post.entity';
import { DataSource, Repository } from 'typeorm';
import { DataSource, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  CreatePostDTO,
  GetPostQueryDTO,
  PageResponse,
  PostResponseDTO,
  PostStatus,
} from '@repo/dtos';
import { RpcException } from '@nestjs/microservices';
import { PostStat } from 'src/entities/post-stat.entity';
import { EditHistory } from 'src/entities/edit-history.entity';
import { UserService } from '../user/user.service';

@Injectable()
export class PostService {
  constructor(
    @InjectRepository(Post) private postRepo: Repository<Post>,
    @InjectRepository(PostStat) private postStatRepo: Repository<PostStat>,
    private readonly dataSource: DataSource,
    private readonly userService: UserService
  ) {}

  async create(userId: string, dto: CreatePostDTO): Promise<PostResponseDTO> {
    const post = this.postRepo.create({
      ...dto,
      userId,
      postStat: this.postStatRepo.create(),
    });
    const entity = await this.postRepo.save(post);
    return plainToInstance(PostResponseDTO, entity, {
      excludeExtraneousValues: true,
    });
  }

  async findById(postId: string): Promise<PostResponseDTO> {
    const post = await this.postRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.postStat', 'stat')
      .where('p.id = :postId', { postId })
      .getOne();

    if (!post) {
      throw new RpcException('Post not found');
    }

    const users = await this.userService.getUsersBatch([post.userId]);

    const response = plainToInstance(PostResponseDTO, post, {
      excludeExtraneousValues: true,
    });
    response.user = users[post.userId];

    return response;
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
      if (status) {
        qb.andWhere('p.status = :status', { status });
      }
    } else {
      qb.andWhere('p.status = :status', { status: PostStatus.ACTIVE });
    }

    if (feeling) {
      qb.andWhere('p.feeling = :feeling', { feeling });
    }

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

  async update(
    userId: string,
    postId: string,
    dto: Partial<CreatePostDTO>
  ): Promise<PostResponseDTO> {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post) throw new RpcException('Post not found with id: ' + postId);
    if (post.userId !== userId)
      throw new RpcException('You are not authorized to update this post');

    return await this.dataSource.transaction(async (manager) => {
      if (dto.content && dto.content !== post.content) {
        const history = manager.create(EditHistory, {
          oldContent: post.content,
          post,
        });
        await manager.save(history);
      }

      Object.assign(post, dto);
      const updatedPost = await manager.save(post);

      return plainToInstance(PostResponseDTO, updatedPost, {
        excludeExtraneousValues: true,
      });
    });
  }

  async updateStatus(userId: string, postId: string) {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post) {
      throw new RpcException('Post not found with id: ' + postId);
    }
    if (post.userId !== userId) {
      throw new RpcException('You are not authorized to update this post');
    }

    post.status =
      post.status === PostStatus.ACTIVE ? PostStatus.HIDDEN : PostStatus.ACTIVE;
  }

  async remove(postId: string, userId: string) {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post) {
      throw new RpcException('Post not found with id: ' + postId);
    }
    if (post.userId !== userId) {
      throw new RpcException('You are not authorized to delete this post');
    }
    await this.postRepo.remove(post);
    return 'Post deleted successfully';
  }

  async getEditHistories(
    userId: string,
    postId: string
  ): Promise<EditHistory[]> {
    const post = await this.postRepo.findOne({
      where: { id: postId },
      relations: ['editHistories'],
    });
    if (!post) {
      throw new RpcException('Post not found with id: ' + postId);
    }
    if (post.userId !== userId) {
      throw new RpcException(
        'You are not authorized to view edit histories of this post'
      );
    }
    return post.editHistories;
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
