const { createClerkClient } = require('@clerk/backend');
const fs = require('node:fs');
const path = require('node:path');

let envLoaded = false;

function loadLocalEnv() {
  if (envLoaded) {
    return;
  }

  envLoaded = true;
  // .env lives one level up from lib/, i.e. seed-data/clerk/.env
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
    let value = trimmed.slice(equalIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

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
    this.sessionIdByUserId = new Map();
  }

  async createSessionForUser(userId) {
    const session = await this.clerkClient.sessions.createSession({ userId });
    this.sessionIdByUserId.set(userId, session.id);
    return session.id;
  }

  async getSessionIdForUser(userId) {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId) {
      throw new Error('userId is required.');
    }

    let sessionId = this.sessionIdByUserId.get(normalizedUserId);

    if (!sessionId) {
      sessionId = await this.createSessionForUser(normalizedUserId);
    }

    return sessionId;
  }

  async getTokenForUser(userId, template) {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId) {
      throw new Error('userId is required.');
    }

    let sessionId = await this.getSessionIdForUser(normalizedUserId);

    try {
      const token = template
        ? await this.clerkClient.sessions.getToken(sessionId, template)
        : await this.clerkClient.sessions.getToken(sessionId);

      return token.jwt;
    } catch (error) {
      const code = error?.errors?.[0]?.code || error?.code || error?.status;

      // Nếu session cũ không còn hợp lệ thì tạo lại session mới rồi lấy token lại
      if (
        code === 'resource_not_found' ||
        code === 'session_not_found' ||
        code === 404
      ) {
        sessionId = await this.createSessionForUser(normalizedUserId);

        const token = template
          ? await this.clerkClient.sessions.getToken(sessionId, template)
          : await this.clerkClient.sessions.getToken(sessionId);

        return token.jwt;
      }

      throw error;
    }
  }

  async revokeUserSession(userId) {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId) {
      return;
    }

    const sessionId = this.sessionIdByUserId.get(normalizedUserId);
    if (!sessionId) {
      return;
    }

    try {
      await this.clerkClient.sessions.revokeSession(sessionId);
    } catch {
      // Ignore revoke errors
    }

    this.sessionIdByUserId.delete(normalizedUserId);
  }

  async revokeAll() {
    const entries = Array.from(this.sessionIdByUserId.entries());

    for (const [, sessionId] of entries) {
      try {
        await this.clerkClient.sessions.revokeSession(sessionId);
      } catch {
        // Ignore revoke errors to avoid masking the main script result.
      }
    }

    this.sessionIdByUserId.clear();
  }
}

module.exports = {
  createClerkClientFromEnv,
  getClerkUserByEmail,
  ClerkSessionTokenPool,
};
