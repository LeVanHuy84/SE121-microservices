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

  constructor(
    @InjectModel(PostSnapshot.name)
    private readonly postModel: Model<PostSnapshotDocument>,
    @InjectModel(ShareSnapshot.name)
    private readonly shareModel: Model<ShareSnapshotDocument>,
    private readonly distributionService: DistributionService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  // ------------------------------------------------
  // 🧩 HANDLE CREATED (đã fix hiển thị trending ngay)
  // ------------------------------------------------
  async handleCreated(payload: InferPostPayload<PostEventType.CREATED>) {
    if (!payload.postId) return;

    // Không tạo trùng
    const exists = await this.postModel.findOne({ postId: payload.postId });
    if (exists) return;

    const createdAt = new Date(payload.createdAt);

    // Tạo snapshot trong Mongo
    const entity = await this.postModel.create({
      ...payload,
      postCreatedAt: createdAt,
    });

    // ------------------------------
    // 🧠 Ghi meta key
    // ------------------------------
    if (!payload.groupId) {
      const metaKey = `post:meta:${payload.postId}`;
      await this.redis.hset(metaKey, {
        createdAt: createdAt.getTime(),
        lastStatAt: createdAt.getTime(), // 👈 thêm dòng này
      });
      await this.redis.expire(metaKey, this.META_TTL_SECONDS);
      await this.redis.zadd('post:score', 8, payload.postId);
    }

    // ------------------------------
    // 📢 Phân phối bài mới tới feed
    // ------------------------------
    await this.distributionService.distributeCreated(
      FeedEventType.POST,
      entity._id.toString(),
      entity.postId,
      entity.userId,
      entity.groupId,
    );
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
  }
}
