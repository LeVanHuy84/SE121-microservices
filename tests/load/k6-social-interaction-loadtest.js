import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ==============================================================================
// Custom Performance & Functional Metrics [LT-03: Social Engagement]
// ==============================================================================
const interactionsCounter = new Counter('interactions_total');
const reactionDuration = new Trend('reaction_duration_ms', true);
const commentDuration = new Trend('comment_duration_ms', true);

// Configuration Flags
const isSmokeTest = __ENV.SMOKE_TEST === 'true';
const profile = (__ENV.LOAD_PROFILE || 'standard').toLowerCase(); // 'standard' (100 VUs), 'sustained' (150 VUs), 'stress' (250 VUs), 'smoke'
const targetVUs = __ENV.TARGET_VUS ? parseInt(__ENV.TARGET_VUS, 10) : 0;
const defaultVUs = profile === 'sustained' ? 150 : (profile === 'stress' ? 250 : 100);
const activeVUs = targetVUs > 0 ? targetVUs : defaultVUs;

function getStages() {
  if (isSmokeTest || profile === 'smoke') {
    return [
      { duration: '3s', target: 10 },
      { duration: '10s', target: 10 },
      { duration: '3s', target: 0 },
    ];
  }

  if (profile === 'sustained') {
    return [
      { duration: '30s', target: activeVUs },
      { duration: '5m', target: activeVUs },
      { duration: '30s', target: 0 },
    ];
  }

  if (profile === 'stress') {
    return [
      { duration: '30s', target: 50 },
      { duration: '1m30s', target: 150 },
      { duration: '1m30s', target: activeVUs },
      { duration: '30s', target: 0 },
    ];
  }

  return [
    { duration: '20s', target: activeVUs },
    { duration: '2m', target: activeVUs },
    { duration: '20s', target: 0 },
  ];
}

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    social_engagement: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: getStages(),
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                 // Error rate < 1% (Thesis SLO)
    http_req_duration: ['p(95)<250', 'p(99)<600'], // p95 < 250ms, p99 < 600ms
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://api-gateway:4000';
const NUM_TEST_USERS = __ENV.NUM_USERS ? parseInt(__ENV.NUM_USERS, 10) : 350;

const REACTION_TYPES = ['LIKE', 'LOVE', 'SADNESS', 'ANGER', 'FEAR', 'JOY', 'DISGUST'];
const SAMPLE_COMMENTS = [
  'Đồng cảm với bạn!',
  'Bài viết rất hay và ý nghĩa ❤️',
  'Cố gắng lên nhé mọi chuyện rồi sẽ ổn thôi.',
  'Chúc bạn một ngày nhiều năng lượng tích cực!',
  'Cảm ơn bạn đã chia sẻ câu chuyện này.',
];

// Fallback seed post UUIDs in case feed discovery has cold cache
const FALLBACK_POST_IDS = [
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000005',
];

export default function () {
  const vuId = (__VU && __VU > 0) ? __VU : 1;
  const userNum = ((vuId - 1) % NUM_TEST_USERS) + 1;
  const userId = `load_user_${userNum}`;

  const headers = {
    'Content-Type': 'application/json',
    'x-mock-user-id': userId,
    'Authorization': `Bearer mock_user_${userId}`,
  };

  // 1. Discover active post IDs from Trending Feed
  let targetPostId = FALLBACK_POST_IDS[vuId % FALLBACK_POST_IDS.length];
  const feedRes = http.get(`${BASE_URL}/api/v1/feeds/trending?limit=5`, {
    headers,
    tags: { name: '01_DiscoverPosts' },
  });

  if (feedRes.status === 200) {
    try {
      const body = feedRes.json();
      const items = body.items || (Array.isArray(body.data) ? body.data : body.data?.items) || [];
      if (items.length > 0) {
        const picked = items[Math.floor(Math.random() * items.length)];
        const discoveredId = picked.item?.postId || picked.postId || picked.id;
        if (discoveredId) {
          targetPostId = discoveredId;
        }
      }
    } catch (e) {
      // Use fallback post ID
    }
  }

  // 2. Perform 60% Reaction / 40% Comment action
  const isReaction = Math.random() < 0.6;

  if (isReaction) {
    const rxType = REACTION_TYPES[Math.floor(Math.random() * REACTION_TYPES.length)];
    const payload = JSON.stringify({
      targetId: targetPostId,
      targetType: 'POST',
      reactionType: rxType,
    });

    const rxStart = Date.now();
    const rxRes = http.post(`${BASE_URL}/api/v1/reactions`, payload, {
      headers,
      tags: { name: '02_ReactPost' },
    });
    reactionDuration.add(Date.now() - rxStart);

    const isOk = check(rxRes, {
      'Reaction submitted (HTTP 200/201)': (r) => r.status === 200 || r.status === 201,
    });
    if (isOk) {
      interactionsCounter.add(1);
    }
  } else {
    const commentContent = SAMPLE_COMMENTS[Math.floor(Math.random() * SAMPLE_COMMENTS.length)];
    const payload = JSON.stringify({
      postId: targetPostId,
      content: `${commentContent} [u:${userNum}]`,
    });

    const cmtStart = Date.now();
    const cmtRes = http.post(`${BASE_URL}/api/v1/comments`, payload, {
      headers,
      tags: { name: '03_CommentPost' },
    });
    commentDuration.add(Date.now() - cmtStart);

    const isOk = check(cmtRes, {
      'Comment created (HTTP 200/201)': (r) => r.status === 200 || r.status === 201,
    });
    if (isOk) {
      interactionsCounter.add(1);
    }
  }

  // Realistic human think-time between social interactions (0.5s - 1.2s)
  sleep(0.5 + Math.random() * 0.7);
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
  const interactions = data.metrics.interactions_total?.values?.count ?? 0;

  const rxP95 = data.metrics.reaction_duration_ms?.values?.['p(95)']?.toFixed(2) || 'N/A';
  const cmtP95 = data.metrics.comment_duration_ms?.values?.['p(95)']?.toFixed(2) || 'N/A';

  console.log('\n================================================================');
  console.log('        🎯 K6 SOCIAL INTERACTIONS BENCHMARK SUMMARY             ');
  console.log('================================================================');
  console.log(`Active Profile:         ${profile.toUpperCase()}`);
  console.log(`Total HTTP Requests:    ${reqTotal}`);
  console.log(`Interactions Total:     ${interactions}`);
  console.log(`Throughput (RPS):       ${reqRate} req/s (Thesis Target: 150 - 250 RPS)`);
  console.log(`Latency Avg:            ${avg} ms`);
  console.log(`Latency P50 (Median):   ${p50} ms`);
  console.log(`Latency P95 (Overall):  ${p95} ms (Target < 250 ms)`);
  console.log(`Latency P99:            ${p99} ms (Target < 600 ms)`);
  console.log(`Latency Max (Outlier):  ${peak} ms`);
  console.log(`- Reaction P95:         ${rxP95} ms`);
  console.log(`- Comment P95:          ${cmtP95} ms`);
  console.log(`Failed Request Rate:    ${failRate}% (Target < 1.0%)`);
  console.log('================================================================\n');

  const summaryMap = {
    'stdout': '',
    '/scripts/results/summary.json': JSON.stringify(data, null, 2),
    '/scripts/results/summary-interaction.json': JSON.stringify(data, null, 2),
  };
  summaryMap[`/scripts/results/summary-interaction-${profile}.json`] = JSON.stringify(data, null, 2);

  return summaryMap;
}
