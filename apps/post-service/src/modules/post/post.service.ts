import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Post } from 'src/entities/post.entity';
import { FindOptionsWhere, Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { CreatePostDto, GetPostQueryDto, PageResponse, PaginationDto, PostResponseDTO, PostStatus } from '@repo/dtos';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class PostService {
    constructor(@InjectRepository(Post) private postRepo: Repository<Post>) { }

    async createPost(userId: string, dto: CreatePostDto): Promise<PostResponseDTO> {
        const post = this.postRepo.create({
            ...dto,
            userId,
            stats: { reactions: 0, comments: 0, shares: 0 },
        });
        const entity = await this.postRepo.save(post);
        return plainToInstance(PostResponseDTO, entity);
    }

    async getPostById(postId: string): Promise<PostResponseDTO> {
        const post = await this.postRepo.findOneBy({ id: postId });
        if (!post) {
            throw new RpcException('Post not found with id: ' + postId);
        }
        return plainToInstance(PostResponseDTO, post);
    }

    async getPostsByUser(
        userId: string,
        query: GetPostQueryDto,
        currentUserId: string,
    ): Promise<PageResponse<PostResponseDTO>> {
        const { page, limit, status, feeling } = query;

        const isOwner = userId === currentUserId;

        let where: FindOptionsWhere<Post> = { userId };

        // Status filter
        if (isOwner) {
            if (status) {
                where = { ...where, status };
            }
        } else {
            where = { ...where, status: PostStatus.ACTIVE };
        }

        // Feeling filter
        if (feeling) {
            where = { ...where, feeling };
        }

        const [posts, total] = await this.postRepo.findAndCount({
            where,
            order: { createdAt: "DESC" },
            skip: (page - 1) * limit,
            take: limit,
        });

        const postDtos = plainToInstance(PostResponseDTO, posts, {
            excludeExtraneousValues: true,
        });

        return new PageResponse(postDtos, total, page, limit);
    }

    async updatePost(
        userId: string,
        postId: string,
        dto: Partial<CreatePostDto>,
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
        return plainToInstance(PostResponseDTO, updatedPost);
    }

    async updatePostStatus(
        userId: string,
        postId: string,
    ) {
        const post = await this.postRepo.findOneBy({ id: postId });
        if (!post) {
            throw new RpcException('Post not found with id: ' + postId);
        }
        if (post.userId !== userId) {
            throw new RpcException('You are not authorized to update this post');
        }

        post.status = post.status === PostStatus.ACTIVE ? PostStatus.HIDDEN : PostStatus.ACTIVE;
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
