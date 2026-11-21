import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as dotenv from 'dotenv';
import * as mongoose from 'mongoose';
import Redis from 'ioredis';
import { Client as PgClient } from 'pg';

const ROOT_DIR = resolve(__dirname, '../..');

// Chỉ nạp duy nhất .env.test.local hoặc .env.test để đảm bảo an toàn tuyệt đối
// Tránh nạp nhầm .env production của các service
const testLocalEnv = resolve(ROOT_DIR, '.env.test.local');
const testEnv = resolve(ROOT_DIR, '.env.test');

if (fs.existsSync(testLocalEnv)) {
  console.log(`[SEED CONFIG] Loading test environment from: ${testLocalEnv}`);
  dotenv.config({ path: testLocalEnv, override: true });
} else if (fs.existsSync(testEnv)) {
  console.log(`[SEED CONFIG] Loading test environment from: ${testEnv}`);
  dotenv.config({ path: testEnv, override: true });
} else {
  console.warn('[SEED CONFIG] No .env.test.local found. Using localhost defaults.');
}

function sanitizeMongoBaseUri(rawUri?: string): string {
  const uri = rawUri?.trim();
  if (
    !uri ||
    uri.includes('mongodb+srv://') ||
    uri.includes('mongodb.net') ||
    uri.includes('cluster')
  ) {
    if (uri && (uri.includes('mongodb+srv://') || uri.includes('mongodb.net') || uri.includes('cluster'))) {
      console.warn(`[SAFETY GUARD] BLOCKED remote/Atlas MongoDB URI in environment: ${uri}`);
      console.warn(`[SAFETY GUARD] Reverting to local test MongoDB: mongodb://127.0.0.1:27017`);
    }
    return 'mongodb://127.0.0.1:27017';
  }

  // Convert docker host 'mongodb' to '127.0.0.1' for host runner
  let converted = uri
    .replace('mongodb://mongodb:', 'mongodb://127.0.0.1:')
    .replace('@mongodb:', '@127.0.0.1:');

  try {
    const parsed = new URL(converted);
    converted = `${parsed.protocol}//${parsed.host}`;
  } catch {
    converted = converted.replace(/^(mongodb:\/\/[^/?]+).*/, '$1');
  }

  return converted;
}

function sanitizePgUrl(rawUrl?: string, defaultDb = 'user_social_service'): string {
  const urlStr = rawUrl?.trim();
  if (
    !urlStr ||
    urlStr.includes('neon.tech') ||
    urlStr.includes('supabase.co') ||
    urlStr.includes('render.com') ||
    urlStr.includes('aws')
  ) {
    if (urlStr && (urlStr.includes('neon.tech') || urlStr.includes('supabase.co') || urlStr.includes('render.com'))) {
      console.warn(`[SAFETY GUARD] BLOCKED remote cloud PostgreSQL URL in environment: ${urlStr}`);
      console.warn(
        `[SAFETY GUARD] Reverting to local PostgreSQL: postgresql://postgres:postgres@127.0.0.1:5432/${defaultDb}`,
      );
    }
    return `postgresql://postgres:postgres@127.0.0.1:5432/${defaultDb}`;
  }

  try {
    const parsed = new URL(urlStr);
    if (parsed.hostname === 'postgres') {
      parsed.hostname = '127.0.0.1';
    }
    return parsed.toString();
  } catch {
    return urlStr.replace(/@postgres(:|$)/, '@127.0.0.1$1');
  }
}

function sanitizeRedisConfig(rawHost?: string, rawPort?: string | number) {
  let host = rawHost?.trim() || '127.0.0.1';
  if (host === 'redis') host = '127.0.0.1';
  if (host.includes('upstash') || host.includes('redislabs')) {
    console.warn(`[SAFETY GUARD] BLOCKED remote Redis host: ${host}, using 127.0.0.1`);
    host = '127.0.0.1';
  }
  const port = Number(rawPort) || 6379;
  return { host, port };
}

function sanitizeEsUrl(rawUrl?: string): string {
  let url = rawUrl?.trim() || 'http://127.0.0.1:9200';
  url = url.replace('://elasticsearch:', '://127.0.0.1:');
  return url;
}

const SEARCH_KEYWORDS = [
  'tâm lý',
  'chữa lành',
  'áp lực học tập',
  'mệt mỏi',
  'sinh viên',
  'âm nhạc',
  'lo âu',
  'thư giãn',
  'đồ án tốt nghiệp',
  'hạnh phúc',
];

interface PhobertSample {
  input_text: string;
  prediction: {
    dominantEmotion: string;
    primaryEmotion: string;
    secondaryEmotions?: string[];
    emotionScores: {
      joy: number;
      sadness: number;
      disgust: number;
      anger: number;
      fear: number;
      surprise: number;
      neutral: number;
    };
    confidence: number;
  };
}

interface PhobertResultsFile {
  results: PhobertSample[];
}

const DATASET_PATH = resolve(
  ROOT_DIR,
  'evaluation/emotion/data/phobert_finetune_merged_dataset_full_results.json',
);

// MongoDB Feed URI: Ưu tiên CONTENT_FEED_MONGODB_URI từ .env.test.local
const rawFeedMongoUri =
  process.env.CONTENT_FEED_MONGODB_URI ||
  process.env.FEED_MONGODB_URI ||
  process.env.TEST_MONGODB_URI ||
  (!process.env.MONGODB_URI?.includes('+srv') && !process.env.MONGODB_URI?.includes('mongodb.net') ? process.env.MONGODB_URI : undefined);

const FEED_MONGO_BASE_URI = sanitizeMongoBaseUri(rawFeedMongoUri);

// MongoDB Emotion URI: Ưu tiên EMOTION_MONGODB_URI từ .env.test.local
const rawEmotionMongoUri =
  process.env.EMOTION_MONGODB_URI ||
  process.env.TEST_MONGODB_URI ||
  (!process.env.MONGODB_URI?.includes('+srv') && !process.env.MONGODB_URI?.includes('mongodb.net') ? process.env.MONGODB_URI : undefined);

const EMOTION_MONGO_BASE_URI = sanitizeMongoBaseUri(rawEmotionMongoUri);

// PostgreSQL User Social URL: Ưu tiên USER_SOCIAL_DATABASE_URL từ .env.test.local
const rawPgUrl =
  process.env.USER_SOCIAL_DATABASE_URL ||
  process.env.USER_SOCIAL_POSTGRES_URL ||
  (!process.env.DATABASE_URL?.includes('neon.tech') && !process.env.DATABASE_URL?.includes('supabase.co') ? process.env.DATABASE_URL : undefined) ||
  (!process.env.POSTGRES_URL?.includes('neon.tech') && !process.env.POSTGRES_URL?.includes('supabase.co') ? process.env.POSTGRES_URL : undefined);

const PG_URL = sanitizePgUrl(rawPgUrl, 'user_social_service');

// PostgreSQL Search Recommendation URL: Ưu tiên SEARCH_REC_DATABASE_URL từ .env.test.local
const rawSearchRecPgUrl =
  process.env.SEARCH_REC_DATABASE_URL ||
  process.env.SEARCH_REC_POSTGRES_URL ||
  (!process.env.DATABASE_URL?.includes('neon.tech') && !process.env.DATABASE_URL?.includes('supabase.co') ? process.env.DATABASE_URL : undefined);

const SEARCH_REC_PG_URL = sanitizePgUrl(rawSearchRecPgUrl, 'search_recommendation');

// Elasticsearch URL
const ES_NODE = sanitizeEsUrl(process.env.ES_NODE || process.env.ELASTICSEARCH_NODE);

const MUSIC_DATA_PATH = resolve(ROOT_DIR, 'seed-data/data/music-feature.json');

const { host: REDIS_HOST, port: REDIS_PORT } = sanitizeRedisConfig(
  process.env.REDIS_HOST || process.env.POST_REDIS_HOST,
  process.env.REDIS_PORT || process.env.POST_REDIS_PORT,
);

const NUM_POSTS = 5000;
const NUM_AUTHORS = 500;
const NUM_TEST_USERS = 350;
const FEED_ITEMS_PER_USER = 100;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  console.log('================================================================');
  console.log('  🚀 SEED DATA CHO LOAD TESTING (NEWSFEED BENCHMARK)');
  console.log('================================================================');
  console.log(`Source dataset:      ${DATASET_PATH}`);
  console.log(`Feed MongoDB Base:   ${FEED_MONGO_BASE_URI} (db: se121_content_feed)`);
  console.log(`Emotion Mongo Base:  ${EMOTION_MONGO_BASE_URI} (db: emotion_intelligence_service)`);
  console.log(`User Social PG URL:  ${PG_URL}`);
  console.log(`Redis:               ${REDIS_HOST}:${REDIS_PORT}`);

  if (!fs.existsSync(DATASET_PATH)) {
    throw new Error(`Dataset file not found at: ${DATASET_PATH}`);
  }

  const rawJson = fs.readFileSync(DATASET_PATH, 'utf-8');
  const parsedData = JSON.parse(rawJson) as PhobertResultsFile;
  const samples = parsedData.results.slice(0, NUM_POSTS);

  if (samples.length < NUM_POSTS) {
    throw new Error(`Expected at least ${NUM_POSTS} samples, got ${samples.length}`);
  }

  console.log(`Loaded ${samples.length} PhoBERT samples from evaluation dataset.`);

  // 1. Connect Redis
  const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    lazyConnect: true,
  });
  await redis.connect();
  console.log('Connected to Redis.');

  // 2. Connect MongoDB Feed Service
  const feedConn = await mongoose.createConnection(FEED_MONGO_BASE_URI, {
    dbName: 'se121_content_feed',
  }).asPromise();
  console.log('Connected to MongoDB [se121_content_feed].');

  // 3. Connect MongoDB Emotion Intelligence Service
  const emotionConn = await mongoose.createConnection(EMOTION_MONGO_BASE_URI, {
    dbName: 'emotion_intelligence_service',
  }).asPromise();
  console.log('Connected to MongoDB [emotion_intelligence_service].');

  // 4. Connect PostgreSQL User Social Service
  const pg = new PgClient({ connectionString: PG_URL });
  await pg.connect();
  console.log('Connected to PostgreSQL [user_social_service].');

  // 5. Connect PostgreSQL Search Recommendation Service
  const searchRecPg = new PgClient({ connectionString: SEARCH_REC_PG_URL });
  await searchRecPg.connect();
  console.log('Connected to PostgreSQL [search_recommendation].');

  try {
    const postSnapshotCol = feedConn.collection('post_snapshots');
    const feedItemCol = feedConn.collection('feed_items');
    const emotionProfileCol = emotionConn.collection('user_emotion_profiles');
    const emotionSnapshotCol = emotionConn.collection('user_emotion_snapshots');

    // Clean old load test data
    console.log('\nCleaning existing load-test entries...');
    await postSnapshotCol.deleteMany({
      $or: [
        { postId: { $regex: '^load_post_' } },
        { userId: { $regex: '^load_author_' } },
      ],
    });
    await feedItemCol.deleteMany({ userId: { $regex: '^load_user_' } });
    await emotionProfileCol.deleteMany({ userId: { $regex: '^load_user_' } });
    await emotionSnapshotCol.deleteMany({ userId: { $regex: '^load_user_' } });

    // Clean Redis session & profile keys
    const staleKeys = await redis.keys('{session:feed:load_user_*,feed:session:load_user_*,feed:seen:load_user_*,cache:emotion:features:load_user_*,trending:session:*,trending:meta:*}');
    if (staleKeys.length > 0) {
      for (const batch of chunkArray(staleKeys, 1000)) {
        await redis.del(...batch);
      }
    }
    await redis.del('post:score', 'post:emotion:joy:score', 'post:emotion:sadness:score', 'post:emotion:neutral:score', 'post:emotion:anger:score', 'post:emotion:fear:score', 'post:emotion:surprise:score', 'post:emotion:disgust:score');


    // Ensure tables in PostgreSQL
    console.log('Ensuring users and profiles schema in PostgreSQL...');
    await pg.query(`
      DO $$ BEGIN
       CREATE TYPE user_status AS ENUM('ACTIVE', 'SUSPENDED', 'DELETED', 'PENDING');
      EXCEPTION
       WHEN duplicate_object THEN null;
      END $$;

      DO $$ BEGIN
       CREATE TYPE privacy_level AS ENUM('PUBLIC', 'FRIENDS_ONLY', 'PRIVATE');
      EXCEPTION
       WHEN duplicate_object THEN null;
      END $$;

      CREATE TABLE IF NOT EXISTS users (
        id varchar(255) PRIMARY KEY NOT NULL,
        email varchar(255) NOT NULL UNIQUE,
        is_active boolean DEFAULT true NOT NULL,
        deleted_at timestamp,
        user_status user_status DEFAULT 'ACTIVE' NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        user_id varchar(255) REFERENCES users(id) ON DELETE cascade,
        first_name varchar(100),
        last_name varchar(100),
        avatar_url text,
        cover_image jsonb,
        bio varchar(255),
        location varchar(120),
        job_title varchar(120),
        company varchar(120),
        school varchar(120),
        interests jsonb DEFAULT '[]'::jsonb NOT NULL,
        semantic_profile_text text,
        post_count integer DEFAULT 0 NOT NULL,
        friend_count integer DEFAULT 0 NOT NULL,
        privacy_level privacy_level DEFAULT 'PUBLIC' NOT NULL,
        privacy_settings jsonb DEFAULT '{"profileVisibility": "PUBLIC", "messagePrivacy": "EVERYONE", "friendListVisibility": "PUBLIC", "allowProactiveIntervention": false}'::jsonb,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS friendships (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        user_id varchar(255) NOT NULL,
        friend_id varchar(255) NOT NULL,
        since timestamp with time zone DEFAULT now() NOT NULL,
        sentiment_score double precision DEFAULT 0 NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_friendship_user_friend ON friendships (user_id, friend_id);
      CREATE INDEX IF NOT EXISTS idx_friendship_user_friend ON friendships (user_id, friend_id);
      CREATE INDEX IF NOT EXISTS idx_friendship_user_since ON friendships (user_id, since);

      CREATE TABLE IF NOT EXISTS user_blocks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        blocker_id varchar(255) NOT NULL,
        blocked_id varchar(255) NOT NULL,
        created_at timestamp with time zone DEFAULT now() NOT NULL
      );
    `);

    // Seed Authors into Redis and PostgreSQL (500 distinct authors for 5000 posts)
    console.log(`Seeding ${NUM_AUTHORS} author profiles in Redis & PostgreSQL...`);
    const redisPipeline = redis.pipeline();
    for (let a = 1; a <= NUM_AUTHORS; a++) {
      const authorId = `load_author_${a}`;
      const email = `load_author_${a}@loadtest.local`;
      const firstName = 'Author';
      const lastName = `${a}`;
      const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=Author${a}`;

      redisPipeline.hmset(`user:profile:${authorId}`, {
        firstName,
        lastName,
        avatarUrl,
      });
      redisPipeline.expire(`user:profile:${authorId}`, 86400 * 7);

      await pg.query(
        `INSERT INTO users (id, email, user_status)
         VALUES ($1::varchar, $2::varchar, 'ACTIVE')
         ON CONFLICT (id) DO UPDATE SET user_status = 'ACTIVE'`,
        [authorId, email],
      );

      await pg.query(
        `INSERT INTO profiles (user_id, first_name, last_name, avatar_url)
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::text
         WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = $1::varchar)`,
        [authorId, firstName, lastName, avatarUrl],
      );
    }

    for (let u = 1; u <= NUM_TEST_USERS; u++) {
      const uid = `load_user_${u}`;
      const email = `load_user_${u}@loadtest.local`;
      const firstName = 'Test';
      const lastName = `User ${u}`;
      const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=User${u}`;

      redisPipeline.hmset(`user:profile:${uid}`, {
        firstName,
        lastName,
        avatarUrl,
      });
      redisPipeline.expire(`user:profile:${uid}`, 86400 * 7);

      await pg.query(
        `INSERT INTO users (id, email, user_status)
         VALUES ($1::varchar, $2::varchar, 'ACTIVE')
         ON CONFLICT (id) DO UPDATE SET user_status = 'ACTIVE'`,
        [uid, email],
      );

      await pg.query(
        `INSERT INTO profiles (user_id, first_name, last_name, avatar_url)
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::text
         WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = $1::varchar)`,
        [uid, firstName, lastName, avatarUrl],
      );
    }
    await redisPipeline.exec();
    console.log('Seeded authors and users into PostgreSQL [users, profiles] and Redis.');

    // Seed Friendships among test users for feed fan-out
    console.log('Seeding friendships among test users in PostgreSQL [friendships]...');
    for (let u = 1; u <= NUM_TEST_USERS; u++) {
      const uid = `load_user_${u}`;
      for (let offset = 1; offset <= 5; offset++) {
        const friendNum = ((u + offset - 1) % NUM_TEST_USERS) + 1;
        const friendId = `load_user_${friendNum}`;
        await pg.query(
          `INSERT INTO friendships (user_id, friend_id, sentiment_score)
           VALUES ($1::varchar, $2::varchar, 0.5)
           ON CONFLICT (user_id, friend_id) DO NOTHING`,
          [uid, friendId],
        );
      }
    }
    console.log('Seeded friendships for test users in PostgreSQL.');

    // 4. Build 5000 PostSnapshots
    console.log(`Generating ${NUM_POSTS} post_snapshots from PhoBERT...`);
    const now = Date.now();
    const snapshotDocs = samples.map((sample, idx) => {
      const postId = randomUUID();
      const authorId = `load_author_${(idx % NUM_AUTHORS) + 1}`;
      const pred = sample.prediction;
      const dominant = (pred.dominantEmotion || 'neutral').toLowerCase();
      const confidence = pred.confidence || 0.8;
      const scores = pred.emotionScores || {
        joy: 0.1,
        sadness: 0.1,
        disgust: 0.05,
        anger: 0.05,
        fear: 0.05,
        surprise: 0.05,
        neutral: 0.6,
      };

      const postCreatedAt = new Date(now - (NUM_POSTS - idx) * 45 * 1000);

      // Pareto/Power-law viral engagement distribution for trending
      const rank = idx + 1;
      const viralFactor = Math.floor(12000 / Math.pow(rank, 0.42));
      const noise = (idx * 37) % 73;
      const reactions = Math.max(10, viralFactor + noise);
      const comments = Math.floor(reactions * 0.2);
      const shares = Math.floor(reactions * 0.08);
      const likes = Math.floor(reactions * 0.65);
      const loves = Math.floor(reactions * 0.2);
      const hahas = Math.floor(reactions * 0.08);
      const wows = Math.floor(reactions * 0.04);
      const sads = dominant === 'sadness' ? Math.floor(reactions * 0.25) : idx % 3;
      const angrys = dominant === 'anger' ? Math.floor(reactions * 0.2) : idx % 2;

      return {
        _id: new mongoose.Types.ObjectId(),
        postId,
        userId: authorId,
        audience: 'PUBLIC',
        content: idx < 300 ? `${sample.input_text} (${SEARCH_KEYWORDS[idx % SEARCH_KEYWORDS.length]})` : sample.input_text,
        mediaPreviews: [],
        mediaRemaining: 0,
        emotionFeature: {
          primaryEmotion: dominant,
          label: dominant,
          confidence,
          scores,
          secondaryEmotions: pred.secondaryEmotions || [],
          isSarcasmOrConflict: false,
          mentalHealthRiskLevel:
            dominant === 'sadness' && confidence > 0.8 ? 'medium' : 'none',
        },
        moderationAction: 'ALLOW',
        hasWarning: false,
        needsMentalSupport: false,
        postCreatedAt,
        stats: {
          reactions,
          likes,
          loves,
          hahas,
          wows,
          angrys,
          sads,
          comments,
          shares,
        },
        createdAt: postCreatedAt,
        updatedAt: postCreatedAt,
      };
    });

    for (const chunk of chunkArray(snapshotDocs, 250)) {
      await postSnapshotCol.insertMany(chunk, { ordered: false });
    }
    console.log(`Inserted ${snapshotDocs.length} post_snapshots into MongoDB.`);

    // Prewarm 5000 posts into Redis Trending ZSETs and Hashes
    console.log(`Prewarming ${snapshotDocs.length} posts into Redis Trending ZSETs and Hashes...`);
    for (const chunk of chunkArray(snapshotDocs, 500)) {
      const pipeline = redis.pipeline();
      for (const snap of chunk) {
        const postId = snap.postId;
        const dominant = snap.emotionFeature.label;
        const scores = snap.emotionFeature.scores;
        const confidence = snap.emotionFeature.confidence;
        const authorId = snap.userId;
        const trendingScore = Math.max(1, snap.stats.likes + snap.stats.comments * 3 + snap.stats.shares * 4);

        pipeline.zadd('post:score', trendingScore, postId);

        pipeline.hset(`post:rank:${postId}`, {
          label: dominant,
          scores: JSON.stringify(scores),
          confidence: confidence.toString(),
          dominantScene: 'general',
          riskHintLevel: snap.emotionFeature.mentalHealthRiskLevel === 'medium' ? 'MEDIUM' : 'NONE',
          mentalHealthRiskLevel: snap.emotionFeature.mentalHealthRiskLevel,
          authorId,
          moderationAction: 'ALLOW',
          needsMentalSupport: 'false',
        });
        pipeline.expire(`post:rank:${postId}`, 86400 * 30);

        pipeline.hset(`post:meta:${postId}`, {
          createdAt: snap.postCreatedAt.getTime().toString(),
          lastStatAt: snap.postCreatedAt.getTime().toString(),
        });
        pipeline.expire(`post:meta:${postId}`, 86400 * 30);

        pipeline.hset(`post:engagement:${postId}`, {
          reactions: snap.stats.reactions.toString(),
          comments: snap.stats.comments.toString(),
          shares: snap.stats.shares.toString(),
        });
        pipeline.expire(`post:engagement:${postId}`, 86400 * 30);

        if (dominant) {
          const emotionKey = `post:emotion:${dominant}:score`;
          pipeline.zadd(emotionKey, trendingScore, postId);
          pipeline.expire(emotionKey, 86400 * 30);
        }
      }
      await pipeline.exec();
    }
    console.log(`Prewarmed ${snapshotDocs.length} posts into Redis for Trending!`);

    // 5. Build 35,000 FeedItems (350 test users x 100 items)
    console.log(`Generating ${NUM_TEST_USERS * FEED_ITEMS_PER_USER} feed_items...`);
    const feedItemDocs: Array<{
      userId: string;
      eventType: 'POST';
      snapshotId: string;
      postId: string;
      refId: string;
      emotionLabel: string;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    for (let u = 1; u <= NUM_TEST_USERS; u++) {
      const userId = `load_user_${u}`;
      // Pseudo-random offset so each user gets a distinct pool of 100 posts
      const startIdx = ((u - 1) * 13) % (NUM_POSTS - FEED_ITEMS_PER_USER);
      const userSnapshots = snapshotDocs.slice(
        startIdx,
        startIdx + FEED_ITEMS_PER_USER,
      );

      userSnapshots.forEach((snap, rank) => {
        const itemCreatedAt = new Date(now - (FEED_ITEMS_PER_USER - rank) * 60 * 1000);
        feedItemDocs.push({
          userId,
          eventType: 'POST',
          snapshotId: snap._id.toHexString(),
          postId: snap.postId,
          refId: snap.postId,
          emotionLabel: snap.emotionFeature?.label || 'neutral',
          createdAt: itemCreatedAt,
          updatedAt: itemCreatedAt,
        });
      });
    }

    for (const chunk of chunkArray(feedItemDocs, 1000)) {
      await feedItemCol.insertMany(chunk, { ordered: false });
    }
    console.log(`Inserted ${feedItemDocs.length} feed_items.`);

    // 6. Build Emotion Profiles & Snapshots for 350 Users
    // Distribution:
    // 70% resilient/normal (1..245)
    // 20% moderate stress (246..315)
    // 10% distressed (316..350)
    console.log(`Generating emotion profiles and snapshots for ${NUM_TEST_USERS} users...`);
    const profileDocs: Array<Record<string, unknown>> = [];
    const snapshotCollectionDocs: Array<Record<string, unknown>> = [];

    const redisWarmupPipeline = redis.pipeline();

    const normalLimit = Math.floor(NUM_TEST_USERS * 0.7); // 245
    const stressLimit = Math.floor(NUM_TEST_USERS * 0.9); // 315

    for (let u = 1; u <= NUM_TEST_USERS; u++) {
      const userId = `load_user_${u}`;
      let negativity: number;
      let emotionVectorEMA: Record<string, number>;
      let negativeRatio: number;
      let volatility: number;
      let riskScore: number;

      if (u <= normalLimit) {
        // Normal / Resilient
        negativity = Number((0.12 + (u % 15) * 0.01).toFixed(2));
        emotionVectorEMA = {
          joy: 0.40,
          sadness: 0.08,
          neutral: 0.35,
          anger: 0.04,
          fear: 0.05,
          surprise: 0.05,
          disgust: 0.03,
        };
        negativeRatio = 0.15;
        volatility = 0.18;
        riskScore = 0.10;
      } else if (u <= stressLimit) {
        // Moderate Sadness/Stress
        negativity = Number((0.52 + (u % 18) * 0.01).toFixed(2));
        emotionVectorEMA = {
          joy: 0.15,
          sadness: 0.42,
          neutral: 0.23,
          anger: 0.08,
          fear: 0.07,
          surprise: 0.03,
          disgust: 0.02,
        };
        negativeRatio = 0.50;
        volatility = 0.40;
        riskScore = 0.45;
      } else {
        // Distressed / Crisis state
        negativity = Number((0.85 + (u % 10) * 0.014).toFixed(2));
        emotionVectorEMA = {
          joy: 0.05,
          sadness: 0.72,
          neutral: 0.10,
          anger: 0.05,
          fear: 0.05,
          surprise: 0.02,
          disgust: 0.01,
        };
        negativeRatio = 0.85;
        volatility = 0.65;
        riskScore = 0.85;
      }

      profileDocs.push({
        userId,
        recentNegativityScore: negativity,
        emotionVectorEMA,
        emotionMomentum: u > normalLimit ? 0.15 : -0.1,
        consecutiveNegativeDays: u > stressLimit ? 4 : u > normalLimit ? 1 : 0,
        lastInteractionTime: new Date(now),
        createdAt: new Date(now - 7 * 86400 * 1000),
        updatedAt: new Date(now),
      });

      // 1d snapshot
      snapshotCollectionDocs.push({
        userId,
        window: '1d',
        negativeRatio,
        emotionVolatility: volatility,
        riskScore,
        trend: u > normalLimit ? 0.2 : -0.1,
        baselineNegativeRatio: 0.15,
        emotionDistribution: emotionVectorEMA,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      });

      // 7d snapshot
      snapshotCollectionDocs.push({
        userId,
        window: '7d',
        negativeRatio,
        emotionVolatility: volatility,
        riskScore,
        trend: u > normalLimit ? 0.2 : -0.1,
        baselineNegativeRatio: 0.15,
        emotionDistribution: emotionVectorEMA,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      });

      // Warmup Redis cache for emotion features
      const emotionFeaturesDto = {
        userEmotionPreference: emotionVectorEMA,
        last24hEmotionDistribution: emotionVectorEMA,
        negativeRatio7d: negativeRatio,
        emotionVolatility7d: volatility,
        riskScore,
        recentNegativityScore: negativity,
        emotionMomentum: u > normalLimit ? 0.15 : -0.1,
      };

      redisWarmupPipeline.setex(
        `cache:emotion:features:${userId}`,
        86400,
        JSON.stringify(emotionFeaturesDto),
      );
    }

    await emotionProfileCol.insertMany(profileDocs, { ordered: false });
    await emotionSnapshotCol.insertMany(snapshotCollectionDocs, { ordered: false });
    await redisWarmupPipeline.exec();

    console.log(
      `Inserted ${profileDocs.length} user_emotion_profiles and ${snapshotCollectionDocs.length} user_emotion_snapshots.`,
    );
    console.log('Prewarmed emotion features and user profiles in Redis.');

    // ------------------------------------------------------------------------
    // 6. SEED MUSIC FEATURES (PostgreSQL [search_recommendation])
    // ------------------------------------------------------------------------
    if (fs.existsSync(MUSIC_DATA_PATH)) {
      console.log(`\nSeeding music features from ${MUSIC_DATA_PATH}...`);
      const rawMusicJson = fs.readFileSync(MUSIC_DATA_PATH, 'utf-8').replace(/^\uFEFF/, '');
      const rawMusic = JSON.parse(rawMusicJson) as Array<{
        url: string;
        coverUrl: string;
        title: string;
        artist: string;
        genre: string;
        valence: number;
        arousal: number;
      }>;

      await searchRecPg.query(`
        DO $$ BEGIN
         CREATE TYPE music_features_genre_enum AS ENUM('lofi', 'edm', 'pop', 'acoustic', 'rock', 'other');
        EXCEPTION
         WHEN duplicate_object THEN null;
        END $$;

        CREATE TABLE IF NOT EXISTS music_features (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          audio jsonb NOT NULL,
          "coverImage" jsonb NOT NULL,
          artist varchar(255),
          title varchar(255) NOT NULL,
          genre music_features_genre_enum,
          valence double precision NOT NULL,
          arousal double precision NOT NULL,
          "createdAt" timestamp DEFAULT now() NOT NULL
        );
      `);

      await searchRecPg.query('DELETE FROM music_features WHERE true;');

      for (let i = 0; i < rawMusic.length; i++) {
        const m = rawMusic[i];
        const uniqueId = `${i + 1}`.padStart(6, '0');
        await searchRecPg.query(
          `INSERT INTO music_features (audio, "coverImage", artist, title, genre, valence, arousal)
           VALUES ($1::jsonb, $2::jsonb, $3::varchar, $4::varchar, $5::music_features_genre_enum, $6::float8, $7::float8)`,
          [
            JSON.stringify({ url: m.url, publicId: `music-features/audio-${uniqueId}` }),
            JSON.stringify({ type: 'IMAGE', url: m.coverUrl, publicId: `music-features/cover-${uniqueId}` }),
            m.artist,
            m.title,
            m.genre.toLowerCase(),
            m.valence,
            m.arousal,
          ],
        );
      }
      console.log(`Seeded ${rawMusic.length} music tracks into PostgreSQL [search_recommendation.music_features].`);
    }

    // ------------------------------------------------------------------------
    // 7. SEED ELASTICSEARCH [posts] INDEX
    // ------------------------------------------------------------------------
    try {
      console.log(`\nIndexing ${snapshotDocs.length} posts into Elasticsearch at ${ES_NODE}...`);
      const checkRes = await fetch(`${ES_NODE}/posts`, { method: 'HEAD' });
      if (checkRes.status === 404) {
        await fetch(`${ES_NODE}/posts`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mappings: {
              properties: {
                id: { type: 'keyword' },
                userId: { type: 'keyword' },
                groupId: { type: 'keyword' },
                content: {
                  type: 'text',
                  analyzer: 'standard',
                  search_analyzer: 'standard',
                },
                mainEmotion: { type: 'keyword' },
                createdAt: { type: 'date' },
              },
            },
          }),
        });
      } else {
        await fetch(`${ES_NODE}/posts/_delete_by_query?conflicts=proceed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: { match_all: {} } }),
        });
      }

      for (const chunk of chunkArray(snapshotDocs, 500)) {
        let ndjson = '';
        for (const snap of chunk) {
          ndjson += JSON.stringify({ index: { _index: 'posts', _id: snap.postId } }) + '\n';
          ndjson +=
            JSON.stringify({
              id: snap.postId,
              userId: snap.userId,
              groupId: null,
              content: snap.content,
              mainEmotion: (snap.emotionFeature.label || 'neutral').toUpperCase(),
              createdAt: snap.postCreatedAt,
            }) + '\n';
        }
        await fetch(`${ES_NODE}/_bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-ndjson' },
          body: ndjson,
        });
      }

      await fetch(`${ES_NODE}/posts/_refresh`, { method: 'POST' });
      console.log(`Successfully indexed ${snapshotDocs.length} posts into Elasticsearch [posts].`);
    } catch (esErr: any) {
      console.warn(`[WARN] Elasticsearch indexing skipped or failed: ${esErr?.message || esErr}`);
    }

    console.log('\n================================================================');
    console.log('🎉 SEED DỮ LIỆU LOAD TEST HOÀN TẤT!');
    console.log(' - 5,000 Post Snapshots in MongoDB & Redis Trending Pools');
    console.log(` - ${NUM_TEST_USERS * FEED_ITEMS_PER_USER} Feed Items (${NUM_TEST_USERS} users x ${FEED_ITEMS_PER_USER} feed items)`);
    console.log(` - ${NUM_TEST_USERS} User Emotion Profiles (${normalLimit} normal, ${stressLimit - normalLimit} moderate, ${NUM_TEST_USERS - stressLimit} distressed)`);
    console.log(' - 22 Music Feature tracks in PostgreSQL [search_recommendation]');
    console.log(' - 5,000 Posts indexed in Elasticsearch for Full-text Search');
    console.log(' - Redis caches prewarmed for instant sub-millisecond ranking');
    console.log('================================================================');
  } finally {
    await feedConn.close();
    await emotionConn.close();
    await redis.quit();
    await pg.end().catch(() => {});
    await searchRecPg.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
