#!/usr/bin/env node

/**
 * seed-data/clerk/create-clerk-users.js
 *
 * Tạo demo users trên Clerk từ CSV rồi ghi kết quả (userId + email) vào
 * seed-data/data/generated-users.json — file này là source-of-truth cho
 * tất cả seed scripts khác.
 *
 * Usage (chạy từ root monorepo):
 *   node seed-data/clerk/create-clerk-users.js [options] [csv-path]
 *
 * Options:
 *   --limit=N        Số lượng user lấy từ CSV (default: 70)
 *   --reset          Xóa user cũ theo email trước khi tạo lại
 *   --reset-only     Chỉ xóa, không tạo mới
 *   --reset-all      Xóa toàn bộ email trong CSV (bỏ qua limit)
 *
 * Env vars (đọc từ seed-data/clerk/.env):
 *   CLERK_SECRET_KEY   (bắt buộc)
 *   CLERK_API_BASE     (default: https://api.clerk.com/v1)
 *   DRY_RUN=1          Không gọi API thật, không ghi file
 *   MAX_USERS          Default cho limit
 *   RESET_BEFORE_CREATE=1
 *   RESET_ONLY=1
 *   RESET_ALL=1
 */

const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const CLERK_API_BASE = process.env.CLERK_API_BASE || 'https://api.clerk.com/v1';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';
const DEFAULT_LIMIT = Number.parseInt(process.env.MAX_USERS || '70', 10);

// Output file — source-of-truth cho toàn bộ seed scripts
const GENERATED_USERS_FILE = path.resolve(__dirname, '../data/generated-users.json');
const DEFAULT_CSV = path.resolve(__dirname, 'demo-clerk-users.csv');

function parseCliOptions() {
  const args = process.argv.slice(2);
  let csvArg = DEFAULT_CSV;
  let limit = Number.isFinite(DEFAULT_LIMIT) && DEFAULT_LIMIT > 0 ? DEFAULT_LIMIT : 70;
  let resetBeforeCreate = process.env.RESET_BEFORE_CREATE === '1';
  let resetOnly = process.env.RESET_ONLY === '1';
  let resetAll = process.env.RESET_ALL === '1';

  if (resetAll) {
    resetOnly = true;
    resetBeforeCreate = true;
  }

  for (const arg of args) {
    if (arg === '--reset') {
      resetBeforeCreate = true;
      continue;
    }

    if (arg === '--reset-only') {
      resetOnly = true;
      resetBeforeCreate = true;
      continue;
    }

    if (arg === '--reset-all') {
      resetAll = true;
      resetOnly = true;
      resetBeforeCreate = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const rawLimit = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(rawLimit) && rawLimit > 0) {
        limit = rawLimit;
      }
      continue;
    }

    if (!arg.startsWith('--')) {
      csvArg = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
    }
  }

  return { csvArg, limit, resetBeforeCreate, resetOnly, resetAll };
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

async function createClerkUser(record) {
  const payload = {
    first_name: record.first_name || undefined,
    last_name: record.last_name || undefined,
    username: record.username || undefined,
    email_address: [record.email],
    password: record.password,
    skip_password_checks: true,
    skip_password_requirement: false,
  };

  const response = await fetch(`${CLERK_API_BASE}/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (response.ok) {
    return { status: 'created', id: data.id || '', error: '' };
  }

  if (response.status === 409 || response.status === 422) {
    return {
      status: 'skipped',
      id: '',
      error: data.errors?.[0]?.message || 'user already exists or invalid input',
    };
  }

  return {
    status: 'failed',
    id: '',
    error: data.errors?.[0]?.message || `http_${response.status}`,
  };
}

async function findClerkUsersByEmail(email) {
  const response = await fetch(
    `${CLERK_API_BASE}/users?email_address=${encodeURIComponent(email)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      },
    },
  );

  if (!response.ok) {
    return { status: 'failed', users: [], error: `http_${response.status}` };
  }

  const data = await response.json().catch(() => []);
  const users = Array.isArray(data) ? data : [];

  if (users.length === 0) {
    return { status: 'not_found', users: [], error: '' };
  }

  return { status: 'found', users, error: '' };
}

async function deleteClerkUser(userId) {
  const response = await fetch(`${CLERK_API_BASE}/users/${userId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
    },
  });

  if (response.ok || response.status === 404) {
    return { status: 'deleted', error: '' };
  }

  const data = await response.json().catch(() => ({}));
  return {
    status: 'failed',
    error: data.errors?.[0]?.message || `http_${response.status}`,
  };
}

/**
 * Ghi danh sách users (userId + email) ra generated-users.json.
 * File này là source-of-truth để các seed script khác dùng.
 */
async function writeGeneratedUsers(entries) {
  const json = JSON.stringify(entries, null, 2);
  await fs.writeFile(GENERATED_USERS_FILE, json, 'utf8');
  console.log(`\nWrote ${entries.length} users to ${GENERATED_USERS_FILE}`);
}

async function main() {
  const { csvArg, limit, resetBeforeCreate, resetOnly, resetAll } = parseCliOptions();
  const csvContent = await fs.readFile(csvArg, 'utf8');
  const allRecords = parseCsv(csvContent);
  const records = resetAll ? allRecords : allRecords.slice(0, limit);

  if (allRecords.length === 0) {
    console.error(`No records found in CSV: ${csvArg}`);
    process.exit(1);
  }

  if (!DRY_RUN && !CLERK_SECRET_KEY) {
    console.error('Missing CLERK_SECRET_KEY environment variable.');
    process.exit(1);
  }

  let created = 0;
  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  // Danh sách user đã tạo thành công: { userId, email }
  const generatedUsers = [];

  console.log(`Using CSV: ${csvArg}`);
  console.log(`Limit: ${records.length}/${allRecords.length}${resetAll ? ' (all via reset-all)' : ''}`);
  console.log(`Reset before create: ${resetBeforeCreate ? 'yes' : 'no'}`);
  console.log(`Reset only: ${resetOnly ? 'yes' : 'no'}`);
  console.log(`Reset all: ${resetAll ? 'yes' : 'no'}`);
  console.log(`Dry run: ${DRY_RUN ? 'yes' : 'no'}`);
  console.log(`Output: ${GENERATED_USERS_FILE}`);
  console.log('');

  for (const record of records) {
    if (!record.email || (!record.password && !resetOnly)) {
      failed += 1;
      if (!record.email) {
        console.log('FAILED  (empty email) | missing email');
      } else {
        console.log(`FAILED  ${record.email} | missing password`);
      }
      continue;
    }

    if (DRY_RUN) {
      skipped += 1;
      const mode = resetAll
        ? 'reset-all'
        : resetOnly
          ? 'reset-only'
          : resetBeforeCreate
            ? 'reset+create'
            : 'create';
      console.log(`DRYRUN  ${record.email} | ${mode}`);
      continue;
    }

    if (resetBeforeCreate) {
      const existingUsersResult = await findClerkUsersByEmail(record.email);

      if (existingUsersResult.status === 'failed') {
        failed += 1;
        console.log(`FAILED  ${record.email} | find existing failed: ${existingUsersResult.error}`);
        continue;
      }

      if (existingUsersResult.status === 'found') {
        for (const user of existingUsersResult.users) {
          const deleteResult = await deleteClerkUser(user.id);
          if (deleteResult.status === 'failed') {
            console.log(`FAILED  ${record.email} | delete failed: ${deleteResult.error}`);
          } else {
            deleted += 1;
            console.log(`DELETED ${record.email} | ${user.id}`);
          }
        }
        // Chờ Clerk propagate deletion
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else if (resetOnly) {
        skipped += 1;
        console.log(`SKIPPED ${record.email} | user not found`);
      }
    }

    if (resetOnly) {
      continue;
    }

    const result = await createClerkUser(record);

    if (result.status === 'created') {
      created += 1;
      generatedUsers.push({ userId: result.id, email: record.email });
      console.log(`CREATED ${record.email} | ${result.id}`);
      continue;
    }

    if (result.status === 'skipped') {
      skipped += 1;
      console.log(`SKIPPED ${record.email} | ${result.error}`);
      // Thử lookup user hiện có để vẫn đưa vào generated-users
      const lookupResult = await findClerkUsersByEmail(record.email);
      if (lookupResult.status === 'found' && lookupResult.users[0]?.id) {
        generatedUsers.push({ userId: lookupResult.users[0].id, email: record.email });
      }
      continue;
    }

    failed += 1;
    console.log(`FAILED  ${record.email} | ${result.error}`);
  }

  console.log('');
  console.log('Summary');
  console.log(`- Total:   ${records.length}`);
  console.log(`- Deleted: ${deleted}`);
  console.log(`- Created: ${created}`);
  console.log(`- Skipped: ${skipped}`);
  console.log(`- Failed:  ${failed}`);

  // Ghi ra generated-users.json (chỉ khi không phải reset-only / dry-run)
  if (!DRY_RUN && !resetOnly && generatedUsers.length > 0) {
    await writeGeneratedUsers(generatedUsers);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
