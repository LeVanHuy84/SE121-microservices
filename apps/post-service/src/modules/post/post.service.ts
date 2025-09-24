import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Post } from 'src/entities/post.entity';
import { Repository } from 'typeorm';
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

@Injectable()
export class PostService {
  constructor(
    @InjectRepository(Post) private postRepo: Repository<Post>,
    @InjectRepository(PostStat) private postStatRepo: Repository<PostStat>
  ) {}

  async createPost(
    userId: string,
    dto: CreatePostDTO
  ): Promise<PostResponseDTO> {
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

  async getPostById(postId: string): Promise<PostResponseDTO> {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post) {
      throw new RpcException('Post not found with id: ' + postId);
    }
    return plainToInstance(PostResponseDTO, post, {
      excludeExtraneousValues: true,
    });
  }

  async getPostsByUser(
    userId: string,
    query: GetPostQueryDTO,
    currentUserId: string
  ): Promise<PageResponse<PostResponseDTO>> {
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

    const postDTOs = plainToInstance(PostResponseDTO, posts, {
      excludeExtraneousValues: true,
    });

    return new PageResponse(postDTOs, total, page, limit);
  }

  async updatePost(
    userId: string,
    postId: string,
    dto: Partial<CreatePostDTO>
  ): Promise<PostResponseDTO> {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post) {
      throw new RpcException('Post not found with id: ' + postId);
    }
    if (post.userId !== userId) {
      throw new RpcException('You are not authorized to update this post');
    }

    Object.assign(post, dto);
    const updatedPost = await this.postRepo.save(post);
    return plainToInstance(PostResponseDTO, updatedPost, {
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
