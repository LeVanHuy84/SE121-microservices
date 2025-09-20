import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreatePostDto, PostResponseDTO } from '@repo/dtos';
import { Post } from 'src/entities/post.entity';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class PostService {
    constructor(@InjectRepository(Post) private postRepo: Repository<Post>) { }

    async createPost(userId: string, dto: CreatePostDto): Promise<PostResponseDTO> {
        const post = await this.postRepo.create({
            ...dto,
            userId,
            stats: { reactions: 0, comments: 0, shares: 0 },
        });
        const entity = await this.postRepo.save(post);
        return plainToInstance(PostResponseDTO, entity);
    }
}
