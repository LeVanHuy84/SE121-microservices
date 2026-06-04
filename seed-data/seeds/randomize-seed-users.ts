import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

type GeneratedUser = {
  userId: string;
  email: string;
};

type JsonValue = unknown;

type ReplacementStats = {
  replaced: number;
  uniqueSourceIds: Set<string>;
};

const DATA_DIR = resolve(__dirname, '../data');
const GENERATED_USERS_FILE = resolve(DATA_DIR, 'generated-users.json');
const TARGET_FILES = [
  resolve(DATA_DIR, 'post-full.json'),
  resolve(DATA_DIR, 'post-group.json'),
  resolve(DATA_DIR, 'group-seed.json'),
];
const USER_ID_REGEX = /^user_[A-Za-z0-9]+$/;

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function shouldReplaceUserId(key: string, parentKey?: string): boolean {
  if (!key) {
    return false;
  }

  const userFields = new Set([
    'userId',
    'createdBy',
    'updatedBy',
    'inviteeId',
    'reporterId',
  ]);

  if (userFields.has(key)) {
    return true;
  }

  if (key === 'id' && parentKey === 'owner') {
    return true;
  }

  if (parentKey === 'inviters') {
    return true;
  }

  return false;
}

function buildUserIdMapper(availableIds: string[]) {
  const pool = shuffle([...availableIds]);
  const mapping = new Map<string, string>();

  return (sourceId: string) => {
    if (!USER_ID_REGEX.test(sourceId)) {
      return sourceId;
    }

    if (mapping.has(sourceId)) {
      return mapping.get(sourceId)!;
    }

    const nextId =
      pool.pop() ??
      availableIds[Math.floor(Math.random() * availableIds.length)];
    mapping.set(sourceId, nextId);
    return nextId;
  };
}

function replaceUserIds(
  value: JsonValue,
  mapper: (id: string) => string,
  stats: ReplacementStats,
  path: string[] = [],
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      replaceUserIds(item, mapper, stats, [...path, String(index)]),
    );
  }

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, JsonValue>;
    const result: Record<string, JsonValue> = {};

    for (const [key, fieldValue] of Object.entries(objectValue)) {
      result[key] = replaceUserIds(fieldValue, mapper, stats, [...path, key]);
    }

    return result;
  }

  if (typeof value === 'string') {
    const currentKey = path[path.length - 1] ?? '';
    const parentKey = path[path.length - 2];

    if (
      shouldReplaceUserId(currentKey, parentKey) &&
      USER_ID_REGEX.test(value)
    ) {
      const newUserId = mapper(value);
      if (newUserId !== value) {
        stats.replaced += 1;
        stats.uniqueSourceIds.add(value);
      }
      return newUserId;
    }
  }

  return value;
}

async function loadJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

async function main() {
  const generatedUsers = await loadJson<GeneratedUser[]>(GENERATED_USERS_FILE);
  const generatedUserIds = generatedUsers.map((user) => user.userId);

  if (!generatedUserIds.length) {
    throw new Error('generated-users.json is empty or invalid.');
  }

  const mapUserId = buildUserIdMapper(generatedUserIds);
  const stats: ReplacementStats = { replaced: 0, uniqueSourceIds: new Set() };

  for (const filePath of TARGET_FILES) {
    const rawData = await loadJson<JsonValue>(filePath);
    const updatedData = replaceUserIds(rawData, mapUserId, stats);
    await fs.writeFile(
      filePath,
      `${JSON.stringify(updatedData, null, 2)}\n`,
      'utf-8',
    );
    process.stdout.write(`Updated ${filePath}\n`);
  }

  process.stdout.write(
    `\nReplaced ${stats.replaced} userId entries across ${stats.uniqueSourceIds.size} unique source values.\n`,
  );
  process.stdout.write(
    `Mapped ${stats.uniqueSourceIds.size} placeholder user IDs to generated users.\n`,
  );
}

main().catch((error) => {
  console.error('[randomize-seed-users] Error:', error);
  process.exit(1);
});
