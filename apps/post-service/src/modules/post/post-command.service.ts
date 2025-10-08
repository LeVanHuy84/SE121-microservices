import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Audience, CreatePostDTO, UpdatePostDTO } from '@repo/dtos';
import { EditHistory } from 'src/entities/edit-history.entity';
import { PostStat } from 'src/entities/post-stat.entity';
import { Post } from 'src/entities/post.entity';
import { DataSource, Repository } from 'typeorm';
import { PostEventPublisher } from './post-event.service';

@Injectable()
export class PostCommandService {
  constructor(
    @InjectRepository(Post) private postRepo: Repository<Post>,
    @InjectRepository(PostStat) private postStatRepo: Repository<PostStat>,
    private readonly dataSource: DataSource,
    private readonly eventPublisher: PostEventPublisher
  ) {}

  async create(userId: string, dto: CreatePostDTO): Promise<Post> {
    const post = this.postRepo.create({
      ...dto,
      userId,
      postStat: this.postStatRepo.create(),
    });
    const entity = await this.postRepo.save(post);

    if (dto.audience !== Audience.ONLY_ME)
      this.eventPublisher.postCreated(entity);

    return entity;
  }

  async update(
    userId: string,
    postId: string,
    dto: Partial<UpdatePostDTO>
  ): Promise<Post> {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post) throw new RpcException('Post not found');
    if (post.userId !== userId) throw new RpcException('Unauthorized');

    return await this.dataSource.transaction(async (manager) => {
      if (dto.content && dto.content !== post.content) {
        const history = manager.create(EditHistory, {
          oldContent: post.content,
          post,
        });
        await manager.save(history);
      }
      Object.assign(post, dto);

      if (dto.audience === Audience.ONLY_ME) {
        this.eventPublisher.removeFeed(postId);
      }

      return await manager.save(post);
    });
  }

  async remove(userId: string, postId: string): Promise<void> {
    const post = await this.postRepo.findOneBy({ id: postId });
    if (!post) throw new RpcException('Post not found');
    if (post.userId !== userId) throw new RpcException('Unauthorized');

    await this.postRepo.remove(post);
    this.eventPublisher.removeFeed(postId);
  }
}
