import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ==============================================================================
// Custom Performance & Functional Metrics
// ==============================================================================
const duplicateItemsCounter = new Counter('duplicate_items_total');
const duplicateRate = new Rate('duplicate_rate');
const firstPageDuration = new Trend('first_page_duration_ms', true);
const scrollPageDuration = new Trend('scroll_page_duration_ms', true);
const sessionItemsCount = new Counter('session_feed_items_fetched');

// Configuration Flags
const isSmokeTest = __ENV.SMOKE_TEST === 'true';
const profile = (__ENV.LOAD_PROFILE || 'full').toLowerCase(); // 'standard' (200 VUs, 3m), 'sustained' (200-250 VUs, 6m), 'full' / 'stress' (350-400 VUs, 4m), 'smoke'
const targetVUs = __ENV.TARGET_VUS ? parseInt(__ENV.TARGET_VUS, 10) : 0;
const sustainedVUs = targetVUs > 0 ? targetVUs : 200;
const peakVUs = targetVUs > 0 ? targetVUs : 350;

// Determine Stages based on Test Profile
function getStages() {
  if (isSmokeTest || profile === 'smoke') {
    return [
      { duration: '3s', target: 10 },
      { duration: '10s', target: 10 },
      { duration: '3s', target: 0 },
    ];
  }

  if (profile === 'sustained' || profile === 'endurance' || profile === 'steady') {
    // Sustained / Endurance Test: Proves long-term stability & no memory leaks (200 - 250 VUs maintained for 6m)
    return [
      { duration: '30s', target: sustainedVUs }, // Warmup stage to target VUs
      { duration: '5m', target: sustainedVUs },  // 5 minutes constant steady-state load
      { duration: '30s', target: 0 },            // Graceful cooldown
    ];
  }

  if (profile === 'standard') {
    // Standard Load Test matching Thesis Commitment (100 - 200 VUs)
    return [
      { duration: '30s', target: 50 },  // Warmup stage
      { duration: '2m', target: 200 },   // Steady-state target load (100-200 VUs)
      { duration: '30s', target: 0 },    // Graceful ramp-down
    ];
  }

  // Full High-Concurrency & Peak Stress Profile (Up to 350 - 400 VUs)
  return [
    { duration: '30s', target: 50 },   // Warmup stage & Redis snapshot pre-fill
    { duration: '1m30s', target: 200 }, // Normal-high stage (Thesis target)
    { duration: '1m30s', target: peakVUs }, // Peak stress stage (350 - 400 VUs)
    { duration: '30s', target: 0 },    // Ramp-down stage
  ];
}

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    feed_browsing_sessions: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: getStages(),
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                 // Error rate < 1% (Thesis SLO)
    http_req_duration: ['p(95)<300', 'p(99)<800'], // p95 < 300ms, p99 < 800ms (Thesis SLO)
    duplicate_rate: ['rate==0'],                    // 0.0000% duplicate items in session (Deterministic guarantee)
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://api-gateway:4000';
const NUM_TEST_USERS = __ENV.NUM_USERS ? parseInt(__ENV.NUM_USERS, 10) : 350;

// Realistic session browsing: 1 Cold Fetch + 7 Scroll Pages (Cache Hit Ratio ~ 87.5%)
const PAGES_PER_SESSION = __ENV.PAGES_PER_SESSION ? parseInt(__ENV.PAGES_PER_SESSION, 10) : 8;

// Realistic human browsing think-time (Natural pacing: 1.2s - 2.0s to skim headlines & images)
const PACING_MODE = (__ENV.PACING_MODE || 'realistic').toLowerCase();
const scrollThinkTime = PACING_MODE === 'fast' 
  ? () => 0.55 + Math.random() * 0.35 // Active fast reader: 0.55s - 0.9s (Mean ~0.72s, yields ~240 RPS)
  : () => 1.2 + Math.random() * 0.8; // Realistic human browsing: 1.2s - 2.0s (Mean ~1.6s, yields ~110 RPS)
const interSessionSleep = PACING_MODE === 'fast' 
  ? () => 0.6 + Math.random() * 0.4 // 0.6s - 1.0s pause between sessions
  : () => 1.5 + Math.random() * 1.0; // 1.5s - 2.5s inter-session pause

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
  // 1. Assign dedicated User ID per Virtual User (1:1 mapping: VU 1 -> load_user_1, ...)
  const vuId = (__VU && __VU > 0) ? __VU : 1;
  const userNum = ((vuId - 1) % NUM_TEST_USERS) + 1;
  const userId = `load_user_${userNum}`;

  const headers = {
    'Content-Type': 'application/json',
    'x-mock-user-id': userId,
    'Authorization': `Bearer mock_user_${userId}`,
  };

  const seenPostIds = new Set();

  // ----------------------------------------------------------------------------
  // 2. Fetch Initial Page (Page 1) — Cold Fetch: Triggers Ranking + Session Snapshot
  // ----------------------------------------------------------------------------
  const page1Start = Date.now();
  const page1Res = http.get(`${BASE_URL}/api/v1/feeds/my-feed?limit=10`, {
    headers,
    tags: { name: '01_FirstPage' },
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

  // ----------------------------------------------------------------------------
  // 3. User Scrolling Pages (Page 2 to PAGES_PER_SESSION) — Warm Fetch: Hit Redis ZSET
  // ----------------------------------------------------------------------------
  for (let page = 2; page <= PAGES_PER_SESSION; page++) {
    if (!currentCursor) {
      break;
    }

    // Realistic user scroll think-time (Configurable via PACING_MODE)
    sleep(scrollThinkTime());

    const scrollStart = Date.now();
    const encodedCursor = encodeURIComponent(currentCursor);
    const scrollRes = http.get(
      `${BASE_URL}/api/v1/feeds/my-feed?limit=10&cursor=${encodedCursor}`,
      {
        headers,
        tags: { name: '02_ScrollPage' },
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

    // Check duplicate postIds across pages within the same browsing session
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

  // Realistic inter-session pause before virtual user starts next browsing cycle
  sleep(interSessionSleep());
}

export function handleSummary(data) {
  const v = data.metrics.http_req_duration?.values || {};
  const p50 = v.med != null ? v.med.toFixed(2) : (v['p(50)'] != null ? v['p(50)'].toFixed(2) : '0');
  const p95 = v['p(95)'] != null ? v['p(95)'].toFixed(2) : (v['p(90)'] != null ? v['p(90)'].toFixed(2) : '0');
  const p99 = v['p(99)'] != null ? v['p(99)'].toFixed(2) : '0';
  const peak = v.max != null ? v.max.toFixed(2) : '0';
  const avg = v.avg != null ? v.avg.toFixed(2) : '0';
  const reqTotal = data.metrics.http_reqs?.values?.count ?? 0;
  const reqRate = data.metrics.http_reqs?.values?.rate != null ? data.metrics.http_reqs.values.rate.toFixed(2) : '0';
  const failRate = data.metrics.http_req_failed?.values?.rate != null ? (data.metrics.http_req_failed.values.rate * 100).toFixed(2) : '0';
  const dupRate = data.metrics.duplicate_rate?.values?.rate != null ? (data.metrics.duplicate_rate.values.rate * 100).toFixed(4) : '0';

  const firstP95 = data.metrics.first_page_duration_ms?.values?.['p(95)']?.toFixed(2) || 'N/A';
  const scrollP95 = data.metrics.scroll_page_duration_ms?.values?.['p(95)']?.toFixed(2) || 'N/A';

  console.log('\n================================================================');
  console.log('            🎯 K6 LOAD TEST BENCHMARK SUMMARY                   ');
  console.log('================================================================');
  console.log(`Active Profile:         ${profile.toUpperCase()} (Pages/Session: ${PAGES_PER_SESSION})`);
  console.log(`Total HTTP Requests:    ${reqTotal}`);
  console.log(`Throughput (RPS):       ${reqRate} req/s (Thesis Target: 200 - 400 RPS)`);
  console.log(`Latency Avg:            ${avg} ms`);
  console.log(`Latency P50 (Median):   ${p50} ms`);
  console.log(`Latency P95 (Overall):  ${p95} ms (Target < 300 ms)`);
  console.log(`Latency P99:            ${p99} ms (Target < 800 ms)`);
  console.log(`Latency Max (Outlier):  ${peak} ms`);
  console.log(`- Page 1 P95 (Cold):    ${firstP95} ms (DB Query + ISO-Ranking)`);
  console.log(`- Scroll P95 (Cache):   ${scrollP95} ms (Redis ZSET Session Snapshot)`);
  console.log(`Failed Request Rate:    ${failRate}% (Target < 1.0%)`);
  console.log(`Duplicate Items Rate:   ${dupRate}% (Deterministic Target: 0.0000%)`);
  console.log('================================================================\n');

  const summaryMap = {
    'stdout': '',
    '/scripts/results/summary.json': JSON.stringify(data, null, 2),
  };
  summaryMap[`/scripts/results/summary-${profile}.json`] = JSON.stringify(data, null, 2);

  return summaryMap;
}
