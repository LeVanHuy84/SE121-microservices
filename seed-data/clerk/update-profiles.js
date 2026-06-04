#!/usr/bin/env node

/**
 * seed-data/clerk/update-profiles.js
 *
 * Đọc CSV, lookup Clerk user theo email, sync vào app DB rồi PATCH profile rich.
 *
 * Usage (chạy từ root monorepo):
 *   node seed-data/clerk/update-profiles.js [options] [csv-path]
 *
 * Options:
 *   --limit=N    Số lượng user xử lý (default: 70)
 *   --seed=S     Seed cho random profile (default: timestamp)
 *
 * Env vars (đọc từ seed-data/clerk/.env):
 *   CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY
 *   API_BASE_URL   (default: http://localhost:4000/api/v1)
 *   DRY_RUN=1
 *   MAX_USERS, SEED
 */

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
const DEFAULT_SEED = process.env.SEED || `${Date.now()}`;

const DEFAULT_CSV = path.resolve(__dirname, 'demo-clerk-users.csv');

const FIRST_NAME_POOL = [
  'An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Hà', 'Hải', 'Hương',
  'Khánh', 'Lan', 'Linh', 'Mai', 'Minh', 'My', 'Nam', 'Ngân',
  'Ngọc', 'Nhung', 'Phúc', 'Phương', 'Quang', 'Quỳnh', 'Sơn',
  'Thanh', 'Thảo', 'Thu', 'Trang', 'Trúc', 'Tuấn', 'Việt', 'Vy', 'Yến',
];

const LAST_NAME_POOL = [
  'Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Võ',
  'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý',
];

const CITY_POOL = [
  'TP. Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Cần Thơ', 'Huế',
  'Hải Phòng', 'Nha Trang', 'Biên Hòa', 'Vũng Tàu', 'Quy Nhơn',
];

const DISTRICT_POOL = [
  'Quận 1', 'Thủ Đức', 'Cầu Giấy', 'Hải Châu', 'Ninh Kiều',
  'Hồng Bàng', 'Thanh Khê', 'Sơn Trà', 'Bình Thạnh', 'Nam Từ Liêm',
];

const COMPANY_POOL = [
  'Mạng Xã Hội Sen Việt', 'Công nghệ Tâm An', 'Phòng Lab Sông Xanh', 'Xưởng Bình Minh',
  'Cộng Đồng Mở', 'Sóng Mới Digital', 'Kết Nối Đô Thị', 'Nền Tảng Hoa Sen',
  'Mindful Health Lab', 'Emotion Insight Hub', 'Blue River Software', 'Wellbeing Data Studio',
  'Sunrise Product House', 'VNG Corporation', 'FPT Software', 'Viettel', 'MoMo', 'Zalo',
  'VNPAY', 'Shopee', 'Tiki', 'NashTech', 'KMS Technology', 'CyberLogitec', 'VNGGames',
  'Gameloft', 'Be Group', 'VinAI', 'VNPT', 'Base.vn', 'Got It', 'Axie Infinity',
  'Techcombank', 'MB Bank', 'Vinamilk', 'Masan Group', 'Thế Giới Di Động',
];

const JOB_POOL = [
  'Kỹ sư Backend', 'Kỹ sư Frontend', 'Kỹ sư Mobile', 'Thiết kế sản phẩm',
  'Phân tích dữ liệu', 'Kỹ sư QA', 'Kỹ sư DevOps', 'Quản lý cộng đồng',
  'Nhà nghiên cứu AI ứng dụng', 'Chuyên viên vận hành sản phẩm', 'Kỹ sư dữ liệu',
  'Kỹ sư machine learning', 'Chuyên viên phân tích hành vi người dùng',
  'Product Manager', 'UX/UI Designer', 'Data Scientist', 'Data Analyst',
  'Scrum Master', 'Business Analyst', 'Marketing Executive', 'Content Creator',
  'HR Specialist', 'Tester', 'IT Support', 'Game Developer', 'Blockchain Engineer',
  'Fullstack Developer', 'System Administrator', 'Solution Architect', 'Technical Lead',
];

const SCHOOL_POOL = [
  'HCMUT', 'UIT', 'UEH', 'DUT', 'VNU', 'Đại học FPT', 'HUST', 'Đại học Cần Thơ',
  'PTIT', 'HUFLIT', 'Đại học Khoa học Tự nhiên', 'Đại học Bách khoa Hà Nội',
  'Đại học Ngoại thương (FTU)', 'Kinh tế Quốc dân (NEU)', 'Đại học Tôn Đức Thắng (TDTU)',
  'RMIT Vietnam', 'Swinburne Vietnam', 'Đại học Quốc tế (IU)', 'Đại học Kinh tế - Luật (UEL)',
  'Đại học Sư phạm Kỹ thuật (HCMUTE)', 'Học viện Ngân hàng', 'Đại học Y Dược',
  'Học viện Tài chính', 'Đại học Ngoại ngữ', 'Đại học Công nghiệp',
];

const INTEREST_POOL = [
  'công nghệ', 'chạy bộ', 'âm nhạc', 'xem phim', 'thể hình', 'thiết kế',
  'khởi nghiệp', 'du lịch', 'đọc sách', 'nhiếp ảnh', 'cộng đồng', 'chơi game',
  'ẩm thực', 'cà phê', 'tình nguyện', 'sức khỏe tinh thần', 'thiền', 'podcast',
  'viết blog', 'thảo luận công nghệ', 'tâm lý học ứng dụng', 'đá bóng', 'bơi lội',
  'đạp xe', 'nấu ăn', 'học ngoại ngữ', 'AI', 'Machine Learning', 'Blockchain',
  'Crypto', 'chứng khoán', 'đầu tư', 'kinh doanh', 'quản trị', 'tiếng Anh',
  'tiếng Nhật', 'IELTS', 'guitar', 'piano', 'ca hát', 'nuôi mèo', 'nuôi chó',
  'thú cưng', 'yoga', 'pilates', 'camping', 'trekking', 'nhiếp ảnh đường phố',
  'quay phim', 'TikTok', 'chơi cờ', 'board game', 'eSports', 'cầu lông', 'tennis', 'võ thuật',
];

const GOAL_POOL = [
  'xây dựng cộng đồng tích cực',
  'mở rộng mạng lưới bạn bè cùng sở thích',
  'chia sẻ kiến thức công nghệ và wellbeing',
  'cải thiện thói quen sống lành mạnh',
  'kết nối với những người truyền cảm hứng',
  'tìm bạn đồng hành khởi nghiệp',
  'tìm người hướng dẫn (mentor)',
  'muốn học thêm kỹ năng mới',
  'tìm kiếm cơ hội việc làm',
  'mở rộng quan hệ đối tác',
  'tìm người chơi thể thao cùng',
  'phát triển kỹ năng giao tiếp',
  'cải thiện tiếng Anh giao tiếp',
  'tìm nhóm học tập',
  'kết nối với những người yêu động vật',
  'lan tỏa năng lượng tích cực',
  'tìm kiếm nguồn cảm hứng sáng tạo',
];

function parseCliOptions() {
  const args = process.argv.slice(2);
  let csvArg = DEFAULT_CSV;
  let limit = Number.isFinite(DEFAULT_LIMIT) && DEFAULT_LIMIT > 0 ? DEFAULT_LIMIT : 70;
  let seed = DEFAULT_SEED;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      const rawLimit = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(rawLimit) && rawLimit > 0) {
        limit = rawLimit;
      }
      continue;
    }

    if (arg.startsWith('--seed=')) {
      seed = arg.slice('--seed='.length) || seed;
      continue;
    }

    if (!arg.startsWith('--')) {
      csvArg = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
    }
  }

  return { csvArg, limit, seed };
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

function pickOne(pool, random) {
  return pool[Math.floor(random() * pool.length)];
}

function pickManyUnique(pool, minItems, maxItems, random) {
  const desired = Math.max(
    minItems,
    Math.min(maxItems, minItems + Math.floor(random() * (maxItems - minItems + 1))),
  );
  const copy = [...pool];
  const picked = [];

  while (copy.length > 0 && picked.length < desired) {
    const idx = Math.floor(random() * copy.length);
    picked.push(copy[idx]);
    copy.splice(idx, 1);
  }

  return picked;
}

function clipText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return trimmed.slice(0, maxLength - 1).trimEnd();
}

function buildRichProfilePayload(record, random) {
  const firstName = pickOne(FIRST_NAME_POOL, random);
  const lastName = pickOne(LAST_NAME_POOL, random);
  const city = pickOne(CITY_POOL, random);
  const district = pickOne(DISTRICT_POOL, random);
  const company = pickOne(COMPANY_POOL, random);
  const school = pickOne(SCHOOL_POOL, random);
  const jobTitle = pickOne(JOB_POOL, random);
  const interests = pickManyUnique(INTEREST_POOL, 5, 8, random).slice(0, 10);
  const goal = pickOne(GOAL_POOL, random);
  const reading = pickOne(INTEREST_POOL, random);

  const bio = clipText(
    `Mình là ${firstName} ${lastName}, đang làm ${jobTitle} tại ${company}. Quan tâm: ${interests.slice(0, 4).join(', ')}. Mục tiêu: ${goal}. Gần đây mình đang tìm hiểu thêm về ${reading}.`,
    255,
  );

  const avatarSeed = encodeURIComponent(`${record.email || ''}-${firstName}-${lastName}`);

  return {
    firstName,
    lastName,
    bio,
    location: clipText(`${district}, ${city}`, 120),
    jobTitle: clipText(jobTitle, 120),
    company: clipText(company, 120),
    school: clipText(school, 120),
    interests,
    avatarUrl: `https://api.dicebear.com/9.x/lorelei/svg?seed=${avatarSeed}`,
  };
}

function buildCreateUserPayload(clerkUser, profilePayload) {
  return {
    id: clerkUser.id,
    email: clerkUser.emailAddresses?.[0]?.emailAddress || '',
    firstName: profilePayload.firstName,
    lastName: profilePayload.lastName,
    bio: profilePayload.bio,
    location: profilePayload.location,
    jobTitle: profilePayload.jobTitle,
    company: profilePayload.company,
    school: profilePayload.school,
    interests: profilePayload.interests,
    avatarUrl: profilePayload.avatarUrl,
  };
}

async function checkUserExistsInAppDatabase(authToken, userId) {
  const response = await fetch(`${API_BASE_URL}/users/${encodeURIComponent(userId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (response.ok) {
    return { exists: true, detail: '' };
  }

  const bodyText = await response.text();
  return {
    exists: false,
    detail: `http_${response.status} ${bodyText.slice(0, 200)}`,
  };
}

async function ensureUserInAppDatabase(createPayload, authToken) {
  const response = await fetch(`${API_BASE_URL}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createPayload),
  });

  if (response.ok) {
    return { status: 'created', detail: '' };
  }

  const bodyText = await response.text();
  const duplicateHint = /duplicate|already exists|unique|conflict/i.test(bodyText);

  if (response.status === 409 || response.status === 422 || duplicateHint) {
    return { status: 'exists', detail: bodyText.slice(0, 200) };
  }

  if (authToken && createPayload?.id) {
    const existenceCheck = await checkUserExistsInAppDatabase(authToken, createPayload.id);
    if (existenceCheck.exists) {
      return {
        status: 'exists',
        detail: `fallback-exists from createError=http_${response.status}`,
      };
    }
  }

  return {
    status: 'failed',
    detail: `http_${response.status} ${bodyText.slice(0, 200)}`,
  };
}

async function updateProfile(authToken, profilePayload) {
  const response = await fetch(`${API_BASE_URL}/users`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(profilePayload),
  });

  if (response.ok) {
    return { status: 'updated', detail: '' };
  }

  const bodyText = await response.text();
  return {
    status: 'failed',
    detail: `http_${response.status} ${bodyText.slice(0, 250)}`,
  };
}

async function run() {
  const { csvArg, limit, seed } = parseCliOptions();
  const csvContent = await fs.readFile(csvArg, 'utf8');
  const allRecords = parseCsv(csvContent);
  const records = allRecords.slice(0, limit);

  if (allRecords.length === 0) {
    console.error(`Không tìm thấy dữ liệu demo trong CSV: ${csvArg}`);
    process.exit(1);
  }

  const clerkClient = createClerkClientFromEnv();
  const tokenPool = new ClerkSessionTokenPool(clerkClient);
  const random = createSeededRandom(seed);

  let processed = 0;
  let synced = 0;
  let existed = 0;
  let updated = 0;
  let failed = 0;

  console.log(`Using CSV: ${csvArg}`);
  console.log(`Limit: ${records.length}/${allRecords.length}`);
  console.log(`Seed: ${seed}`);
  console.log(`Dry run: ${DRY_RUN ? 'yes' : 'no'}`);
  console.log('');

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const profilePayload = buildRichProfilePayload(record, random);

    if (!record.email) {
      failed += 1;
      console.log(`THẤT BẠI row=${index + 2} | thiếu email`);
      continue;
    }

    if (DRY_RUN) {
      processed += 1;
      if (processed <= 3) {
        console.log(`DRYRUN  ${record.email} | ${JSON.stringify(profilePayload)}`);
      } else {
        console.log(`DRYRUN  ${record.email} | rich profile generated`);
      }
      continue;
    }

    try {
      const clerkUser = await getClerkUserByEmail(clerkClient, record.email);
      if (!clerkUser) {
        failed += 1;
        console.log(`THẤT BẠI ${record.email} | không tìm thấy user trên Clerk`);
        continue;
      }

      const createPayload = buildCreateUserPayload(clerkUser, profilePayload);
      const jwt = await tokenPool.getTokenForUser(clerkUser.id);
      const syncResult = await ensureUserInAppDatabase(createPayload, jwt);
      if (syncResult.status === 'failed') {
        failed += 1;
        console.log(`THẤT BẠI ${record.email} | đồng bộ user lỗi: ${syncResult.detail}`);
        continue;
      }

      if (syncResult.status === 'created') {
        synced += 1;
      } else {
        existed += 1;
      }

      const updateResult = await updateProfile(jwt, profilePayload);

      processed += 1;
      if (updateResult.status === 'updated') {
        updated += 1;
        console.log(`ĐÃ CẬP NHẬT ${record.email} | đồng bộ=${syncResult.status}`);
      } else {
        failed += 1;
        console.log(`THẤT BẠI ${record.email} | cập nhật profile lỗi: ${updateResult.detail}`);
      }
    } catch (error) {
      failed += 1;
      console.log(`THẤT BẠI ${record.email} | ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await tokenPool.revokeAll();

  console.log('');
  console.log('Tổng kết cập nhật profile rich');
  console.log(`- Tổng tài khoản:       ${records.length}`);
  console.log(`- Đồng bộ user mới:     ${synced}`);
  console.log(`- User đã tồn tại app:  ${existed}`);
  console.log(`- Cập nhật profile OK:  ${updated}`);
  console.log(`- Đã xử lý:             ${processed}`);
  console.log(`- Lỗi:                  ${failed}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
