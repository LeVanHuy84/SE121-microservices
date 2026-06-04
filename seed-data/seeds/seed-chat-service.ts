import * as dotenv from 'dotenv';
import * as mongoose from 'mongoose';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type GeneratedUserRow = {
  userId: string;
  email?: string;
};

type ConversationSeedDoc = {
  isGroup: boolean;
  participants: string[];
  groupName?: string;
  directKey?: string;
  admins?: string[];
  syncVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

const ROOT_DIR = resolve(__dirname, '../..');
const USERS_FILE = resolve(__dirname, '../data/generated-users.json');
const ENV_CANDIDATES = [
  resolve(ROOT_DIR, 'apps/chat-service/.env'),
  resolve(ROOT_DIR, 'apps/chat-service/.env.local'),
];

function loadChatServiceEnv(): string {
  for (const envFile of ENV_CANDIDATES) {
    if (!existsSync(envFile)) {
      continue;
    }

    dotenv.config({ path: envFile });

    if (process.env.MONGODB_URI) {
      return envFile;
    }
  }

  throw new Error(
    'Unable to find MONGODB_URI. Expected apps/chat-service/.env or .env.local',
  );
}

function loadGeneratedUsers(): GeneratedUserRow[] {
  const content = readFileSync(USERS_FILE, 'utf-8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('generated-users.json must contain an array of users');
  }
  return parsed as GeneratedUserRow[];
}

function getRandomSubarray<T>(arr: T[], size: number): T[] {
  const shuffled = arr.slice(0);
  let i = arr.length;
  let temp: T;
  let index: number;
  while (i--) {
    index = Math.floor((i + 1) * Math.random());
    temp = shuffled[index];
    shuffled[index] = shuffled[i];
    shuffled[i] = temp;
  }
  return shuffled.slice(0, size);
}

async function main(): Promise<void> {
  const envFile = loadChatServiceEnv();
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error(`MONGODB_URI is missing after loading ${envFile}`);
  }

  const users = loadGeneratedUsers();
  if (users.length < 2) {
    throw new Error('Not enough users to create conversations');
  }

  const userIds = users.map(u => u.userId);
  const conversations: ConversationSeedDoc[] = [];
  const now = new Date();

  // Tạo 20 cuộc hội thoại 1-1
  const directChatPairs = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const pair = getRandomSubarray(userIds, 2).sort();
    const directKey = pair.join(':');
    
    if (directChatPairs.has(directKey)) continue;
    directChatPairs.add(directKey);

    conversations.push({
      isGroup: false,
      participants: pair,
      directKey,
      syncVersion: now.getTime(),
      createdAt: now,
      updatedAt: now,
    });
  }

  // Tạo 10 cuộc hội thoại nhóm
  for (let i = 0; i < 10; i++) {
    const groupSize = Math.floor(Math.random() * 8) + 3; // 3 to 10 users
    const groupParticipants = getRandomSubarray(userIds, groupSize).sort();
    const admins = getRandomSubarray(groupParticipants, 1);

    conversations.push({
      isGroup: true,
      participants: groupParticipants,
      groupName: `Group Chat ${i + 1}`,
      admins: admins,
      syncVersion: now.getTime(),
      createdAt: now,
      updatedAt: now,
    });
  }

  const mongooseInstance = await mongoose.connect(mongoUri, {
    dbName: 'chat_service',
  });

  try {
    const db = mongooseInstance.connection.db;
    if (!db) {
      throw new Error('MongoDB connection did not expose a database handle');
    }

    const conversationCollection = db.collection('conversations');
    
    // Xoá dữ liệu cũ
    await conversationCollection.deleteMany({});
    
    // Chèn dữ liệu mới
    if (conversations.length > 0) {
      await conversationCollection.insertMany(conversations, { ordered: false });
    }

    console.log(`Seeded chat-service: ${conversations.filter(c => !c.isGroup).length} 1-1 chats, ${conversations.filter(c => c.isGroup).length} group chats.`);
  } finally {
    await mongooseInstance.disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed-chat-service] ${message}`);
  process.exitCode = 1;
});
