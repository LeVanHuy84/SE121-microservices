const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mongoose = require('mongoose');
const Redis = require('ioredis');

const ROOT_DIR = path.resolve(__dirname, '../..');
const ENV_CANDIDATES = [
  path.resolve(ROOT_DIR, 'apps/emotion-intelligence-service/.env'),
  path.resolve(ROOT_DIR, 'apps/emotion-intelligence-service/.env.local'),
  path.resolve(ROOT_DIR, 'apps/content-feed-service/.env'),
  path.resolve(ROOT_DIR, '.env'),
  path.resolve(ROOT_DIR, '.env.local'),
];

function loadEnv() {
  for (const envFile of ENV_CANDIDATES) {
    if (fs.existsSync(envFile)) {
      dotenv.config({ path: envFile });
      if (process.env.MONGODB_URI) {
        return envFile;
      }
    }
  }
  return '';
}

function promptUser(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    }),
  );
}

async function main() {
  const loadedEnv = loadEnv();
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/emotion_intelligence_service';
  const redisHost = process.env.REDIS_HOST || process.env.POST_REDIS_HOST || 'localhost';
  const redisPort = Number(process.env.REDIS_PORT || process.env.POST_REDIS_PORT || 6379);

  // Parse command line arguments
  const args = process.argv.slice(2);
  let userId = args.find((arg) => !arg.startsWith('--'));
  const isReset = args.includes('--reset') || args.includes('--normal');

  console.log('\n================================================================');
  console.log('   🛠️  CÔNG CỤ THIẾT LẬP TRẠNG THÁI TÂM LÝ CHO TÀI KHOẢN (UI TEST)');
  console.log('================================================================');
  if (loadedEnv) {
    console.log(`[Config] Loaded environment from: ${loadedEnv}`);
  }

  if (!userId) {
    userId = await promptUser('👉 Nhập User ID cần cập nhật (ví dụ: user_xxx): ');
  }

  if (!userId) {
    console.error('❌ Lỗi: User ID không được để trống!');
    process.exit(1);
  }

  // Mask credentials in Mongo URI for safe display
  const maskedUri = mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
  console.log(`\n⏳ Đang kết nối MongoDB: ${maskedUri}`);
  
  const mongooseInstance = await mongoose.connect(mongoUri, {
    dbName: 'emotion_intelligence_service',
    serverSelectionTimeoutMS: 5000,
  });
  const db = mongooseInstance.connection.db;
  if (!db) {
    throw new Error('Không thể kết nối đến cơ sở dữ liệu MongoDB!');
  }

  const profileCollection = db.collection('user_emotion_profiles');
  const snapshotCollection = db.collection('user_emotion_snapshots');

  console.log(`⏳ Đang kết nối Redis tại: ${redisHost}:${redisPort}`);
  const redis = new Redis({
    host: redisHost,
    port: redisPort,
    lazyConnect: true,
    connectTimeout: 3000,
  });
  
  let redisConnected = false;
  try {
    await redis.connect();
    redisConnected = true;
  } catch (err) {
    console.warn(`⚠️ Cảnh báo: Không thể kết nối Redis (${err.message}). Bỏ qua xóa cache.`);
  }

  const now = new Date();

  if (isReset) {
    // 🟢 THIẾT LẬP TRẠNG THÁI BÌNH THƯỜNG / VUI VẺ (Distress <= 0.2)
    console.log(`\n🔄 Đang thiết lập trạng thái: [BÌNH THƯỜNG / KHỎE MẠNH] cho user=${userId}...`);

    await profileCollection.updateOne(
      { userId },
      {
        $set: {
          userId,
          emotionVectorEMA: {
            joy: 0.70,
            sadness: 0.05,
            anger: 0.05,
            fear: 0.05,
            disgust: 0.0,
            surprise: 0.05,
            neutral: 0.10,
          },
          recentNegativityScore: 0.1,
          emotionMomentum: -0.2, // xu hướng tích cực
          consecutiveNegativeDays: 0,
          lastEventAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );

    await snapshotCollection.deleteMany({ userId });
    await snapshotCollection.insertMany([
      {
        userId,
        window: '7d',
        negativeRatio: 0.1,
        emotionVolatility: 0.1,
        riskScore: 0.1,
        trend: -0.1,
        baselineNegativeRatio: 0.1,
        emotionDistribution: { joy: 0.7, sadness: 0.05, neutral: 0.25 },
        createdAt: now,
        updatedAt: now,
      },
      {
        userId,
        window: '1d',
        negativeRatio: 0.1,
        emotionVolatility: 0.1,
        riskScore: 0.1,
        trend: -0.1,
        baselineNegativeRatio: 0.1,
        emotionDistribution: { joy: 0.7, sadness: 0.05, neutral: 0.25 },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    console.log('✅ Đã cập nhật MongoDB: Trạng thái bình thường (Distress ≈ 0.10 <= 0.5).');
  } else {
    // 🔴 THIẾT LẬP TRẠNG THÁI SUY SỤP / KIỆT QUỆ TÂM LÝ (Distress ≈ 0.76 > 0.5)
    console.log(`\n💔 Đang thiết lập trạng thái: [KIỆT QUỆ TÂM LÝ / CẦN CAN THIỆP] cho user=${userId}...`);

    await profileCollection.updateOne(
      { userId },
      {
        $set: {
          userId,
          emotionVectorEMA: {
            joy: 0.05,
            sadness: 0.75,
            anger: 0.10,
            fear: 0.05,
            disgust: 0.0,
            surprise: 0.0,
            neutral: 0.05,
          },
          recentNegativityScore: 0.85,
          emotionMomentum: 0.1, // xu hướng tiêu cực
          consecutiveNegativeDays: 3,
          lastEventAt: now,
          lastStrongNegativeAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );

    await snapshotCollection.deleteMany({ userId });
    await snapshotCollection.insertMany([
      {
        userId,
        window: '7d',
        negativeRatio: 0.85,
        emotionVolatility: 0.50,
        riskScore: 0.85,
        trend: 0.30,
        baselineNegativeRatio: 0.20,
        emotionDistribution: { joy: 0.05, sadness: 0.75, anger: 0.1, fear: 0.05, neutral: 0.05 },
        createdAt: now,
        updatedAt: now,
      },
      {
        userId,
        window: '1d',
        negativeRatio: 0.80,
        emotionVolatility: 0.40,
        riskScore: 0.80,
        trend: 0.20,
        baselineNegativeRatio: 0.20,
        emotionDistribution: { joy: 0.05, sadness: 0.75, anger: 0.1, fear: 0.05, neutral: 0.05 },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    console.log('✅ Đã cập nhật MongoDB:');
    console.log('   - Profile: recentNegativityScore = 0.85, emotionMomentum = 0.1');
    console.log('   - Snapshots (7d): riskScore = 0.85, negativeRatio = 0.85, volatility = 0.50');
    console.log('   👉 Điểm Distress ước tính: ≈ 0.76 (Vượt xa ngưỡng kích hoạt 0.5)');
  }

  // 🧹 DỌN DẸP REDIS CACHE & COOLDOWN
  if (redisConnected) {
    const emotionCacheKey = `cache:emotion:features:${userId}`;
    const cooldownKey = `feed:intervention:cooldown:${userId}`;

    await redis.del(emotionCacheKey);
    await redis.del(cooldownKey);

    // Xóa các session feed cũ nếu có
    const sessionKeys = await redis.keys(`feed:session:${userId}:*`);
    if (sessionKeys.length > 0) {
      await redis.del(...sessionKeys);
    }

    console.log('\n🧹 Đã dọn dẹp Redis Cache & Cooldown:');
    console.log(`   - Xóa cache hồ sơ tâm lý: "${emotionCacheKey}"`);
    console.log(`   - Xóa cooldown 12h: "${cooldownKey}"`);
    if (sessionKeys.length > 0) {
      console.log(`   - Reset ${sessionKeys.length} session cursor cũ.`);
    }
    await redis.quit();
  }

  await mongooseInstance.disconnect();

  console.log('\n================================================================');
  if (isReset) {
    console.log('🎉 THÀNH CÔNG! Tài khoản đã trở về trạng thái bình thường.');
    console.log('👉 Bây giờ khi lướt feed sẽ KHÔNG hiển thị Thẻ Safe Space.');
  } else {
    console.log('🎉 THÀNH CÔNG! Tài khoản đã sẵn sàng kiểm thử Thẻ Can thiệp!');
    console.log('👉 Hướng dẫn kiểm tra trên UI:');
    console.log('   1. Đăng nhập vào tài khoản trên.');
    console.log('   2. Mở tab Bảng tin (Personal Feed hoặc Trending).');
    console.log('   3. Thẻ Safe Space ("Góc nhỏ lắng nghe") sẽ xuất hiện ở vị trí số 5 (slot 5).');
    console.log('   (Lưu ý: Bảng tin phải có từ 5 bài viết trở lên).');
  }
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Có lỗi xảy ra trong quá trình thiết lập:', err.message || err);
  process.exit(1);
});
