import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { createClerkClientFromEnv } = require('../clerk/lib/clerk-session-pool');

type GroupOwner = {
  id: string;
  fullName?: string;
  avatarUrl?: string;
};

type GroupSeedItem = {
  id: string;
  name: string;
  owner?: GroupOwner;
};

type ClerkUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  imageUrl?: string;
  emailAddresses?: Array<{ emailAddress?: string }>;
};

const DATA_DIR = resolve(__dirname, '../data');
const GROUP_SEED_FILE = resolve(DATA_DIR, 'group-seed.json');

function parseCliOptions() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
  }

  return options;
}

function normalizeFullName(user: ClerkUser): string {
  const pieces = [user.firstName, user.lastName].filter(
    (part): part is string =>
      typeof part === 'string' && part.trim().length > 0,
  );
  if (pieces.length > 0) {
    return pieces.join(' ').trim();
  }

  if (user.emailAddresses?.[0]?.emailAddress) {
    return user.emailAddresses[0].emailAddress.split('@')[0];
  }

  return 'Demo User';
}

function normalizeAvatarUrl(user: ClerkUser, fullName: string): string {
  if (typeof user.profileImageUrl === 'string' && user.profileImageUrl.trim()) {
    return user.profileImageUrl;
  }

  if (typeof user.imageUrl === 'string' && user.imageUrl.trim()) {
    return user.imageUrl;
  }

  return `https://api.dicebear.com/9.x/lorelei/svg?seed=${encodeURIComponent(fullName)}`;
}

async function loadJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

async function saveJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

async function fetchClerkUserById(
  clerkClient: any,
  userId: string,
): Promise<ClerkUser | null> {
  if (!userId) {
    return null;
  }

  try {
    const result = await clerkClient.users.getUserList({
      userId: [userId],
      limit: 1,
    });
    return Array.isArray(result?.data) && result.data.length > 0
      ? result.data[0]
      : null;
  } catch {
    return null;
  }
}

async function main() {
  const { dryRun } = parseCliOptions();
  const clerkClient = createClerkClientFromEnv();
  const groups = await loadJson<GroupSeedItem[]>(GROUP_SEED_FILE);

  let updatedCount = 0;
  const updatedGroups: GroupSeedItem[] = [];

  for (const group of groups) {
    if (!group.owner?.id) {
      updatedGroups.push(group);
      continue;
    }

    const clerkUser = await fetchClerkUserById(clerkClient, group.owner.id);
    if (!clerkUser) {
      console.warn(
        `[update-group-owner-profile] Clerk user not found for owner.id=${group.owner.id} in group=${group.id}`,
      );
      updatedGroups.push(group);
      continue;
    }

    const fullName = normalizeFullName(clerkUser);
    const avatarUrl = normalizeAvatarUrl(clerkUser, fullName);

    const normalizedOwner: GroupOwner = {
      id: clerkUser.id,
      fullName,
      avatarUrl,
    };

    if (
      group.owner.fullName !== normalizedOwner.fullName ||
      group.owner.avatarUrl !== normalizedOwner.avatarUrl ||
      group.owner.id !== normalizedOwner.id
    ) {
      updatedCount += 1;
    }

    updatedGroups.push({
      ...group,
      owner: normalizedOwner,
    });
  }

  if (dryRun) {
    console.log(
      `[update-group-owner-profile] dry-run complete, would update ${updatedCount} owner records.`,
    );
    return;
  }

  await saveJson(GROUP_SEED_FILE, updatedGroups);
  console.log(
    `[update-group-owner-profile] updated ${updatedCount} owner records in ${GROUP_SEED_FILE}`,
  );
}

main().catch((error) => {
  console.error('[update-group-owner-profile] Error:', error);
  process.exit(1);
});
