import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PostSnapshot } from 'src/mongo/schema/post-snapshot.schema';
import { TrendingQuery } from '@repo/dtos';

@Injectable()
export class TrendingService {
  private readonly logger = new Logger(TrendingService.name);
  private readonly GLOBAL_TRENDING_KEY = 'trending:posts';

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectModel(PostSnapshot.name)
    private readonly postModel: Model<PostSnapshot>,
  ) {}

  async getTrendingPosts(query: TrendingQuery): Promise<PostSnapshot[]> {
    const { page, limit, mainEmotion } = query;
    const key = mainEmotion
      ? `trending:emotion:${mainEmotion}`
      : this.GLOBAL_TRENDING_KEY;

    const start = (page - 1) * limit;
    const end = start + limit - 1;

    const total = await this.redis.llen(key);
    if (total === 0) return [];

    // Lấy danh sách postId trong range
    const postIds = await this.redis.lrange(key, start, end);
    if (postIds.length === 0) return [];

    // Lấy dữ liệu bài viết từ MongoDB
    const posts = await this.postModel
      .find({ postId: { $in: postIds } })
      .lean()
      .exec();

    // Giữ đúng thứ tự theo Redis (vì Mongo không đảm bảo thứ tự)
    const ordered = postIds
      .map((id) => posts.find((p) => p.postId === id))
      .filter(Boolean) as unknown as PostSnapshot[];

    this.logger.log(
      `📊 Fetch trending posts: page=${page}, limit=${limit}, emotion=${mainEmotion ?? 'all'}, found=${ordered.length}`,
    );

    return ordered;
  }
}
