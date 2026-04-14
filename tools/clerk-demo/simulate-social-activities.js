#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  ClerkSessionTokenPool,
  createClerkClientFromEnv,
  getClerkUserByEmail,
} = require('./lib/clerk-session-pool');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000/api/v1';
const DRY_RUN = process.env.DRY_RUN === '1';
const DEFAULT_LIMIT = Number.parseInt(process.env.MAX_USERS || '70', 10);
const DEFAULT_ROUNDS = Number.parseInt(process.env.SOCIAL_ROUNDS || '2', 10);
const DEFAULT_SEED = process.env.SEED || `${Date.now()}`;

function parseCliOptions() {
  const args = process.argv.slice(2);
  let csvArg = 'tools/clerk-demo/demo-clerk-users.csv';
  let limit = Number.isFinite(DEFAULT_LIMIT) && DEFAULT_LIMIT > 0 ? DEFAULT_LIMIT : 70;
  let rounds = Number.isFinite(DEFAULT_ROUNDS) && DEFAULT_ROUNDS > 0 ? DEFAULT_ROUNDS : 2;
  let seed = DEFAULT_SEED;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      const rawLimit = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(rawLimit) && rawLimit > 0) {
        limit = rawLimit;
      }
      continue;
    }

    if (arg.startsWith('--rounds=')) {
      const rawRounds = Number.parseInt(arg.slice('--rounds='.length), 10);
      if (Number.isFinite(rawRounds) && rawRounds > 0) {
        rounds = rawRounds;
      }
      continue;
    }

    if (arg.startsWith('--seed=')) {
      seed = arg.slice('--seed='.length) || seed;
      continue;
    }

    if (!arg.startsWith('--')) {
      csvArg = arg;
    }
  }

  return { csvArg, limit, rounds, seed };
}

function parseCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = lines[0].split(',').map((header) => header.trim());
  const rows = [];

  for (let index = 1; index < lines.length; index += 1) {
    const values = lines[index].split(',').map((value) => value.trim());
    const row = {};

    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex] || '';
    });

    rows.push(row);
  }

  return rows;
}

function createSeededRandom(seedInput) {
  const source = `${seedInput}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  let state = hash >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom(array, random) {
  return array[Math.floor(random() * array.length)];
}

function pickDistinctPair(users, random) {
  if (users.length < 2) {
    return null;
  }

  const actor = pickRandom(users, random);
  let target = pickRandom(users, random);
  let attempts = 0;

  while (target.userId === actor.userId && attempts < 10) {
    target = pickRandom(users, random);
    attempts += 1;
  }

  if (target.userId === actor.userId) {
    return null;
  }

  return { actor, target };
}

function extractArrayData(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
}

async function apiRequest(authToken, method, endpoint, body) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

async function resolveUsers(clerkClient, records) {
  const users = [];

  for (const record of records) {
    if (!record.email) {
      continue;
    }

    const user = await getClerkUserByEmail(clerkClient, record.email);
    if (!user?.id) {
      continue;
    }

    users.push({
      email: record.email,
      userId: user.id,
    });
  }

  return users;
}

async function run() {
  const { csvArg, limit, rounds, seed } = parseCliOptions();
  const csvPath = path.resolve(process.cwd(), csvArg);
  const csvContent = await fs.readFile(csvPath, 'utf8');
  const allRecords = parseCsv(csvContent);
  const records = allRecords.slice(0, limit);

  if (allRecords.length === 0) {
    console.error(`No records found in CSV: ${csvPath}`);
    process.exit(1);
  }

  const clerkClient = createClerkClientFromEnv();
  const tokenPool = new ClerkSessionTokenPool(clerkClient);
  const random = createSeededRandom(seed);

  const users = await resolveUsers(clerkClient, records);
  if (users.length < 2) {
    console.error('Need at least 2 valid users from CSV to simulate social activity.');
    process.exit(1);
  }

  console.log(`Using CSV: ${csvPath}`);
  console.log(`Users loaded: ${users.length}/${records.length}`);
  console.log(`Rounds: ${rounds}`);
  console.log(`Seed: ${seed}`);
  console.log(`Dry run: ${DRY_RUN ? 'yes' : 'no'}`);
  console.log('');

  const counters = {
    requestSent: 0,
    requestSkipped: 0,
    requestAccepted: 0,
    requestDeclined: 0,
    recommendationDismissed: 0,
    friendRemoved: 0,
    userBlocked: 0,
    userUnblocked: 0,
    errors: 0,
  };

  if (DRY_RUN) {
    console.log('DRYRUN plan:');
    console.log(`- Random request actions: ${users.length * rounds * 2}`);
    console.log(`- Process incoming requests for each user per round`);
    console.log(`- Dismiss recommendation candidates with random probability`);
    console.log(`- Remove/block/unblock random relationships`);
    return;
  }

  try {
    const tokenByUserId = new Map();
    for (const user of users) {
      const token = await tokenPool.getTokenForUser(user.userId);
      tokenByUserId.set(user.userId, token);
    }

    for (let round = 0; round < rounds; round += 1) {
      const requestActions = users.length * 2;

      for (let i = 0; i < requestActions; i += 1) {
        const pair = pickDistinctPair(users, random);
        if (!pair) {
          counters.requestSkipped += 1;
          continue;
        }

        const actorToken = tokenByUserId.get(pair.actor.userId);
        const requestResult = await apiRequest(
          actorToken,
          'POST',
          `/social/request/${pair.target.userId}`,
          {},
        );

        if (requestResult.ok) {
          counters.requestSent += 1;
        } else {
          counters.requestSkipped += 1;
        }
      }

      for (const user of users) {
        const actorToken = tokenByUserId.get(user.userId);
        const requestResult = await apiRequest(
          actorToken,
          'GET',
          '/social/requests?limit=20',
        );

        if (!requestResult.ok) {
          counters.errors += 1;
          continue;
        }

        const requesterIds = extractArrayData(requestResult.payload).filter(
          (item) => typeof item === 'string' && item.trim().length > 0,
        );

        for (const requesterId of requesterIds) {
          const shouldAccept = random() < 0.75;
          const endpoint = shouldAccept
            ? `/social/accept/${requesterId}`
            : `/social/decline/${requesterId}`;

          const decisionResult = await apiRequest(actorToken, 'POST', endpoint, {});
          if (!decisionResult.ok) {
            counters.errors += 1;
            continue;
          }

          if (shouldAccept) {
            counters.requestAccepted += 1;
          } else {
            counters.requestDeclined += 1;
          }
        }
      }

      for (const user of users) {
        if (random() >= 0.55) {
          continue;
        }

        const actorToken = tokenByUserId.get(user.userId);
        const recommendResult = await apiRequest(
          actorToken,
          'GET',
          '/social/friends/recommend?limit=10',
        );

        if (!recommendResult.ok) {
          counters.errors += 1;
          continue;
        }

        const candidates = extractArrayData(recommendResult.payload).filter(
          (item) => item && typeof item.id === 'string',
        );

        const dismissCount = Math.min(candidates.length, 1 + Math.floor(random() * 2));
        for (let i = 0; i < dismissCount; i += 1) {
          const candidate = candidates[i];
          const dismissResult = await apiRequest(
            actorToken,
            'POST',
            `/social/friends/recommend/dismiss/${candidate.id}`,
            {
              recommendationId: candidate.recommendationId,
              recommendationRequestId: candidate.recommendationRequestId,
            },
          );

          if (dismissResult.ok) {
            counters.recommendationDismissed += 1;
          } else {
            counters.errors += 1;
          }
        }
      }

      for (const user of users) {
        const actorToken = tokenByUserId.get(user.userId);

        if (random() < 0.2) {
          const pair = pickDistinctPair(users, random);
          if (pair) {
            const blockResult = await apiRequest(
              actorToken,
              'POST',
              `/social/block/${pair.target.userId}`,
              {},
            );
            if (blockResult.ok) {
              counters.userBlocked += 1;

              if (random() < 0.5) {
                const unblockResult = await apiRequest(
                  actorToken,
                  'POST',
                  `/social/unblock/${pair.target.userId}`,
                  {},
                );
                if (unblockResult.ok) {
                  counters.userUnblocked += 1;
                } else {
                  counters.errors += 1;
                }
              }
            } else {
              counters.errors += 1;
            }
          }
        }

        if (random() < 0.25) {
          const friendsResult = await apiRequest(
            actorToken,
            'GET',
            '/social/friends/me?limit=20',
          );

          if (!friendsResult.ok) {
            counters.errors += 1;
            continue;
          }

          const friendIds = extractArrayData(friendsResult.payload).filter(
            (item) => typeof item === 'string' && item.trim().length > 0,
          );

          if (friendIds.length > 0) {
            const friendId = pickRandom(friendIds, random);
            const removeResult = await apiRequest(
              actorToken,
              'POST',
              `/social/remove/${friendId}`,
              {},
            );

            if (removeResult.ok) {
              counters.friendRemoved += 1;
            } else {
              counters.errors += 1;
            }
          }
        }
      }

      console.log(`Round ${round + 1}/${rounds} completed`);
    }
  } finally {
    await tokenPool.revokeAll();
  }

  console.log('');
  console.log('Social Activity Summary');
  console.log(`- Friend requests sent:        ${counters.requestSent}`);
  console.log(`- Friend requests skipped:     ${counters.requestSkipped}`);
  console.log(`- Requests accepted:           ${counters.requestAccepted}`);
  console.log(`- Requests declined:           ${counters.requestDeclined}`);
  console.log(`- Recommendation dismissed:    ${counters.recommendationDismissed}`);
  console.log(`- Friends removed:             ${counters.friendRemoved}`);
  console.log(`- Users blocked:               ${counters.userBlocked}`);
  console.log(`- Users unblocked:             ${counters.userUnblocked}`);
  console.log(`- Errors:                      ${counters.errors}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
