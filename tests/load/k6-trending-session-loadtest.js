import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom Metrics
const duplicateItemsCounter = new Counter('duplicate_items_total');
const duplicateRate = new Rate('duplicate_rate');
const firstPageDuration = new Trend('first_page_duration_ms', true);
const scrollPageDuration = new Trend('scroll_page_duration_ms', true);
const sessionItemsCount = new Counter('session_feed_items_fetched');

const isSmokeTest = __ENV.SMOKE_TEST === 'true';

export const options = {
  scenarios: {
    trending_browsing_sessions: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: isSmokeTest
        ? [
            { duration: '3s', target: 10 },
            { duration: '10s', target: 10 },
            { duration: '3s', target: 0 },
          ]
        : [
            { duration: '30s', target: 50 },  // Warmup stage
            { duration: '2m', target: 200 },   // Normal-high load stage
            { duration: '1m', target: 350 },   // Peak stress stage
            { duration: '30s', target: 0 },    // Ramp-down stage
          ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],         // Error rate < 1%
    http_req_duration: ['p(95)<300', 'p(99)<800'], // p95 < 300ms, p99 < 800ms
    duplicate_rate: ['rate==0'],            // 0% duplicate posts in session
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://api-gateway:4000';
const NUM_TEST_USERS = 350;
const PAGES_PER_SESSION = 4; // 1 initial page + 3 scroll pages

function extractFeedData(res) {
  try {
    const body = res.json();
    const items =
      body.items ||
      (Array.isArray(body.data) ? body.data : body.data?.items) ||
      [];
    const nextCursor =
      body.metadata?.nextCursor ||
      body.nextCursor ||
      body.data?.metadata?.nextCursor ||
      null;
    return { items, nextCursor };
  } catch (e) {
    return { items: [], nextCursor: null };
  }
}

export default function () {
  // 1. Assign 1:1 dedicated User ID per Virtual User (VU 1 -> load_user_1, ..., VU 350 -> load_user_350)
  const vuId = (__VU && __VU > 0) ? __VU : 1;
  const userNum = ((vuId - 1) % NUM_TEST_USERS) + 1;
  const userId = `load_user_${userNum}`;

  const headers = {
    'Content-Type': 'application/json',
    'x-mock-user-id': userId,
    'Authorization': `Bearer mock_user_${userId}`,
  };

  const seenPostIds = new Set();

  // 2. Fetch Initial Page (Page 1) - Triggers Redis ZSET scan + ISO Emotion Re-ranking + Session List Persist
  const page1Start = Date.now();
  const page1Res = http.get(`${BASE_URL}/api/v1/feeds/trending?limit=10`, {
    headers,
    tags: { name: '01_TrendingFirstPage' },
  });
  firstPageDuration.add(Date.now() - page1Start);

  const { items: page1Items, nextCursor: page1NextCursor } = extractFeedData(page1Res);

  const isPage1Ok = check(page1Res, {
    'Page 1 status is 200': (r) => r.status === 200,
    'Page 1 has items array': () => Array.isArray(page1Items) && page1Items.length > 0,
  });

  if (!isPage1Ok) {
    return;
  }

  // Track duplicates for Page 1
  for (const item of page1Items) {
    const postId = item.item?.postId || item.postId || item.id;
    if (postId) {
      if (seenPostIds.has(postId)) {
        duplicateItemsCounter.add(1);
        duplicateRate.add(1);
      } else {
        seenPostIds.add(postId);
        duplicateRate.add(0);
      }
    }
  }
  sessionItemsCount.add(page1Items.length);

  let currentCursor = page1NextCursor;

  // 3. User Scrolling Sessions (Page 2, 3, 4) - Reads directly from Redis Session Snapshot
  for (let page = 2; page <= PAGES_PER_SESSION; page++) {
    if (!currentCursor) {
      break;
    }

    // Realistic user scroll think-time (0.2s - 0.5s)
    sleep(0.2 + Math.random() * 0.3);

    const scrollStart = Date.now();
    const encodedCursor = encodeURIComponent(currentCursor);
    const scrollRes = http.get(
      `${BASE_URL}/api/v1/feeds/trending?limit=10&cursor=${encodedCursor}`,
      {
        headers,
        tags: { name: '02_TrendingScrollPage' },
      },
    );
    scrollPageDuration.add(Date.now() - scrollStart);

    const { items: scrollItems, nextCursor: scrollNextCursor } = extractFeedData(scrollRes);

    const isScrollOk = check(scrollRes, {
      [`Page ${page} status is 200`]: (r) => r.status === 200,
      [`Page ${page} has items`]: () => Array.isArray(scrollItems) && scrollItems.length > 0,
    });

    if (!isScrollOk) {
      break;
    }

    // Check duplicate postIds across pages in the same session
    for (const item of scrollItems) {
      const postId = item.item?.postId || item.postId || item.id;
      if (postId) {
        if (seenPostIds.has(postId)) {
          duplicateItemsCounter.add(1);
          duplicateRate.add(1);
        } else {
          seenPostIds.add(postId);
          duplicateRate.add(0);
        }
      }
    }
    sessionItemsCount.add(scrollItems.length);

    currentCursor = scrollNextCursor;
  }

  // Session inter-arrival pacing (1s - 2s)
  sleep(1.0 + Math.random() * 1.0);
}
