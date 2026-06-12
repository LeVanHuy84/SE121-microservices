import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

type GeneratedUser = {
  userId: string;
  email?: string;
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type Replacement = {
  path: string;
  from: string;
  to: string;
};

const DATA_DIR = resolve(__dirname, '../data');
const GROUP_SEED_FILE = resolve(DATA_DIR, 'group-seed.json');
const GENERATED_USERS_FILE = resolve(DATA_DIR, 'generated-users.json');
const USER_ID_REGEX = /^user_[A-Za-z0-9]+$/;
const DRY_RUN = process.argv.includes('--dry-run');

async function loadJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

function collectExistingGroupUserIds(value: JsonValue, userIds = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExistingGroupUserIds(item, userIds);
    }
    return userIds;
  }

  if (!value || typeof value !== 'object') {
    return userIds;
  }

  for (const [key, fieldValue] of Object.entries(value)) {
    if (key === 'userId' && typeof fieldValue === 'string') {
      userIds.add(fieldValue);
    }
    collectExistingGroupUserIds(fieldValue, userIds);
  }

  return userIds;
}

function buildReplacementMapper(
  groupSeed: JsonValue,
  generatedUserIds: string[],
  validUserIds: Set<string>,
) {
  const invalidToValid = new Map<string, string>();
  const usedUserIds = new Set(
    [...collectExistingGroupUserIds(groupSeed)].filter((id) => validUserIds.has(id)),
  );

  return (sourceId: string) => {
    if (validUserIds.has(sourceId) || !USER_ID_REGEX.test(sourceId)) {
      return sourceId;
    }

    const existingReplacement = invalidToValid.get(sourceId);
    if (existingReplacement) {
      return existingReplacement;
    }

    const nextUnusedUserId =
      generatedUserIds.find((userId) => !usedUserIds.has(userId)) ??
      generatedUserIds[invalidToValid.size % generatedUserIds.length];

    invalidToValid.set(sourceId, nextUnusedUserId);
    usedUserIds.add(nextUnusedUserId);

    return nextUnusedUserId;
  };
}

function replaceInvalidUserIds(
  value: JsonValue,
  mapUserId: (userId: string) => string,
  replacements: Replacement[],
  path: string[] = [],
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      replaceInvalidUserIds(item, mapUserId, replacements, [...path, String(index)]),
    );
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const updated: Record<string, JsonValue> = {};

  for (const [key, fieldValue] of Object.entries(value)) {
    if (key === 'userId' && typeof fieldValue === 'string') {
      const newUserId = mapUserId(fieldValue);
      updated[key] = newUserId;

      if (newUserId !== fieldValue) {
        replacements.push({
          path: [...path, key].join('.'),
          from: fieldValue,
          to: newUserId,
        });
      }

      continue;
    }

    updated[key] = replaceInvalidUserIds(fieldValue, mapUserId, replacements, [
      ...path,
      key,
    ]);
  }

  return updated;
}

async function main() {
  const [groupSeed, generatedUsers] = await Promise.all([
    loadJson<JsonValue>(GROUP_SEED_FILE),
    loadJson<GeneratedUser[]>(GENERATED_USERS_FILE),
  ]);
  const generatedUserIds = generatedUsers.map((user) => user.userId).filter(Boolean);
  const validUserIds = new Set(generatedUserIds);

  if (!generatedUserIds.length) {
    throw new Error('generated-users.json does not contain any userId values.');
  }

  const mapUserId = buildReplacementMapper(groupSeed, generatedUserIds, validUserIds);
  const replacements: Replacement[] = [];
  const updatedGroupSeed = replaceInvalidUserIds(groupSeed, mapUserId, replacements);

  if (!DRY_RUN && replacements.length > 0) {
    await fs.writeFile(
      GROUP_SEED_FILE,
      `${JSON.stringify(updatedGroupSeed, null, 2)}\n`,
      'utf-8',
    );
  }

  process.stdout.write(
    `${DRY_RUN ? 'Would replace' : 'Replaced'} ${replacements.length} invalid userId entries in group-seed.json.\n`,
  );

  for (const replacement of replacements) {
    process.stdout.write(
      `- ${replacement.path}: ${replacement.from} -> ${replacement.to}\n`,
    );
  }
}

main().catch((error) => {
  console.error('[fix-group-user-ids] Error:', error);
  process.exit(1);
});
