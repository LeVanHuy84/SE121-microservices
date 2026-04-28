#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const CLERK_API_BASE = process.env.CLERK_API_BASE || 'https://api.clerk.com/v1';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';
const DEFAULT_LIMIT = Number.parseInt(process.env.MAX_USERS || '70', 10);

function parseCliOptions() {
  const args = process.argv.slice(2);
  let csvArg = 'tools/clerk-demo/demo-clerk-users.csv';
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
      csvArg = arg;
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

async function findClerkUserByEmail(email) {
  const response = await fetch(
    `${CLERK_API_BASE}/users?limit=1&email_address[]=${encodeURIComponent(email)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      },
    },
  );

  if (!response.ok) {
    return { status: 'failed', id: '', error: `http_${response.status}` };
  }

  const data = await response.json().catch(() => []);
  const user = Array.isArray(data) ? data[0] : null;

  if (!user?.id) {
    return { status: 'not_found', id: '', error: '' };
  }

  return { status: 'found', id: user.id, error: '' };
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

async function main() {
  const { csvArg, limit, resetBeforeCreate, resetOnly, resetAll } =
    parseCliOptions();
  const csvPath = path.resolve(process.cwd(), csvArg);
  const csvContent = await fs.readFile(csvPath, 'utf8');
  const allRecords = parseCsv(csvContent);
  const records = resetAll ? allRecords : allRecords.slice(0, limit);

  if (allRecords.length === 0) {
    console.error(`No records found in CSV: ${csvPath}`);
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

  console.log(`Using CSV: ${csvPath}`);
  console.log(`Limit: ${records.length}/${allRecords.length}${resetAll ? ' (all via reset-all)' : ''}`);
  console.log(`Reset before create: ${resetBeforeCreate ? 'yes' : 'no'}`);
  console.log(`Reset only: ${resetOnly ? 'yes' : 'no'}`);
  console.log(`Reset all: ${resetAll ? 'yes' : 'no'}`);
  console.log(`Dry run: ${DRY_RUN ? 'yes' : 'no'}`);
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
      const existingUser = await findClerkUserByEmail(record.email);

      if (existingUser.status === 'failed') {
        failed += 1;
        console.log(`FAILED  ${record.email} | find existing failed: ${existingUser.error}`);
        continue;
      }

      if (existingUser.status === 'found') {
        const deleteResult = await deleteClerkUser(existingUser.id);
        if (deleteResult.status === 'failed') {
          failed += 1;
          console.log(`FAILED  ${record.email} | delete failed: ${deleteResult.error}`);
          continue;
        }

        deleted += 1;
        console.log(`DELETED ${record.email} | ${existingUser.id}`);
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
      console.log(`CREATED ${record.email} | ${result.id}`);
      continue;
    }

    if (result.status === 'skipped') {
      skipped += 1;
      console.log(`SKIPPED ${record.email} | ${result.error}`);
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
