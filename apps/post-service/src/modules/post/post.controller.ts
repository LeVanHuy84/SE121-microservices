import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PostService } from './post.service';
import { CreatePostDto, GetPostQueryDto, PaginationDto } from '@repo/dtos';

@Controller('posts')
export class PostController {
    constructor(private postService: PostService) { }

    @MessagePattern('create_post')
    async createPost(@Payload() payload: { userId: string, createPostDto: CreatePostDto }) {
        return this.postService.createPost(payload.userId, payload.createPostDto);
    }

    @MessagePattern('get_post_by_id')
    async getPostById(@Payload() postId: string) {
        return this.postService.getPostById(postId);
    }

    @MessagePattern('get_posts_by_user')
    async getPostsByUser(
        @Payload() payload: { userId: string; pagination: GetPostQueryDto; currentUserId: string },
    ) {
        return this.postService.getPostsByUser(
            payload.userId,
            payload.pagination,
            payload.currentUserId,
        );
    }

    @MessagePattern('update_post')
    async updatePost(
        @Payload() payload: { userId: string, postId: string; updatePostDto: any },
    ) {
        return this.postService.updatePost(
            payload.userId,
            payload.postId,
            payload.updatePostDto,
        );
    }

    @MessagePattern('update_post_status')
    async updatePostStatus(
        @Payload() payload: { userId: string, postId: string },
    ) {
        return this.postService.updatePostStatus(
            payload.userId,
            payload.postId,
        );
    }

    @MessagePattern('delete_post')
    async deletePost(@Payload() payload: { id: string, userId: string }) {
        return this.postService.deletePost(payload.id, payload.userId);
    }
}
