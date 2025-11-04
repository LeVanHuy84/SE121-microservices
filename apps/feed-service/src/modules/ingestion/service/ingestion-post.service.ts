import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PostSnapshot,
  PostSnapshotDocument,
} from 'src/mongo/schema/post-snapshot.schema';
import {
  ShareSnapshot,
  ShareSnapshotDocument,
} from 'src/mongo/schema/share-snapshot.schema';
import { FeedEventType, InferPostPayload, PostEventType } from '@repo/dtos';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { DistributionService } from './distribution.service';

@Injectable()
export class IngestionPostService {
  private readonly META_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 ngày
  private readonly SCORE_TTL_SECONDS = 30 * 24 * 60 * 60;

  constructor(
    @InjectModel(PostSnapshot.name)
    private readonly postModel: Model<PostSnapshotDocument>,
    @InjectModel(ShareSnapshot.name)
    private readonly shareModel: Model<ShareSnapshotDocument>,
    private readonly distributionService: DistributionService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  // ------------------------------------------------
  // 🧩 HANDLE CREATED
  // ------------------------------------------------
  async handleCreated(payload: InferPostPayload<PostEventType.CREATED>) {
    if (!payload.postId) return;
    const exists = await this.postModel.findOne({ postId: payload.postId });
    if (exists) return;

    const createdAt = new Date(payload.createdAt);

    console.log('IngestionPostService handleCreated', payload);

    const entity = await this.postModel.create({
      ...payload,
      postCreatedAt: createdAt,
    });

    const metaKey = `post:meta:${payload.postId}`;
    await this.redis.hset(metaKey, 'createdAt', createdAt.getTime());
    await this.redis.expire(metaKey, this.META_TTL_SECONDS);

    await this.distributionService.distributeCreated(
      FeedEventType.POST,
      entity._id.toString(),
      entity.postId,
      entity.userId,
    );

    // Điểm khởi tạo ban đầu cho bài mới
    const INITIAL_TRENDING_SCORE = 8; // ~ tương đương 2 comment hoặc 1 share
    await this.redis.zadd('post:score', INITIAL_TRENDING_SCORE, payload.postId);
    await this.redis.expire('post:score', this.SCORE_TTL_SECONDS);
  }

  // ------------------------------------------------
  // 🧩 HANDLE UPDATED
  // ------------------------------------------------
  async handleUpdated(payload: InferPostPayload<PostEventType.UPDATED>) {
    if (!payload.postId) return;

    await this.postModel.updateOne(
      { postId: payload.postId },
      { $set: { content: payload.content } },
    );
  }

  // ------------------------------------------------
  // 🧩 HANDLE REMOVED
  // ------------------------------------------------
  async handleRemoved(payload: InferPostPayload<PostEventType.REMOVED>) {
    if (!('postId' in payload)) return;

    const snapshot = await this.postModel.findOneAndDelete({
      postId: payload.postId,
    });

    await this.shareModel.deleteMany({ postId: payload.postId });

    if (snapshot) {
      await this.distributionService.distributeRemoved(snapshot.postId);
    }

    await this.redis.del(`post:meta:${payload.postId}`);
  }
}
