import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreatePostDto } from '@repo/dtos';
import { PostService } from './post.service';

@Controller('posts')
export class PostController {
    constructor(private postService: PostService) { }

    @MessagePattern('get_posts')
    getAll() {
        return 'all posts';
    }

    @MessagePattern('create_post')
    async createPost(@Payload() payload: { userId: string, createPostDto: CreatePostDto }) {
        return this.postService.createPost(payload.userId, payload.createPostDto);
    }

}
