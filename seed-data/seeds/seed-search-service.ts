import * as dotenv from 'dotenv';
import { Client } from '@elastic/elasticsearch';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client as PgClient } from 'pg';
import {
  GROUP_INDEX,
  GroupIndexMapping,
} from '../../apps/search-service/src/modules/group/group.mapping';
import {
  POST_INDEX,
  PostMapping,
} from '../../apps/search-service/src/modules/post/post.mapping';
import {
  USER_INDEX,
  UserIndexMapping,
} from '../../apps/search-service/src/modules/user/user.mapping';

type RawGroupSeed = {
  id: string;
  name: string;
  description?: string | null;
  avatar?: {
    url?: string;
  } | null;
  privacy: string;
  members: number;
  createdAt: string;
  owner?: {
    avatarUrl?: string;
  };
};

type RawEmotionFeature = {
  label?: string;
};

type RawPost = {
  id: string;
  content: string;
  subCreatedAt: number;
  userId: string;
  emotionFeature?: RawEmotionFeature | null;
};

type UserSeedDoc = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: Date;
};

type UserDbRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: Date;
};

type PostSeedDoc = {
  id: string;
  userId: string;
  groupId: string | null;
  content: string;
  mainEmotion: string | null;
  createdAt: Date;
};

type GroupSeedDoc = {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  privacy: string;
  members: number;
  createdAt: Date;
};

const ROOT_DIR = resolve(__dirname, '../..');
const POSTS_FILE = resolve(__dirname, '../data/post-full.json');
const GROUPS_FILE = resolve(__dirname, '../data/group-seed.json');
const SEARCH_ENV_CANDIDATES = [
  resolve(ROOT_DIR, 'apps/search-service/.env'),
  resolve(ROOT_DIR, 'apps/search-service/.env.local'),
];
const USER_ENV_CANDIDATES = [
  resolve(ROOT_DIR, 'apps/user-service/.env'),
  resolve(ROOT_DIR, 'apps/user-service/.env.local'),
];

function loadSearchServiceEnv(): string {
  for (const envFile of SEARCH_ENV_CANDIDATES) {
    if (!existsSync(envFile)) {
      continue;
    }

    dotenv.config({ path: envFile });

    if (process.env.ES_NODE) {
      return envFile;
    }
  }

  throw new Error(
    'Unable to find ES_NODE. Expected apps/search-service/.env or .env.local',
  );
}

function loadUserServiceEnv(): string {
  for (const envFile of USER_ENV_CANDIDATES) {
    if (!existsSync(envFile)) {
      continue;
    }

    dotenv.config({ path: envFile });

    if (process.env.DATABASE_URL) {
      return envFile;
    }
  }

  throw new Error(
    'Unable to find DATABASE_URL. Expected apps/user-service/.env or .env.local',
  );
}

function loadJsonFile<T>(filePath: string, errorMessage: string): T {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(errorMessage);
  }

  return parsed as T;
}

function loadRawPosts(): RawPost[] {
  return loadJsonFile<RawPost[]>(
    POSTS_FILE,
    'post-full.json must contain an array of posts',
  );
}

function loadRawGroups(): RawGroupSeed[] {
  return loadJsonFile<RawGroupSeed[]>(
    GROUPS_FILE,
    'group-seed.json must contain an array of groups',
  );
}

function buildUserDocuments(rows: UserDbRow[]): UserSeedDoc[] {
  return rows.map((row) => {
    const firstName = row.first_name?.trim() || null;
    const lastName = row.last_name?.trim() || null;
    const fullName =
      [firstName, lastName].filter(Boolean).join(' ') || row.email;

    return {
      id: row.id,
      email: row.email,
      firstName,
      lastName,
      fullName,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      createdAt: row.created_at,
    };
  });
}

function buildPostDocuments(rawPosts: RawPost[]): PostSeedDoc[] {
  return rawPosts.map((rawPost) => {
    const mainEmotion = rawPost.emotionFeature?.label?.trim();
    const createdAt = new Date(Date.now() - rawPost.subCreatedAt * 1000);

    return {
      id: rawPost.id,
      userId: rawPost.userId,
      groupId: null,
      content: rawPost.content,
      mainEmotion: mainEmotion ? mainEmotion.toUpperCase() : null,
      createdAt,
    };
  });
}

function buildGroupDocuments(rawGroups: RawGroupSeed[]): GroupSeedDoc[] {
  return rawGroups.map((rawGroup) => ({
    id: rawGroup.id,
    name: rawGroup.name,
    description: rawGroup.description ?? null,
    avatarUrl: rawGroup.avatar?.url ?? rawGroup.owner?.avatarUrl ?? null,
    privacy: rawGroup.privacy,
    members: rawGroup.members,
    createdAt: new Date(rawGroup.createdAt),
  }));
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

function buildElasticClient(): Client {
  const node = process.env.ES_NODE;

  if (!node) {
    throw new Error('ES_NODE is missing after loading env file');
  }

  return new Client({
    node,
    auth: {
      username: process.env.ES_USER ?? 'elastic',
      password: process.env.ES_PASS ?? 'password',
    },
  });
}

function buildUserDbClient(): PgClient {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is missing after loading user-service env');
  }

  return new PgClient({
    connectionString: databaseUrl,
  });
}

async function fetchUserDocuments(pgClient: PgClient): Promise<UserSeedDoc[]> {
  const result = await pgClient.query<UserDbRow>(`
    SELECT
      u.id,
      u.email,
      p.first_name,
      p.last_name,
      p.avatar_url,
      p.bio,
      u.created_at
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.deleted_at IS NULL
      AND u.is_active = true
      AND u.user_status = 'ACTIVE'
    ORDER BY u.created_at ASC, u.id ASC
  `);

  return buildUserDocuments(result.rows);
}

async function resetIndex(
  client: Client,
  indexName: string,
  mapping: { mappings: Record<string, unknown> },
): Promise<void> {
  const exists = await client.indices.exists({ index: indexName });

  if (exists) {
    await client.indices.delete({ index: indexName });
  }

  await client.indices.create({
    index: indexName,
    mappings: mapping.mappings,
  });
}

async function bulkIndexDocuments<T extends { id: string }>(
  client: Client,
  indexName: string,
  documents: T[],
): Promise<void> {
  for (const chunk of chunkArray(documents, 200)) {
    const operations = chunk.flatMap((document) => [
      { index: { _index: indexName, _id: document.id } },
      document,
    ]);

    const result = await client.bulk({
      operations,
      refresh: true,
    });

    if (!result.errors) {
      continue;
    }

    const failedItems = result.items.filter((item) => {
      const actionType = Object.keys(item)[0] as keyof typeof item;
      return Boolean(item[actionType]?.error);
    });

    throw new Error(
      `Bulk index failed for ${indexName} with ${failedItems.length} document(s)`,
    );
  }
}

async function seedIndex(
  client: Client,
  indexName: string,
  mapping: { mappings: Record<string, unknown> },
  documents: Array<{ id: string }>,
): Promise<void> {
  await resetIndex(client, indexName, mapping);
  await bulkIndexDocuments(client, indexName, documents);
}

async function main(): Promise<void> {
  const searchEnvFile = loadSearchServiceEnv();
  const userEnvFile = loadUserServiceEnv();
  const client = buildElasticClient();
  const pgClient = buildUserDbClient();

  const rawPosts = loadRawPosts();
  const rawGroups = loadRawGroups();

  try {
    await pgClient.connect();

    const userDocs = await fetchUserDocuments(pgClient);
    const postDocs = buildPostDocuments(rawPosts);
    const groupDocs = buildGroupDocuments(rawGroups);

    await seedIndex(client, USER_INDEX, UserIndexMapping, userDocs);
    await seedIndex(client, POST_INDEX, PostMapping, postDocs);
    await seedIndex(client, GROUP_INDEX, GroupIndexMapping, groupDocs);

    console.log(
      `Seeded search-service from ${searchEnvFile} and users from ${userEnvFile}: ${userDocs.length} users, ${postDocs.length} posts, ${groupDocs.length} groups`,
    );
  } finally {
    await pgClient.end();
    await client.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed-search-service] ${message}`);
  process.exitCode = 1;
});
