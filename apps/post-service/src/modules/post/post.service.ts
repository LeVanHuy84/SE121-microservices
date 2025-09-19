import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreatePostDto } from '@repo/dtos';
import { Post } from 'src/entities/post.entity';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class PostService {
    constructor(@InjectRepository(Post) private postRepo: Repository<Post>) { }

    async createPost(dto: CreatePostDto) {
        const post = plainToInstance(Post, dto);
        return await this.postRepo.save(post);
    }
}
