import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Audience } from "@repo/dtos";
import { Model } from "mongoose";
import {
  PostSnapshot,
  PostSnapshotDocument,
} from "../schema/post-snapshot.schema";
import {
  ShareSnapshot,
  ShareSnapshotDocument,
} from "../schema/share-snapshot.schema";
import { CacheLayerService } from "../../cache-layer/cache-layer.service";

@Injectable()
export class SnapshotRepository {
  private readonly logger = new Logger(SnapshotRepository.name);

  constructor(
    @InjectModel(PostSnapshot.name)
    private readonly postModel: Model<PostSnapshotDocument>,

    @InjectModel(ShareSnapshot.name)
    private readonly shareModel: Model<ShareSnapshotDocument>,

    private readonly cacheLayer: CacheLayerService,
  ) {}

  async findPostsByIds(
    ids: string[],
    mainEmotion?: string,
  ): Promise<PostSnapshot[]> {
    if (!ids?.length) return [];
    const uniqueIds = Array.from(new Set(ids));

    // 1. Fetch from Redis Cache first
    const cachedMap = await this.cacheLayer.getPostBatch(uniqueIds);
    const result: PostSnapshot[] = [];
    const missingIds: string[] = [];

    for (const id of uniqueIds) {
      const cached = cachedMap.get(id);
      if (cached) {
        const emotion =
          cached.emotionFeature?.label || cached.emotionFeature?.primaryEmotion;
        if (
          !mainEmotion ||
          emotion?.toLowerCase() === mainEmotion.toLowerCase()
        ) {
          result.push(cached);
        }
      } else {
        missingIds.push(id);
      }
    }

    // 2. Query MongoDB for cache misses
    if (missingIds.length > 0) {
      const filter: Record<string, any> = {
        postId: { $in: missingIds },
      };
      if (mainEmotion) {
        filter["emotionFeature.label"] = mainEmotion.toLowerCase();
      }

      const dbPosts = await this.postModel
        .find(filter)
        .lean<PostSnapshot[]>()
        .exec();

      if (dbPosts.length > 0) {
        result.push(...dbPosts);
        // Write-through to cache asynchronously
        await this.cacheLayer.setPostBatch(dbPosts).catch((err: any) => {
          this.logger.warn(`Failed to set post cache batch: ${err?.message}`);
        });
      }
    }

    return result;
  }

  async findSharesByIds(
    ids: string[],
    mainEmotion?: string,
  ): Promise<ShareSnapshot[]> {
    if (!ids?.length) return [];
    const uniqueIds = Array.from(new Set(ids));

    // 1. Fetch from Redis Cache first
    const cachedMap = await this.cacheLayer.getShareBatch(uniqueIds);
    const result: ShareSnapshot[] = [];
    const missingIds: string[] = [];

    for (const id of uniqueIds) {
      const cached = cachedMap.get(id);
      if (cached) {
        result.push(cached);
      } else {
        missingIds.push(id);
      }
    }

    // 2. Query MongoDB for cache misses
    if (missingIds.length > 0) {
      const filter: Record<string, any> = {
        shareId: { $in: missingIds },
      };
      if (mainEmotion) {
        filter["post.mainEmotion"] = mainEmotion;
      }

      const dbShares = await this.shareModel
        .find(filter)
        .lean<ShareSnapshot[]>()
        .exec();

      if (dbShares.length > 0) {
        result.push(...dbShares);
        // Write-through to cache asynchronously
        await this.cacheLayer.setShareBatch(dbShares).catch((err: any) => {
          this.logger.warn(`Failed to set share cache batch: ${err?.message}`);
        });
      }
    }

    return result;
  }

  async findPostsForRanking(ids: string[], mainEmotion?: string) {
    if (!ids?.length) return [];

    return this.postModel
      .find(
        {
          postId: { $in: ids },
          ...(mainEmotion && {
            "emotionFeature.label": mainEmotion,
          }),
        },
        {
          postId: 1,
          userId: 1,
          hasWarning: 1,
          warningReason: 1,
          needsMentalSupport: 1,
          moderationAction: 1,
          isDeleted: 1,
          "emotionFeature.label": 1,
          "emotionFeature.scores": 1,
          "emotionFeature.intensity": 1,
          "emotionFeature.confidence": 1,
          "emotionFeature.riskHintLevel": 1,
          "emotionFeature.mentalHealthRiskLevel": 1,
          "emotionFeature.isSarcasmOrConflict": 1,
          stats: 1,
        },
      )
      .lean()
      .exec();
  }

  async findTrendingCandidates(limit = 1000): Promise<PostSnapshot[]> {
    const filter = {
      audience: Audience.PUBLIC,
      $and: [
        {
          $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }],
        },
        {
          $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
        },
      ],
    };

    return this.postModel
      .find(filter)
      .sort({
        "stats.reactions": -1,
        "stats.comments": -1,
        "stats.shares": -1,
        postCreatedAt: -1,
      })
      .limit(limit)
      .lean<PostSnapshot[]>()
      .exec();
  }

  async findTrendingCandidatesBatch(limit: number, offset: number) {
    return this.postModel
      .find({ audience: "PUBLIC" })
      .sort({ "stats.reactions": -1 })
      .skip(offset)
      .limit(limit)
      .lean();
  }
}
