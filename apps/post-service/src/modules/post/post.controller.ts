import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { CreatePostDto } from '@repo/dtos';
import { PostService } from './post.service';

@Controller('posts')
export class PostController {
    constructor(private postService: PostService) { }

    @MessagePattern('create_post')
    createUser(dto: CreatePostDto) {
        return this.postService.createPost(dto);
    }
}
