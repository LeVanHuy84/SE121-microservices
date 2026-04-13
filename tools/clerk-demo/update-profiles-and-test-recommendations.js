#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const { createClerkClient } = require('@clerk/backend');

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000/api/v1';
const DRY_RUN = process.env.DRY_RUN === '1';
const VIEWER_EMAIL = process.env.VIEWER_EMAIL || '';
const RECOMMEND_LIMIT = Number.parseInt(process.env.RECOMMEND_LIMIT || '20', 10);

const FIRST_NAME_POOL = [
  'An',
  'Bình',
  'Chi',
  'Dũng',
  'Giang',
  'Hà',
  'Hải',
  'Hương',
  'Khánh',
  'Lan',
  'Linh',
  'Mai',
  'Minh',
  'My',
  'Nam',
  'Ngân',
  'Ngọc',
  'Nhung',
  'Phúc',
  'Phương',
  'Quang',
  'Quỳnh',
  'Sơn',
  'Thanh',
  'Thảo',
  'Thu',
  'Trang',
  'Trúc',
  'Tuấn',
  'Việt',
  'Vy',
  'Yến',
];

const LAST_NAME_POOL = [
  'Nguyễn',
  'Trần',
  'Lê',
  'Phạm',
  'Hoàng',
  'Phan',
  'Vũ',
  'Võ',
  'Đặng',
  'Bùi',
  'Đỗ',
  'Hồ',
  'Ngô',
  'Dương',
  'Lý',
];

const CITY_POOL = [
  'TP. Hồ Chí Minh',
  'Hà Nội',
  'Đà Nẵng',
  'Cần Thơ',
  'Huế',
  'Hải Phòng',
  'Nha Trang',
  'Biên Hòa',
  'Vũng Tàu',
  'Quy Nhơn',
];

const COMPANY_POOL = [
  'Mạng Xã Hội Sen Việt',
  'Công nghệ Tâm An',
  'Phòng Lab Sông Xanh',
  'Xưởng Bình Minh',
  'Cộng Đồng Mở',
  'Sóng Mới Digital',
  'Kết Nối Đô Thị',
  'Nền Tảng Hoa Sen',
];

const JOB_POOL = [
  'Kỹ sư Backend',
  'Kỹ sư Frontend',
  'Kỹ sư Mobile',
  'Thiết kế sản phẩm',
  'Phân tích dữ liệu',
  'Kỹ sư QA',
  'Kỹ sư DevOps',
  'Quản lý cộng đồng',
];

const SCHOOL_POOL = [
  'HCMUT',
  'UIT',
  'UEH',
  'DUT',
  'VNU',
  'Đại học FPT',
  'HUST',
  'Đại học Cần Thơ',
];

const INTEREST_POOL = [
  'công nghệ',
  'chạy bộ',
  'âm nhạc',
  'xem phim',
  'thể hình',
  'thiết kế',
  'khởi nghiệp',
  'du lịch',
  'đọc sách',
  'nhiếp ảnh',
  'cộng đồng',
  'chơi game',
  'ẩm thực',
  'cà phê',
  'tình nguyện',
];

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

function pick(arr, index, offset = 0) {
  return arr[(index + offset) % arr.length];
}

function pickInterests(index) {
  return [
    pick(INTEREST_POOL, index, 0),
    pick(INTEREST_POOL, index, 3),
    pick(INTEREST_POOL, index, 7),
  ];
}

function buildProfilePayload(record, index) {
  const city = pick(CITY_POOL, index);
  const company = pick(COMPANY_POOL, index);
  const school = pick(SCHOOL_POOL, index);
  const jobTitle = pick(JOB_POOL, index);
  const interests = pickInterests(index);
  const firstName = pick(FIRST_NAME_POOL, index);
  const lastName = pick(LAST_NAME_POOL, index, 5);

  return {
    firstName,
    lastName,
    bio: `Xin chào, mình là ${firstName} ${lastName}, hiện đang làm ${jobTitle} tại ${company}. Mình quan tâm đến ${interests.join(', ')} và thích kết nối với mọi người có cùng sở thích.`,
    location: city,
    jobTitle,
    company,
    school,
    interests,
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
  };
}

async function readDemoUsers(csvPath) {
  const csvContent = await fs.readFile(csvPath, 'utf8');
  return parseCsv(csvContent);
}

async function getClerkUserByEmail(clerkClient, email) {
  const result = await clerkClient.users.getUserList({
    emailAddress: [email],
    limit: 1,
  });
  return result?.data?.[0] || null;
}

async function ensureUserInAppDatabase(createPayload) {
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

  return {
    status: 'failed',
    detail: `http_${response.status} ${bodyText.slice(0, 200)}`,
  };
}

async function createSessionToken(clerkClient, userId) {
  const session = await clerkClient.sessions.createSession({ userId });
  const token = await clerkClient.sessions.getToken(session.id);
  return {
    sessionId: session.id,
    jwt: token.jwt,
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

async function getRecommendations(authToken, limit) {
  const response = await fetch(
    `${API_BASE_URL}/social/friends/recommend?limit=${limit}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    },
  );

  const text = await response.text();
  let payload = null;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

async function run() {
  const csvArg = process.argv[2] || 'tools/clerk-demo/demo-clerk-users.csv';
  const csvPath = path.resolve(process.cwd(), csvArg);
  const records = await readDemoUsers(csvPath);

  if (records.length === 0) {
    console.error(`Không tìm thấy dữ liệu demo trong CSV: ${csvPath}`);
    process.exit(1);
  }

  if (!DRY_RUN && !CLERK_SECRET_KEY) {
    console.error('Thiếu biến môi trường CLERK_SECRET_KEY');
    process.exit(1);
  }

  const clerkClient = createClerkClient({
    secretKey: CLERK_SECRET_KEY,
    publishableKey: CLERK_PUBLISHABLE_KEY,
  });

  let processed = 0;
  let updated = 0;
  let failed = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const profilePayload = buildProfilePayload(record, index);

    if (!record.email) {
      failed += 1;
      console.log(`THẤT BẠI row=${index + 2} | thiếu email`);
      continue;
    }

    if (DRY_RUN) {
      processed += 1;
      console.log(`DRYRUN  ${record.email} | đã tạo dữ liệu profile tiếng Việt`);
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
      const syncResult = await ensureUserInAppDatabase(createPayload);
      if (syncResult.status === 'failed') {
        failed += 1;
        console.log(`THẤT BẠI ${record.email} | đồng bộ user lỗi: ${syncResult.detail}`);
        continue;
      }

      const { sessionId, jwt } = await createSessionToken(clerkClient, clerkUser.id);
      const updateResult = await updateProfile(jwt, profilePayload);

      await clerkClient.sessions.revokeSession(sessionId).catch(() => {});

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

  console.log('');
  console.log('Tổng kết cập nhật profile');
  console.log(`- Tổng tài khoản: ${records.length}`);
  console.log(`- Đã xử lý:       ${processed}`);
  console.log(`- Cập nhật OK:    ${updated}`);
  console.log(`- Lỗi:            ${failed}`);

  if (DRY_RUN) {
    return;
  }

  const viewerEmail = VIEWER_EMAIL || records[0]?.email;
  if (!viewerEmail) {
    console.log('Không có tài khoản viewer để test endpoint gợi ý.');
    return;
  }

  const viewer = await getClerkUserByEmail(clerkClient, viewerEmail);
  if (!viewer) {
    console.log(`Không tìm thấy viewer trên Clerk: ${viewerEmail}`);
    return;
  }

  const { sessionId, jwt } = await createSessionToken(clerkClient, viewer.id);
  const recommendationResult = await getRecommendations(jwt, Number.isFinite(RECOMMEND_LIMIT) ? RECOMMEND_LIMIT : 20);
  await clerkClient.sessions.revokeSession(sessionId).catch(() => {});

  console.log('');
  console.log(`Tài khoản test gợi ý: ${viewerEmail}`);
  console.log(`- Endpoint: ${API_BASE_URL}/social/friends/recommend?limit=${RECOMMEND_LIMIT}`);
  console.log(`- HTTP: ${recommendationResult.status}`);

  if (!recommendationResult.ok) {
    console.log('- Kết quả: THẤT BẠI');
    console.log(JSON.stringify(recommendationResult.payload, null, 2));
    return;
  }

  const data = Array.isArray(recommendationResult.payload?.data)
    ? recommendationResult.payload.data
    : [];

  console.log(`- Số lượng gợi ý: ${data.length}`);
  console.log('- Top 10 candidate id:');
  data.slice(0, 10).forEach((candidate, idx) => {
    console.log(`  ${idx + 1}. ${candidate?.id || '(unknown)'}`);
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
