import * as dotenv from 'dotenv';
import Redis from 'ioredis';
import * as mongoose from 'mongoose';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type RawMedia = {
  type: string;
  url: string;
};

type RawEmotionFeature = {
  label: string;
  confidence: number;
  intensity: number;
  dominantScene?: string;
  riskHintLevel?: string;
  score?: Record<string, number>;
};

type RawPost = {
  id: string;
  audience: string;
  content?: string;
  media?: RawMedia[];
  postStats?: Record<string, number>;
  subCreatedAt: number;
  userId: string;
  groupId?: string;
  emotionFeature?: RawEmotionFeature | null;
};

type SnapshotSeedDoc = {
  _id: mongoose.Types.ObjectId;
  postId: string;
  userId: string;
  audience: string;
  content?: string;
  groupId?: string;
  mediaPreviews: Array<{
    type: string;
    url: string;
  }>;
  mediaRemaining: number;
  emotionFeature?: {
    label: string;
    confidence: number;
    intensity: number;
    dominantScene?: string;
    scores?: Record<string, number>;
    riskHintLevel?: string;
  };
  postCreatedAt: Date;
  stats: {
    reactions: number;
    likes: number;
    loves: number;
    hahas: number;
    wows: number;
    angrys: number;
    sads: number;
    comments: number;
    shares: number;
  };
  createdAt: Date;
  updatedAt: Date;
};

type FeedItemSeedDoc = {
  userId: string;
  eventType: 'POST';
  snapshotId: string;
  postId: string;
  refId: string;
  emotionLabel?: string;
  createdAt: Date;
  updatedAt: Date;
};

const ROOT_DIR = resolve(__dirname, '../..');
const POST_FULL_DATA_FILE = resolve(__dirname, '../data/post-full.json');
const POST_GROUP_DATA_FILE = resolve(__dirname, '../data/post-group.json');
const REDIS_HOST = '127.0.0.1';
const REDIS_PORT = 6379;
const ENV_CANDIDATES = [
  resolve(ROOT_DIR, 'apps/feed-service/.env'),
  resolve(ROOT_DIR, 'apps/feed-service/.env.local'),
];

function loadFeedServiceEnv(): string {
  for (const envFile of ENV_CANDIDATES) {
    if (!existsSync(envFile)) {
      continue;
    }

    dotenv.config({ path: envFile });

    if (process.env.MONGODB_URI) {
      return envFile;
    }
  }

  throw new Error(
    'Unable to find MONGODB_URI. Expected apps/feed-service/.env or .env.local',
  );
}

function loadRawPosts(filePath: string, errorMessage: string): RawPost[] {
  const content = readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(errorMessage);
  }

  return parsed as RawPost[];
}

async function flushTrendingRedis(): Promise<void> {
  const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await redis.connect();
    await redis.flushall();
  } finally {
    redis.disconnect();
  }
}

function normalizeStats(
  stats?: Record<string, number>,
): SnapshotSeedDoc['stats'] {
  return {
    reactions: stats?.reactions ?? 0,
    likes: stats?.likes ?? 0,
    loves: stats?.loves ?? 0,
    hahas: stats?.hahas ?? 0,
    wows: stats?.wows ?? 0,
    angrys: stats?.angrys ?? 0,
    sads: stats?.sads ?? 0,
    comments: stats?.comments ?? 0,
    shares: stats?.shares ?? 0,
  };
}

function buildSnapshotSeed(post: RawPost): SnapshotSeedDoc {
  const postCreatedAt = new Date(Date.now() - post.subCreatedAt * 1000);

  return {
    _id: new mongoose.Types.ObjectId(),
    postId: post.id,
    userId: post.userId,
    audience: post.audience,
    content: post.content,
    mediaPreviews: (post.media ?? []).map((media) => ({
      type: media.type,
      url: media.url,
    })),
    mediaRemaining: 0,
    emotionFeature: post.emotionFeature
      ? {
          label: post.emotionFeature.label,
          confidence: post.emotionFeature.confidence,
          intensity: post.emotionFeature.intensity,
          dominantScene: post.emotionFeature.dominantScene,
          scores: post.emotionFeature.score,
          riskHintLevel: post.emotionFeature.riskHintLevel,
        }
      : undefined,
    postCreatedAt,
    stats: normalizeStats(post.postStats),
    createdAt: postCreatedAt,
    updatedAt: postCreatedAt,
  };
}

function getTargetUserIds(rawPosts: RawPost[], limit = 5): string[] {
  const seen = new Set<string>();
  const userIds: string[] = [];

  for (const post of rawPosts) {
    if (seen.has(post.userId)) {
      continue;
    }

    seen.add(post.userId);
    userIds.push(post.userId);

    if (userIds.length >= limit) {
      break;
    }
  }

  return userIds;
}

function buildFeedItems(
  snapshots: SnapshotSeedDoc[],
  targetUserIds: string[],
): FeedItemSeedDoc[] {
  const orderedSnapshots = [...snapshots].sort(
    (left, right) =>
      right.postCreatedAt.getTime() - left.postCreatedAt.getTime(),
  );
  const feedItems: FeedItemSeedDoc[] = [];

  for (const userId of targetUserIds) {
    const candidateSnapshots = orderedSnapshots.filter(
      (snapshot) => snapshot.userId !== userId,
    );

    const pickedSnapshots = candidateSnapshots.slice(
      0,
      Math.min(100, candidateSnapshots.length),
    );

    for (const snapshot of pickedSnapshots) {
      feedItems.push({
        userId,
        eventType: 'POST',
        snapshotId: snapshot._id.toString(),
        postId: snapshot.postId,
        refId: snapshot.postId,
        emotionLabel: snapshot.emotionFeature?.label,
        createdAt: snapshot.postCreatedAt,
        updatedAt: snapshot.postCreatedAt,
      });
    }
  }

  return feedItems;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Chunk size must be greater than 0');
  }

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function main(): Promise<void> {
  const envFile = loadFeedServiceEnv();
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error(`MONGODB_URI is missing after loading ${envFile}`);
  }

  const rawPosts = [
    ...loadRawPosts(
      POST_FULL_DATA_FILE,
      'post-full.json must contain an array of posts',
    ),
    ...loadRawPosts(
      POST_GROUP_DATA_FILE,
      'post-group.json must contain an array of posts',
    ),
  ];
  const snapshotSeeds = rawPosts.map(buildSnapshotSeed);
  const targetUserIds = getTargetUserIds(rawPosts);
  const feedItemSeeds = buildFeedItems(snapshotSeeds, targetUserIds);

  await flushTrendingRedis();

  const mongooseInstance = await mongoose.connect(mongoUri, {
    dbName: 'feed_service',
  });

  try {
    const conn = mongooseInstance.connection;

    await conn.dropDatabase();

    const snapshotCollection = conn.collection('post_snapshots');
    const feedItemCollection = conn.collection('feed_items');

    for (const chunk of chunkArray(snapshotSeeds, 200)) {
      await snapshotCollection.insertMany(chunk, { ordered: false });
    }

    for (const chunk of chunkArray(feedItemSeeds, 200)) {
      await feedItemCollection.insertMany(chunk, { ordered: false });
    }

    console.log(
      `Seeded feed-service from ${POST_FULL_DATA_FILE} + ${POST_GROUP_DATA_FILE}: ${snapshotSeeds.length} snapshots, ${feedItemSeeds.length} feed items`,
    );
  } finally {
    await mongooseInstance.disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed-feed-service] ${message}`);
  process.exitCode = 1;
});
