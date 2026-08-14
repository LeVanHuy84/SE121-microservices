import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ClientSession, Model } from "mongoose";
import {
  PostSnapshot,
  PostSnapshotDocument,
} from "../../mongo/schema/post-snapshot.schema";
import {
  ShareSnapshot,
  ShareSnapshotDocument,
} from "../../mongo/schema/share-snapshot.schema";
import {
  Audience,
  Emotion,
  FeedEventType,
  InferPostPayload,
  PostEventType,
} from "@repo/dtos";
import { InjectRedis } from "@nestjs-modules/ioredis";
import Redis from "ioredis";
import { DistributionService } from "./distribution.service";

@Injectable()
export class IngestionPostService {
  private readonly logger = new Logger(IngestionPostService.name);

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
  // HANDLE CREATED (đã fix hiển thị trending ngay)
  // ------------------------------------------------
  async handleCreated(
    payload: InferPostPayload<PostEventType.CREATED>,
    session?: ClientSession,
  ) {
    if (!payload.postId) return;

    // Không tạo trùng
    const exists = await this.postModel.findOne(
      { postId: payload.postId },
      null,
      {
        session,
      },
    );
    if (exists) return;

    const createdAt = new Date(payload.createdAt);

    // Tạo snapshot trong Mongo
    const [entity] = await this.postModel.insertMany(
      [
        {
          ...payload,
          postCreatedAt: createdAt,
        },
      ],
      { session },
    );

    // ------------------------------
    // Ghi meta key
    // ------------------------------
    if (payload.audience === Audience.PUBLIC || !payload.groupId) {
      const metaKey = `post:meta:${payload.postId}`;
      await this.redis.hset(metaKey, {
        createdAt: createdAt.getTime(),
        lastStatAt: createdAt.getTime(), // 👈 thêm dòng này
      });
      await this.redis.expire(metaKey, this.META_TTL_SECONDS);
      await this.redis.zadd("post:score", 1, payload.postId);
      const ttlFreshMs = 48 * 60 * 60 * 1000; // 48h
      const expireAt = createdAt.getTime() + ttlFreshMs;

      await this.redis.zadd("post:fresh", expireAt, payload.postId);
    }

    // ------------------------------
    // Phân phối bài mới tới feed
    // ------------------------------
    await this.distributionService.distributeCreated(
      FeedEventType.POST,
      entity._id.toString(),
      entity.postId,
      entity.postId,
      entity.userId,
      entity.groupId,
      session,
    );
  }

  // ------------------------------------------------
  // HANDLE UPDATED
  // ------------------------------------------------
  async handleUpdated(
    payload: InferPostPayload<PostEventType.UPDATED>,
    session?: ClientSession,
  ) {
    if (!payload.postId) return;

    const updateData: Record<string, any> = {};

    if (payload.content !== undefined) {
      updateData.content = payload.content;
    }

    if (payload.audience !== undefined) {
      updateData.audience = payload.audience;
    }

    if (Object.keys(updateData).length === 0) return;

    await this.postModel.updateOne(
      { postId: payload.postId },
      { $set: updateData },
      { session },
    );
  }

  // ------------------------------------------------
  // HANDLE REMOVED
  // ------------------------------------------------
  async handleRemoved(
    payload: InferPostPayload<PostEventType.REMOVED>,
    session?: ClientSession,
  ) {
    if (!("postId" in payload)) return;

    const snapshot = await this.postModel.findOneAndDelete(
      {
        postId: payload.postId,
      },
      { session },
    );

    await this.shareModel.deleteMany({ postId: payload.postId }, { session });

    const postId = payload.postId;

    // ------------------------------
    // Dọn Redis
    // ------------------------------

    // 1. Xóa trending score chính
    await this.redis.zrem("post:score", postId);

    // 2. Xóa meta
    await this.redis.del(`post:meta:${postId}`);

    // 3. Xóa khỏi toàn bộ emotion score
    const emotionKeys = Object.values(Emotion).map(
      (emotion) => `post:score:emotion:${emotion.toLowerCase()}`,
    );

    for (const key of emotionKeys) {
      await this.redis.zrem(key, postId);
    }

    // ------------------------------
    // Phân phối remove
    // ------------------------------
    if (snapshot) {
      await this.distributionService.distributeRemoved(
        snapshot.postId,
        session,
      );
    }
  }
}
