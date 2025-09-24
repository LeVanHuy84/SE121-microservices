import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Post } from 'src/entities/post.entity';
import { FindOptionsWhere, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  CreatePostDto,
  GetPostQueryDto,
  PageResponse,
  PostResponseDto,
  PostStatus,
} from '@repo/dtos';
import { RpcException } from '@nestjs/microservices';
import { PostStat } from 'src/entities/post-stat.entity';

@Injectable()
export class PostService {
  constructor(
    @InjectRepository(Post) private postRepo: Repository<Post>,
    @InjectRepository(PostStat) private postStatRepo: Repository<PostStat>
  ) {}

  async createPost(
    userId: string,
    dto: CreatePostDto
  ): Promise<PostResponseDto> {
    const post = this.postRepo.create({
      ...dto,
      userId,
      postStat: this.postStatRepo.create(),
    });
    const entity = await this.postRepo.save(post);
    return plainToInstance(PostResponseDto, entity, {
      excludeExtraneousValues: true,
    });
  }

  async getPostById(postId: string): Promise<PostResponseDto> {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post) {
      throw new RpcException('Post not found with id: ' + postId);
    }
    return plainToInstance(PostResponseDto, post, {
      excludeExtraneousValues: true,
    });
  }

  async getPostsByUser(
    userId: string,
    query: GetPostQueryDto,
    currentUserId: string
  ): Promise<PageResponse<PostResponseDto>> {
    const { page, limit, status, feeling } = query;

    const isOwner = userId === currentUserId;

    const qb = this.postRepo
      .createQueryBuilder('p')
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

    const postDtos = plainToInstance(PostResponseDto, posts, {
      excludeExtraneousValues: true,
    });

    return new PageResponse(postDtos, total, page, limit);
  }

  async updatePost(
    userId: string,
    postId: string,
    dto: Partial<CreatePostDto>
  ): Promise<PostResponseDto> {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post) {
      throw new RpcException('Post not found with id: ' + postId);
    }
    if (post.userId !== userId) {
      throw new RpcException('You are not authorized to update this post');
    }

    Object.assign(post, dto);
    const updatedPost = await this.postRepo.save(post);
    return plainToInstance(PostResponseDto, updatedPost, {
      excludeExtraneousValues: true,
    });
  }

  async updatePostStatus(userId: string, postId: string) {
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

  async deletePost(postId: string, userId: string) {
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
}
