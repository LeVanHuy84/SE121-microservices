const { createClerkClient } = require('@clerk/backend');
const fs = require('node:fs');
const path = require('node:path');

let envLoaded = false;

function loadLocalEnv() {
  if (envLoaded) {
    return;
  }

  envLoaded = true;
  const envFilePath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envFilePath)) {
    return;
  }

  const content = fs.readFileSync(envFilePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalIndex = trimmed.indexOf('=');
    if (equalIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
  }
}

function createClerkClientFromEnv() {
  loadLocalEnv();

  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;

  if (!secretKey) {
    throw new Error('Missing CLERK_SECRET_KEY environment variable.');
  }

  return createClerkClient({
    secretKey,
    publishableKey,
  });
}

async function getClerkUserByEmail(clerkClient, email) {
  const normalizedEmail = typeof email === 'string' ? email.trim() : '';
  if (!normalizedEmail) {
    return null;
  }

  const result = await clerkClient.users.getUserList({
    emailAddress: [normalizedEmail],
    limit: 1,
  });

  return result?.data?.[0] || null;
}

class ClerkSessionTokenPool {
  constructor(clerkClient) {
    this.clerkClient = clerkClient;
    this.tokenByUserId = new Map();
    this.sessionIdByUserId = new Map();
  }

  async getTokenForUser(userId) {
    if (this.tokenByUserId.has(userId)) {
      return this.tokenByUserId.get(userId);
    }

    const session = await this.clerkClient.sessions.createSession({ userId });
    const token = await this.clerkClient.sessions.getToken(session.id);

    this.sessionIdByUserId.set(userId, session.id);
    this.tokenByUserId.set(userId, token.jwt);

    return token.jwt;
  }

  async revokeAll() {
    const sessionIds = Array.from(this.sessionIdByUserId.values());

    for (const sessionId of sessionIds) {
      try {
        await this.clerkClient.sessions.revokeSession(sessionId);
      } catch {
        // Ignore revoke errors to avoid masking the main script result.
      }
    }

    this.sessionIdByUserId.clear();
    this.tokenByUserId.clear();
  }
}

module.exports = {
  createClerkClientFromEnv,
  getClerkUserByEmail,
  ClerkSessionTokenPool,
};
