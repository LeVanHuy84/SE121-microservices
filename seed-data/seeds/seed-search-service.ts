import * as dotenv from 'dotenv';
import { Client } from '@elastic/elasticsearch';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

type RawGeneratedUser = {
  userId: string;
  email: string;
};

type RawGroupOwner = {
  id: string;
  fullName: string;
  avatarUrl?: string;
};

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
  owner?: RawGroupOwner;
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
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string;
  bio: string;
  createdAt: Date;
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
const USERS_FILE = resolve(__dirname, '../data/generated-users.json');
const POSTS_FILE = resolve(__dirname, '../data/post-full.json');
const GROUPS_FILE = resolve(__dirname, '../data/group-seed.json');
const ENV_CANDIDATES = [
  resolve(ROOT_DIR, 'apps/search-service/.env'),
  resolve(ROOT_DIR, 'apps/search-service/.env.local'),
];

function loadSearchServiceEnv(): string {
  for (const envFile of ENV_CANDIDATES) {
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

function loadJsonFile<T>(filePath: string, errorMessage: string): T {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(errorMessage);
  }

  return parsed as T;
}

function loadGeneratedUsers(): RawGeneratedUser[] {
  return loadJsonFile<RawGeneratedUser[]>(
    USERS_FILE,
    'generated-users.json must contain an array of users',
  );
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

function buildGroupOwnerLookup(
  rawGroups: RawGroupSeed[],
): Map<string, RawGroupOwner> {
  const lookup = new Map<string, RawGroupOwner>();

  for (const group of rawGroups) {
    if (group.owner) {
      lookup.set(group.owner.id, group.owner);
    }
  }

  return lookup;
}

function splitFullName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const [firstName = 'Demo', ...rest] = fullName.trim().split(/\s+/);

  return {
    firstName,
    lastName: rest.length > 0 ? rest.join(' ') : 'User',
  };
}

function buildUserDoc(
  rawUser: RawGeneratedUser,
  index: number,
  ownerLookup: Map<string, RawGroupOwner>,
): UserSeedDoc {
  const owner = ownerLookup.get(rawUser.userId);
  const localPart = rawUser.email.split('@')[0] ?? rawUser.userId;
  const numericSuffixMatch = localPart.match(/(\d+)$/);
  const numericSuffix =
    numericSuffixMatch?.[1] ?? String(index + 1).padStart(3, '0');
  const fullName = owner?.fullName ?? `Demo User ${numericSuffix}`;
  const { firstName, lastName } = splitFullName(fullName);
  const createdAt = new Date(Date.UTC(2026, 3, 1 + index, 9, 0, 0));

  return {
    id: rawUser.userId,
    email: rawUser.email,
    firstName,
    lastName,
    fullName,
    avatarUrl:
      owner?.avatarUrl ??
      `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(fullName)}`,
    bio: `Ho so demo cua ${fullName} phuc vu tim kiem trong search-service.`,
    createdAt,
  };
}

function buildUserDocuments(
  rawUsers: RawGeneratedUser[],
  rawGroups: RawGroupSeed[],
): UserSeedDoc[] {
  const ownerLookup = buildGroupOwnerLookup(rawGroups);

  return rawUsers.map((rawUser, index) =>
    buildUserDoc(rawUser, index, ownerLookup),
  );
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
  const envFile = loadSearchServiceEnv();
  const client = buildElasticClient();

  const rawUsers = loadGeneratedUsers();
  const rawPosts = loadRawPosts();
  const rawGroups = loadRawGroups();

  const userDocs = buildUserDocuments(rawUsers, rawGroups);
  const postDocs = buildPostDocuments(rawPosts);
  const groupDocs = buildGroupDocuments(rawGroups);

  try {
    await seedIndex(client, USER_INDEX, UserIndexMapping, userDocs);
    await seedIndex(client, POST_INDEX, PostMapping, postDocs);
    await seedIndex(client, GROUP_INDEX, GroupIndexMapping, groupDocs);

    console.log(
      `Seeded search-service from ${envFile}: ${userDocs.length} users, ${postDocs.length} posts, ${groupDocs.length} groups`,
    );
  } finally {
    await client.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed-search-service] ${message}`);
  process.exitCode = 1;
});
