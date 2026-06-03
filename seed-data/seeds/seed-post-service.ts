import 'reflect-metadata';

import * as dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { Audience, Emotion, MediaType, PostGroupStatus } from '@repo/dtos';

type RawMedia = {
  type: string;
  url: string;
  publicId?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  thumbnailUrl?: string;
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
  content: string;
  media?: RawMedia[];
  postStats?: Record<string, number>;
  subCreatedAt: number;
  userId: string;
  emotionFeature?: RawEmotionFeature | null;
  groupId?: string;
};

type RawGroupSetting = {
  groupId: string;
  requiredPostApproval: boolean;
};

type RawGroupSeed = {
  id: string;
  privacy: string;
  groupSetting?: RawGroupSetting | null;
};

type PostSeedRow = {
  id: string;
  userId: string;
  groupId: string | null;
  feeling: Emotion | null;
  content: string;
  media: Array<{
    type: MediaType;
    url: string;
    publicId?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    duration?: number;
    thumbnailUrl?: string;
  }>;
  audience: Audience;
  mainEmotion: Emotion | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type PostStatSeedRow = {
  postId: string;
  reactions: number;
  likes: number;
  loves: number;
  hahas: number;
  wows: number;
  sads: number;
  angrys: number;
  comments: number;
  shares: number;
  reports: number;
};

type PostGroupInfoSeedRow = {
  postId: string;
  status: PostGroupStatus;
  isPrivateGroup: boolean;
};

type GroupMeta = {
  privacy: string;
  requiredPostApproval: boolean;
};

const ROOT_DIR = resolve(__dirname, '../..');
const POST_DATA_FILE = resolve(__dirname, '../data/post-full.json');
const GROUP_POST_DATA_FILE = resolve(__dirname, '../data/post-group.json');
const GROUP_DATA_FILE = resolve(__dirname, '../data/group-seed.json');
const ENV_CANDIDATES = [
  resolve(ROOT_DIR, 'apps/post-service/.env'),
  resolve(ROOT_DIR, 'apps/post-service/.env.local'),
];

function loadPostServiceEnv(): string {
  for (const envFile of ENV_CANDIDATES) {
    if (!existsSync(envFile)) {
      continue;
    }

    dotenv.config({ path: envFile });

    if (process.env.POSTGRES_URL) {
      return envFile;
    }
  }

  throw new Error(
    'Unable to find POSTGRES_URL. Expected apps/post-service/.env or .env.local',
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

function loadRawGroups(): RawGroupSeed[] {
  const content = readFileSync(GROUP_DATA_FILE, 'utf-8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('group-seed.json must contain an array of groups');
  }

  return parsed as RawGroupSeed[];
}

function buildGroupMetaLookup(
  rawGroups: RawGroupSeed[],
): Map<string, GroupMeta> {
  const lookup = new Map<string, GroupMeta>();

  for (const group of rawGroups) {
    if (!group.groupSetting) {
      continue;
    }

    lookup.set(group.id, {
      privacy: group.privacy,
      requiredPostApproval: group.groupSetting.requiredPostApproval,
    });
  }

  return lookup;
}

function normalizeAudience(value: string): Audience {
  if (!Object.values(Audience).includes(value as Audience)) {
    throw new Error(`Unsupported audience value: ${value}`);
  }

  return value as Audience;
}

function normalizeEmotion(value?: string | null): Emotion | null {
  if (!value) {
    return null;
  }

  const normalized = value.toUpperCase();

  if (!Object.values(Emotion).includes(normalized as Emotion)) {
    return null;
  }

  return normalized as Emotion;
}

function normalizeMedia(media?: RawMedia[]): PostSeedRow['media'] {
  return (media ?? []).map((item) => ({
    type: item.type as MediaType,
    url: item.url,
    publicId: item.publicId,
    fileName: item.fileName,
    mimeType: item.mimeType,
    size: item.size,
    duration: item.duration,
    thumbnailUrl: item.thumbnailUrl,
  }));
}

function normalizeStats(stats?: Record<string, number>): PostStatSeedRow {
  return {
    postId: '',
    reactions: stats?.reactions ?? 0,
    likes: stats?.likes ?? 0,
    loves: stats?.loves ?? 0,
    hahas: stats?.hahas ?? 0,
    wows: stats?.wows ?? 0,
    sads: stats?.sads ?? 0,
    angrys: stats?.angrys ?? 0,
    comments: stats?.comments ?? 0,
    shares: stats?.shares ?? 0,
    reports: 0,
  };
}

function resolveGroupPostStatus(
  groupMeta: GroupMeta,
  groupPostIndex: number,
): PostGroupStatus {
  if (!groupMeta.requiredPostApproval) {
    return PostGroupStatus.PUBLISHED;
  }

  return groupPostIndex < 3
    ? PostGroupStatus.PUBLISHED
    : PostGroupStatus.PENDING;
}

function buildSeedRows(
  rawPosts: RawPost[],
  groupMetaLookup?: Map<string, GroupMeta>,
): {
  posts: PostSeedRow[];
  postStats: PostStatSeedRow[];
  postGroupInfos: PostGroupInfoSeedRow[];
} {
  const posts: PostSeedRow[] = [];
  const postStats: PostStatSeedRow[] = [];
  const postGroupInfos: PostGroupInfoSeedRow[] = [];
  const groupPostCounts = new Map<string, number>();

  for (const rawPost of rawPosts) {
    const createdAt = new Date(Date.now() - rawPost.subCreatedAt * 1000);
    const mainEmotion = normalizeEmotion(rawPost.emotionFeature?.label);
    const groupId = rawPost.groupId ?? null;

    posts.push({
      id: rawPost.id,
      userId: rawPost.userId,
      groupId,
      feeling: mainEmotion,
      content: rawPost.content,
      media: normalizeMedia(rawPost.media),
      audience: normalizeAudience(rawPost.audience),
      mainEmotion,
      isDeleted: false,
      createdAt,
      updatedAt: createdAt,
    });

    postStats.push({
      ...normalizeStats(rawPost.postStats),
      postId: rawPost.id,
    });

    if (groupId) {
      if (!groupMetaLookup) {
        throw new Error(`Missing group metadata for post ${rawPost.id}`);
      }

      const groupMeta = groupMetaLookup.get(groupId);

      if (!groupMeta) {
        throw new Error(`Missing group metadata for post ${rawPost.id}`);
      }

      const currentIndex = groupPostCounts.get(groupId) ?? 0;

      postGroupInfos.push({
        postId: rawPost.id,
        status: resolveGroupPostStatus(groupMeta, currentIndex),
        isPrivateGroup: groupMeta.privacy === 'PRIVATE',
      });
      groupPostCounts.set(groupId, currentIndex + 1);
    }
  }

  return { posts, postStats, postGroupInfos };
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

function buildPgClient(): Client {
  const databaseUrl = process.env.POSTGRES_URL;

  if (!databaseUrl) {
    throw new Error('POSTGRES_URL is missing after loading env file');
  }

  return new Client({ connectionString: databaseUrl });
}

async function insertPostChunk(
  client: Client,
  posts: PostSeedRow[],
): Promise<void> {
  const sql = `
    INSERT INTO posts (
      id,
      user_id,
      group_id,
      feeling,
      content,
      media,
      audience,
      "mainEmotion",
      is_deleted,
      created_at,
      updated_at
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6::jsonb,
      $7,
      $8,
      $9,
      $10,
      $11
    )
  `;

  for (const post of posts) {
    await client.query(sql, [
      post.id,
      post.userId,
      post.groupId,
      post.feeling,
      post.content,
      JSON.stringify(post.media),
      post.audience,
      post.mainEmotion,
      post.isDeleted,
      post.createdAt,
      post.updatedAt,
    ]);
  }
}

async function insertPostStatChunk(
  client: Client,
  postStats: PostStatSeedRow[],
): Promise<void> {
  const sql = `
    INSERT INTO post_stats (
      post_id,
      reactions,
      likes,
      loves,
      hahas,
      wows,
      sads,
      angrys,
      comments,
      shares,
      reports
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11
    )
  `;

  for (const postStat of postStats) {
    await client.query(sql, [
      postStat.postId,
      postStat.reactions,
      postStat.likes,
      postStat.loves,
      postStat.hahas,
      postStat.wows,
      postStat.sads,
      postStat.angrys,
      postStat.comments,
      postStat.shares,
      postStat.reports,
    ]);
  }
}

async function insertPostGroupInfoChunk(
  client: Client,
  postGroupInfos: PostGroupInfoSeedRow[],
): Promise<void> {
  const sql = `
    INSERT INTO post_group_infos (
      post_id,
      status,
      is_private_group
    ) VALUES (
      $1,
      $2,
      $3
    )
  `;

  for (const postGroupInfo of postGroupInfos) {
    await client.query(sql, [
      postGroupInfo.postId,
      postGroupInfo.status,
      postGroupInfo.isPrivateGroup,
    ]);
  }
}

async function truncateExistingTables(client: Client): Promise<void> {
  const candidateTables = [
    'comments',
    'comment_stats',
    'content_moderations',
    'edit_histories',
    'moderation_appeals',
    'post_group_infos',
    'post_stats',
    'posts',
    'reactions',
    'reports',
    'share_stats',
    'shares',
    'outbox_event',
  ];

  const result = await client.query<{
    table_name: string;
  }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])
    `,
    [candidateTables],
  );

  const tableNames = result.rows.map((row) => row.table_name);

  if (tableNames.length === 0) {
    throw new Error('No post-service tables were found to truncate');
  }

  const quotedTables = tableNames
    .map((tableName) => `"${tableName}"`)
    .join(', ');

  await client.query(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`);
}

async function main(): Promise<void> {
  const envFile = loadPostServiceEnv();
  const groupMetaLookup = buildGroupMetaLookup(loadRawGroups());
  const rawPosts = loadRawPosts(
    POST_DATA_FILE,
    'post-full.json must contain an array of posts',
  );
  const rawGroupPosts = loadRawPosts(
    GROUP_POST_DATA_FILE,
    'post-group.json must contain an array of posts',
  );
  const personalSeedRows = buildSeedRows(rawPosts);
  const groupSeedRows = buildSeedRows(rawGroupPosts, groupMetaLookup);
  const posts = [...personalSeedRows.posts, ...groupSeedRows.posts];
  const postStats = [...personalSeedRows.postStats, ...groupSeedRows.postStats];
  const postGroupInfos = groupSeedRows.postGroupInfos;
  const client = buildPgClient();

  await client.connect();

  try {
    await client.query('BEGIN');

    await truncateExistingTables(client);

    for (const chunk of chunkArray(posts, 200)) {
      await insertPostChunk(client, chunk);
    }

    for (const chunk of chunkArray(postStats, 200)) {
      await insertPostStatChunk(client, chunk);
    }

    for (const chunk of chunkArray(postGroupInfos, 200)) {
      await insertPostGroupInfoChunk(client, chunk);
    }

    await client.query('COMMIT');

    console.log(
      `Seeded post-service from ${POST_DATA_FILE} and ${GROUP_POST_DATA_FILE} using ${envFile}: ${posts.length} posts`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[seed-post-service] ${message}`);
  process.exitCode = 1;
});
