#!/usr/bin/env node

/**
 * seed-data/clerk/simulate-social.js
 *
 * Mô phỏng hoạt động social (friend requests, accept/decline, block, recommend)
 * cho demo users bằng cách gọi API Gateway.
 *
 * Usage (chạy từ root monorepo):
 *   node seed-data/clerk/simulate-social.js [options] [csv-path]
 *
 * Options:
 *   --limit=N        Số lượng user từ CSV (default: 70)
 *   --rounds=N       Số vòng mô phỏng (default: 2)
 *   --seed=S         Seed random (default: timestamp)
 *   --api-base=URL   API Gateway base URL
 *   --dry-run        Không gọi API thật
 *
 * Env vars (đọc từ seed-data/clerk/.env):
 *   CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY
 *   API_BASE_URL, DRY_RUN=1, MAX_USERS, SOCIAL_ROUNDS, SEED
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  ClerkSessionTokenPool,
  createClerkClientFromEnv,
  getClerkUserByEmail,
} = require('./lib/clerk-session-pool');

const DEFAULT_API_BASE_URL = 'http://localhost:4000/api/v1';
const DEFAULT_CSV = path.resolve(__dirname, 'demo-clerk-users.csv');
const DEFAULT_LIMIT = positiveIntOrFallback(process.env.MAX_USERS, 70);
const DEFAULT_ROUNDS = positiveIntOrFallback(process.env.SOCIAL_ROUNDS, 2);
const DEFAULT_SEED = process.env.SEED || `${Date.now()}`;

function positiveIntOrFallback(value, fallback) {
  const parsed = Number.parseInt(`${value ?? ''}`, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanFlag(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseCliOptions() {
  const args = process.argv.slice(2);
  const options = {
    csvArg: DEFAULT_CSV,
    limit: DEFAULT_LIMIT,
    rounds: DEFAULT_ROUNDS,
    seed: DEFAULT_SEED,
    dryRun: parseBooleanFlag(process.env.DRY_RUN),
    apiBaseUrl: process.env.API_BASE_URL || DEFAULT_API_BASE_URL,
  };

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      options.limit = positiveIntOrFallback(arg.slice('--limit='.length), options.limit);
      continue;
    }

    if (arg.startsWith('--rounds=')) {
      options.rounds = positiveIntOrFallback(arg.slice('--rounds='.length), options.rounds);
      continue;
    }

    if (arg.startsWith('--seed=')) {
      const value = arg.slice('--seed='.length).trim();
      options.seed = value || options.seed;
      continue;
    }

    if (arg.startsWith('--api-base=')) {
      const value = arg.slice('--api-base='.length).trim();
      options.apiBaseUrl = value || options.apiBaseUrl;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      options.csvArg = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
    }
  }

  return options;
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
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((value) => value.trim());
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    return row;
  });
}

function createSeededRandom(seedInput) {
  const source = `${seedInput}`;
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  let state = hash >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom(items, random) {
  return items[Math.floor(random() * items.length)];
}

function pickDistinctPair(users, random) {
  if (users.length < 2) {
    return null;
  }

  const actor = pickRandom(users, random);
  let target = pickRandom(users, random);
  let retries = 0;

  while (target.userId === actor.userId && retries < 10) {
    target = pickRandom(users, random);
    retries += 1;
  }

  if (actor.userId === target.userId) {
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

function createCounters() {
  return {
    requestSent: 0,
    requestSkipped: 0,
    requestAccepted: 0,
    requestDeclined: 0,
    friendRemoved: 0,
    userBlocked: 0,
    userUnblocked: 0,
    recommendationAccepted: 0,
    recommendationDismissed: 0,
    errors: 0,
  };
}

function printBanner({ csvPath, recordsCount, usersCount, rounds, seed, dryRun, apiBaseUrl }) {
  console.log(`Using CSV: ${csvPath}`);
  console.log(`Users loaded: ${usersCount}/${recordsCount}`);
  console.log(`Rounds: ${rounds}`);
  console.log(`Seed: ${seed}`);
  console.log(`API base: ${apiBaseUrl}`);
  console.log(`Dry run: ${dryRun ? 'yes' : 'no'}`);
  console.log('');
}

function printDryRunPlan({ usersCount, rounds }) {
  console.log('DRYRUN plan:');
  console.log(`- Random request actions: ${usersCount * rounds * 2}`);
  console.log('- Process incoming requests for each user per round');
  console.log('- Process friend recommendations (accept/dismiss)');
  console.log('- Remove/block/unblock random relationships');
}

function printSummary(counters) {
  console.log('');
  console.log('Social Activity Summary');
  console.log(`- Friend requests sent:        ${counters.requestSent}`);
  console.log(`- Friend requests skipped:     ${counters.requestSkipped}`);
  console.log(`- Requests accepted:           ${counters.requestAccepted}`);
  console.log(`- Requests declined:           ${counters.requestDeclined}`);
  console.log(`- Friends removed:             ${counters.friendRemoved}`);
  console.log(`- Users blocked:               ${counters.userBlocked}`);
  console.log(`- Users unblocked:             ${counters.userUnblocked}`);
  console.log(`- Recommend requests sent:     ${counters.recommendationAccepted}`);
  console.log(`- Recommend dismissed:         ${counters.recommendationDismissed}`);
  console.log(`- Errors:                      ${counters.errors}`);
}

function logApiSuccess(method, endpoint, status, context = '') {
  const suffix = context ? ` | ${context}` : '';
  console.log(`[OK] ${method} ${endpoint} -> ${status}${suffix}`);
}

function logApiFailure(method, endpoint, status, payload, context = '') {
  const suffix = context ? ` | ${context}` : '';
  const detail = payload ? ` | payload=${JSON.stringify(payload)}` : '';
  console.warn(`[FAIL] ${method} ${endpoint} -> ${status}${suffix}${detail}`);
}

async function apiRequest(apiBaseUrl, authToken, method, endpoint, body) {
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload;

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

async function apiRequestForUser(tokenPool, apiBaseUrl, userId, method, endpoint, body) {
  const authToken = await tokenPool.getTokenForUser(userId);
  return apiRequest(apiBaseUrl, authToken, method, endpoint, body);
}

async function resolveUsersFromCsv(clerkClient, records) {
  const users = [];

  for (const record of records) {
    const email = typeof record.email === 'string' ? record.email.trim() : '';
    if (!email) {
      continue;
    }

    const user = await getClerkUserByEmail(clerkClient, email);
    if (!user?.id) {
      continue;
    }

    users.push({
      email,
      userId: user.id,
    });
  }

  return users;
}

async function simulateFriendRequestRound({ users, tokenPool, random, counters, apiBaseUrl }) {
  const requestActions = users.length * 2;

  for (let index = 0; index < requestActions; index += 1) {
    const pair = pickDistinctPair(users, random);
    if (!pair) {
      counters.requestSkipped += 1;
      continue;
    }

    const endpoint = `/social/request/${pair.target.userId}`;

    try {
      const result = await apiRequestForUser(
        tokenPool,
        apiBaseUrl,
        pair.actor.userId,
        'POST',
        endpoint,
        {},
      );

      if (result.ok) {
        counters.requestSent += 1;
        logApiSuccess('POST', endpoint, result.status, `actor=${pair.actor.email} target=${pair.target.email}`);
      } else {
        counters.requestSkipped += 1;
        logApiFailure('POST', endpoint, result.status, result.payload, `actor=${pair.actor.email} target=${pair.target.email}`);
      }
    } catch (error) {
      counters.errors += 1;
      console.error(`[ERROR] POST ${endpoint} | actor=${pair.actor.email} target=${pair.target.email}`, error);
    }
  }
}

async function processIncomingRequestsRound({ users, tokenPool, random, counters, apiBaseUrl }) {
  for (const user of users) {
    const listEndpoint = '/social/requests?limit=20';
    let listResult;

    try {
      listResult = await apiRequestForUser(
        tokenPool,
        apiBaseUrl,
        user.userId,
        'GET',
        listEndpoint,
      );
    } catch (error) {
      counters.errors += 1;
      console.error(`[ERROR] GET ${listEndpoint} | actor=${user.email}`, error);
      continue;
    }

    if (!listResult.ok) {
      counters.errors += 1;
      logApiFailure('GET', listEndpoint, listResult.status, listResult.payload, `actor=${user.email}`);
      continue;
    }

    logApiSuccess('GET', listEndpoint, listResult.status, `actor=${user.email}`);

    const requesterIds = extractArrayData(listResult.payload).filter(
      (item) => typeof item === 'string' && item.trim().length > 0,
    );

    for (const requesterId of requesterIds) {
      const shouldAccept = random() < 0.75;
      const endpoint = shouldAccept
        ? `/social/accept/${requesterId}`
        : `/social/decline/${requesterId}`;

      try {
        const decisionResult = await apiRequestForUser(
          tokenPool,
          apiBaseUrl,
          user.userId,
          'POST',
          endpoint,
          {},
        );

        if (!decisionResult.ok) {
          counters.errors += 1;
          logApiFailure('POST', endpoint, decisionResult.status, decisionResult.payload, `actor=${user.email}`);
          continue;
        }

        logApiSuccess('POST', endpoint, decisionResult.status, `actor=${user.email}`);

        if (shouldAccept) {
          counters.requestAccepted += 1;
        } else {
          counters.requestDeclined += 1;
        }
      } catch (error) {
        counters.errors += 1;
        console.error(`[ERROR] POST ${endpoint} | actor=${user.email}`, error);
      }
    }
  }
}

async function simulateRecommendationsRound({ users, tokenPool, random, counters, apiBaseUrl }) {
  for (const user of users) {
    if (random() < 0.5) {
      continue;
    }

    const recEndpoint = '/social/friends/recommend?limit=5';
    let recResult;

    try {
      recResult = await apiRequestForUser(
        tokenPool,
        apiBaseUrl,
        user.userId,
        'GET',
        recEndpoint,
      );
    } catch (error) {
      counters.errors += 1;
      console.error(`[ERROR] GET ${recEndpoint} | actor=${user.email}`, error);
      continue;
    }

    if (!recResult.ok) {
      counters.errors += 1;
      logApiFailure('GET', recEndpoint, recResult.status, recResult.payload, `actor=${user.email}`);
      continue;
    }

    logApiSuccess('GET', recEndpoint, recResult.status, `actor=${user.email}`);

    const recommendations = extractArrayData(recResult.payload);

    for (const rec of recommendations) {
      if (!rec || !rec.candidateId) {
        continue;
      }

      const shouldRequest = random() < 0.6;
      const body = {
        recommendationId: rec.recommendationId,
        recommendationRequestId: rec.recommendationRequestId,
      };

      if (shouldRequest) {
        const reqEndpoint = `/social/request/${rec.candidateId}`;
        try {
          const reqResult = await apiRequestForUser(
            tokenPool,
            apiBaseUrl,
            user.userId,
            'POST',
            reqEndpoint,
            body,
          );

          if (reqResult.ok) {
            counters.recommendationAccepted += 1;
            counters.requestSent += 1;
            logApiSuccess('POST', reqEndpoint, reqResult.status, `actor=${user.email} (recommendation)`);
          } else {
            counters.errors += 1;
            logApiFailure('POST', reqEndpoint, reqResult.status, reqResult.payload, `actor=${user.email}`);
          }
        } catch (error) {
          counters.errors += 1;
          console.error(`[ERROR] POST ${reqEndpoint} | actor=${user.email}`, error);
        }
      } else {
        const disEndpoint = `/social/friends/recommend/dismiss/${rec.candidateId}`;
        try {
          const disResult = await apiRequestForUser(
            tokenPool,
            apiBaseUrl,
            user.userId,
            'POST',
            disEndpoint,
            body,
          );

          if (disResult.ok) {
            counters.recommendationDismissed += 1;
            logApiSuccess('POST', disEndpoint, disResult.status, `actor=${user.email} (dismissed)`);
          } else {
            counters.errors += 1;
            logApiFailure('POST', disEndpoint, disResult.status, disResult.payload, `actor=${user.email}`);
          }
        } catch (error) {
          counters.errors += 1;
          console.error(`[ERROR] POST ${disEndpoint} | actor=${user.email}`, error);
        }
      }
    }
  }
}

async function mutateRelationshipsRound({ users, tokenPool, random, counters, apiBaseUrl }) {
  for (const user of users) {
    if (random() < 0.2) {
      const pair = pickDistinctPair(users, random);
      if (pair) {
        const blockEndpoint = `/social/block/${pair.target.userId}`;

        try {
          const blockResult = await apiRequestForUser(
            tokenPool,
            apiBaseUrl,
            user.userId,
            'POST',
            blockEndpoint,
            {},
          );

          if (blockResult.ok) {
            counters.userBlocked += 1;
            logApiSuccess('POST', blockEndpoint, blockResult.status, `actor=${user.email} target=${pair.target.email}`);

            if (random() < 0.5) {
              const unblockEndpoint = `/social/unblock/${pair.target.userId}`;
              const unblockResult = await apiRequestForUser(
                tokenPool,
                apiBaseUrl,
                user.userId,
                'POST',
                unblockEndpoint,
                {},
              );

              if (unblockResult.ok) {
                counters.userUnblocked += 1;
                logApiSuccess('POST', unblockEndpoint, unblockResult.status, `actor=${user.email} target=${pair.target.email}`);
              } else {
                counters.errors += 1;
                logApiFailure('POST', unblockEndpoint, unblockResult.status, unblockResult.payload, `actor=${user.email} target=${pair.target.email}`);
              }
            }
          } else {
            counters.errors += 1;
            logApiFailure('POST', blockEndpoint, blockResult.status, blockResult.payload, `actor=${user.email} target=${pair.target.email}`);
          }
        } catch (error) {
          counters.errors += 1;
          console.error(`[ERROR] POST ${blockEndpoint} | actor=${user.email} target=${pair.target.email}`, error);
        }
      }
    }

    if (random() < 0.25) {
      const friendsEndpoint = '/social/friends/me?limit=20';
      let friendsResult;

      try {
        friendsResult = await apiRequestForUser(
          tokenPool,
          apiBaseUrl,
          user.userId,
          'GET',
          friendsEndpoint,
        );
      } catch (error) {
        counters.errors += 1;
        console.error(`[ERROR] GET ${friendsEndpoint} | actor=${user.email}`, error);
        continue;
      }

      if (!friendsResult.ok) {
        counters.errors += 1;
        logApiFailure('GET', friendsEndpoint, friendsResult.status, friendsResult.payload, `actor=${user.email}`);
        continue;
      }

      logApiSuccess('GET', friendsEndpoint, friendsResult.status, `actor=${user.email}`);

      const friendIds = extractArrayData(friendsResult.payload).filter(
        (item) => typeof item === 'string' && item.trim().length > 0,
      );

      if (friendIds.length === 0) {
        continue;
      }

      const friendId = pickRandom(friendIds, random);
      const removeEndpoint = `/social/remove/${friendId}`;

      try {
        const removeResult = await apiRequestForUser(
          tokenPool,
          apiBaseUrl,
          user.userId,
          'POST',
          removeEndpoint,
          {},
        );

        if (removeResult.ok) {
          counters.friendRemoved += 1;
          logApiSuccess('POST', removeEndpoint, removeResult.status, `actor=${user.email}`);
        } else {
          counters.errors += 1;
          logApiFailure('POST', removeEndpoint, removeResult.status, removeResult.payload, `actor=${user.email}`);
        }
      } catch (error) {
        counters.errors += 1;
        console.error(`[ERROR] POST ${removeEndpoint} | actor=${user.email}`, error);
      }
    }
  }
}

async function run() {
  const options = parseCliOptions();
  const csvContent = await fs.readFile(options.csvArg, 'utf8');
  const allRecords = parseCsv(csvContent);
  const records = allRecords.slice(0, options.limit);

  if (allRecords.length === 0) {
    throw new Error(`No records found in CSV: ${options.csvArg}`);
  }

  const clerkClient = createClerkClientFromEnv();
  const users = await resolveUsersFromCsv(clerkClient, records);

  if (users.length < 2) {
    throw new Error('Need at least 2 valid users from CSV to simulate social activity.');
  }

  printBanner({
    csvPath: options.csvArg,
    recordsCount: records.length,
    usersCount: users.length,
    rounds: options.rounds,
    seed: options.seed,
    dryRun: options.dryRun,
    apiBaseUrl: options.apiBaseUrl,
  });

  if (options.dryRun) {
    printDryRunPlan({ usersCount: users.length, rounds: options.rounds });
    return;
  }

  const random = createSeededRandom(options.seed);
  const counters = createCounters();
  const tokenPool = new ClerkSessionTokenPool(clerkClient);

  try {
    for (let round = 0; round < options.rounds; round += 1) {
      console.log(`Starting round ${round + 1}/${options.rounds}`);

      await simulateFriendRequestRound({
        users,
        tokenPool,
        random,
        counters,
        apiBaseUrl: options.apiBaseUrl,
      });

      await processIncomingRequestsRound({
        users,
        tokenPool,
        random,
        counters,
        apiBaseUrl: options.apiBaseUrl,
      });

      await simulateRecommendationsRound({
        users,
        tokenPool,
        random,
        counters,
        apiBaseUrl: options.apiBaseUrl,
      });

      await mutateRelationshipsRound({
        users,
        tokenPool,
        random,
        counters,
        apiBaseUrl: options.apiBaseUrl,
      });

      console.log(`Round ${round + 1}/${options.rounds} completed`);
    }
  } finally {
    await tokenPool.revokeAll();
  }

  printSummary(counters);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
