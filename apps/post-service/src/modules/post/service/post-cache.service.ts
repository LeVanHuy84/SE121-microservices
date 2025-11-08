import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { Post } from 'src/entities/post.entity';
import { PostStat } from 'src/entities/post-stat.entity';

@Injectable()
export class PostCacheService {
  private readonly POST_TTL = 3600;
  private readonly POST_STAT_TTL = 3;
  private readonly RELATION_TTL = 300;

  constructor(
    @InjectRepository(Post) private readonly postRepo: Repository<Post>,
    @InjectRepository(PostStat)
    private readonly postStatRepo: Repository<PostStat>,
    @InjectRedis() private readonly redis: Redis
  ) {}

  // ----------------------------------------
  // 🧩 Cache Post
  // ----------------------------------------
  async getPost(postId: string): Promise<Post | null> {
    const cached = await this.redis.get(`post:${postId}`);

    if (cached) {
      const post = JSON.parse(cached) as Post;
      await this.redis.expire(`post:${postId}`, this.POST_TTL);

      const stat = await this.getStat(postId);
      if (stat) post.postStat = stat;
      return post;
    }

    const post = await this.postRepo.findOne({
      where: { id: postId },
      relations: ['postStat'],
    });

    if (!post) return null;

    const { postStat, ...postData } = post;
    const pipeline = this.redis.pipeline();

    pipeline.setex(`post:${post.id}`, this.POST_TTL, JSON.stringify(postData));
    if (postStat)
      pipeline.setex(
        `post:${post.id}:stat`,
        this.POST_STAT_TTL,
        JSON.stringify(postStat)
      );

    await pipeline.exec();

    return post;
  }

  async getPostsBatch(postIds: string[]): Promise<Post[]> {
    if (!postIds.length) return [];

    const keys = postIds.map((id) => `post:${id}`);
    const cachedValues = await this.redis.mget(...keys);

    const posts: Post[] = [];
    const missingIds: string[] = [];

    cachedValues.forEach((cached, i) => {
      if (cached) {
        const post = JSON.parse(cached) as Post;
        posts.push(post);
      } else {
        missingIds.push(postIds[i]);
      }
    });

    if (missingIds.length > 0) {
      const dbPosts = await this.postRepo.find({
        where: { id: In(missingIds) },
        relations: ['postStat'],
      });

      const pipeline = this.redis.pipeline();
      for (const post of dbPosts) {
        const { postStat, ...postData } = post;
        pipeline.setex(
          `post:${post.id}`,
          this.POST_TTL,
          JSON.stringify(postData)
        );
        if (postStat)
          pipeline.setex(
            `post:${post.id}:stat`,
            this.POST_STAT_TTL,
            JSON.stringify(postStat)
          );
      }
      await pipeline.exec();

      posts.push(...dbPosts);
    }

    const statMap = await this.getStatsBatch(postIds);
    for (const post of posts) {
      const stat = statMap.get(post.id);
      if (stat) post.postStat = stat;
    }

    return posts;
  }

  // ----------------------------------------
  // 📊 Cache Stat
  // ----------------------------------------
  private async getStatsBatch(
    postIds: string[]
  ): Promise<Map<string, PostStat>> {
    if (!postIds.length) return new Map();

    const keys = postIds.map((id) => `post:${id}:stat`);
    const pipeline = this.redis.pipeline();
    keys.forEach((k) => pipeline.get(k));
    const results = (await pipeline.exec()) as [Error | null, string | null][];

    const stats = new Map<string, PostStat>();
    const missingIds: string[] = [];

    results.forEach(([err, cached], i) => {
      if (cached) stats.set(postIds[i], JSON.parse(cached) as PostStat);
      else missingIds.push(postIds[i]);
    });

    if (missingIds.length) {
      const dbStats = await this.postStatRepo.find({
        where: { postId: In(missingIds) },
      });
      const pipe = this.redis.pipeline();
      for (const s of dbStats) {
        stats.set(s.postId, s);
        pipe.setex(
          `post:${s.postId}:stat`,
          this.POST_STAT_TTL,
          JSON.stringify(s)
        );
      }
      await pipe.exec();
    }

    return stats;
  }

  private async getStat(postId: string): Promise<PostStat | null> {
    const cached = await this.redis.get(`post:${postId}:stat`);
    if (cached) return JSON.parse(cached);

    const stat = await this.postStatRepo.findOne({ where: { postId } });
    if (stat)
      await this.redis.setex(
        `post:${postId}:stat`,
        this.POST_STAT_TTL,
        JSON.stringify(stat)
      );
    return stat;
  }

  async removeCache(postId: string): Promise<void> {
    await this.redis
      .pipeline()
      .del(`post:${postId}`)
      .del(`post:${postId}:stat`)
      .exec();
  }

  // ----------------------------------------
  // 🧍‍♂️ Cache Relationship
  // ----------------------------------------
  async getRelationship(
    userId: string,
    targetId: string,
    fetchFn: () => Promise<string>
  ): Promise<string> {
    const key = `relationship:${userId}:${targetId}`;
    const cached = await this.redis.get(key);
    if (cached) return cached;

    const relation = await fetchFn();

    const pipeline = this.redis.pipeline();
    pipeline.setex(key, this.RELATION_TTL, relation);
    pipeline.setex(
      `relationship:${targetId}:${userId}`,
      this.RELATION_TTL,
      this.reverseRelation(relation)
    );
    await pipeline.exec();

    return relation;
  }

  private reverseRelation(relation: string): string {
    switch (relation) {
      case 'BLOCKED':
        return 'BLOCKED_BY';
      case 'BLOCKED_BY':
        return 'BLOCKED';
      default:
        return relation;
    }
  }
}
