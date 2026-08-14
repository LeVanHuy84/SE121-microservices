import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { FeedEventType } from "@repo/dtos";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Model, Types } from "mongoose";
import {
  PostSnapshot,
  PostSnapshotDocument,
} from "../mongo/schema/post-snapshot.schema";
import { FeedItem, FeedItemDocument } from "../mongo/schema/feed-item.schema";

type SeedPostRaw = {
  id: string;
  userId: string;
  audience: string;
  content?: string;
  postStats?: Record<string, number>;
  emotionFeature?: Record<string, unknown>;
};

type SeedUserRaw = {
  userId: string;
  email?: string;
};

type MappedPost = {
  postId: string;
  userId: string;
  audience: string;
  content?: string;
  stats: Record<string, number>;
  emotionFeature?: Record<string, unknown>;
  postCreatedAt: Date;
  mediaPreviews: [];
  mediaRemaining: number;
};

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);
  private readonly seedDir = __dirname;

  constructor(
    @InjectModel(PostSnapshot.name)
    private readonly postSnapshotModel: Model<PostSnapshotDocument>,
    @InjectModel(FeedItem.name)
    private readonly feedItemModel: Model<FeedItemDocument>,
  ) {}

  async seedDirect(): Promise<void> {
    this.logger.log("Starting direct seed for feed-service");

    const [rawPosts, rawUsers] = await Promise.all([
      this.loadPosts(),
      this.loadUsers(),
    ]);

    const mappedPosts = this.mapPosts(rawPosts);
    const snapshots = await this.seedPosts(mappedPosts);
    await this.seedFeedItems(rawUsers, snapshots);

    this.logger.log(
      `Seed completed: ${snapshots.length} post snapshots inserted`,
    );
  }

  private async loadPosts(): Promise<SeedPostRaw[]> {
    const postsPath = join(this.seedDir, "posts.json");
    const fileContent = await readFile(postsPath, "utf-8");
    const parsed = JSON.parse(fileContent) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error("posts.json must be an array");
    }

    return parsed as SeedPostRaw[];
  }

  private async loadUsers(): Promise<SeedUserRaw[]> {
    const usersPath = join(this.seedDir, "users.json");
    const fileContent = await readFile(usersPath, "utf-8");
    const parsed = JSON.parse(fileContent) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error("users.json must be an array");
    }

    return parsed as SeedUserRaw[];
  }

  private mapPosts(rawPosts: SeedPostRaw[]): MappedPost[] {
    return rawPosts.map((post) => ({
      postId: post.id,
      userId: post.userId,
      audience: post.audience,
      content: post.content,
      stats: post.postStats ?? {},
      emotionFeature: post.emotionFeature,
      postCreatedAt: this.randomRecentDate(72),
      mediaPreviews: [],
      mediaRemaining: 0,
    }));
  }

  private async seedPosts(
    mappedPosts: MappedPost[],
  ): Promise<PostSnapshotDocument[]> {
    await Promise.all([
      this.postSnapshotModel.deleteMany({}),
      this.feedItemModel.deleteMany({}),
    ]);

    const batchSize = 200;
    const results: PostSnapshotDocument[] = [];

    for (const chunk of this.chunkArray(mappedPosts, batchSize)) {
      const inserted = await this.postSnapshotModel.insertMany(chunk, {
        ordered: false,
      });
      results.push(...inserted);
    }

    return results;
  }

  private async seedFeedItems(
    users: SeedUserRaw[],
    snapshots: PostSnapshotDocument[],
  ): Promise<void> {
    const targetUsers = users.slice(0, 5).map((user) => user.userId);
    const batchSize = 200;

    for (const receiverUserId of targetUsers) {
      const targetCount = this.randomInt(300, 400);
      const candidatePosts = this.shuffleArray(
        this.uniqueByPostId(
          snapshots.filter((snapshot) => snapshot.userId !== receiverUserId),
        ),
      );

      const pickedSnapshots = candidatePosts.slice(
        0,
        Math.min(targetCount, candidatePosts.length),
      );

      const feedItems = pickedSnapshots.map((snapshot) => {
        const snapshotId = snapshot._id.toString();

        return {
          userId: receiverUserId,
          snapshotId,
          eventType: FeedEventType.POST,
          refId: snapshot.postId,
          postId: snapshot.postId,
          createdAt: this.randomRecentDate(48),
          updatedAt: new Date(),
        };
      });

      for (const chunk of this.chunkArray(feedItems, batchSize)) {
        await this.feedItemModel.insertMany(chunk, { ordered: false });
      }

      this.logger.log(
        `Seeded ${feedItems.length} feed items for user ${receiverUserId}`,
      );
    }
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private randomRecentDate(withinHours: number): Date {
    const now = Date.now();
    const windowMs = withinHours * 60 * 60 * 1000;
    const offset = this.randomInt(0, windowMs);

    return new Date(now - offset);
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    if (size <= 0) {
      throw new Error("Chunk size must be greater than 0");
    }

    const chunks: T[][] = [];

    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }

    return chunks;
  }

  private uniqueByPostId(
    snapshots: PostSnapshotDocument[],
  ): PostSnapshotDocument[] {
    const seenPostIds = new Set<string>();
    const uniqueSnapshots: PostSnapshotDocument[] = [];

    for (const snapshot of snapshots) {
      if (seenPostIds.has(snapshot.postId)) {
        continue;
      }

      seenPostIds.add(snapshot.postId);
      uniqueSnapshots.push(snapshot);
    }

    return uniqueSnapshots;
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];

    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = this.randomInt(0, i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
