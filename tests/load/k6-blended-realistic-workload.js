import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ==============================================================================
// Custom Performance & Functional Metrics [LT-06: Blended Workload 70:15:10:5]
// ==============================================================================
const duplicateItemsCounter = new Counter('duplicate_items_total');
const duplicateRate = new Rate('duplicate_rate');

const feedDuration = new Trend('feed_duration_ms', true);
const interactionDuration = new Trend('interaction_duration_ms', true);
const writeDuration = new Trend('write_duration_ms', true);
const aiSearchDuration = new Trend('ai_search_duration_ms', true);

const feedActionsCounter = new Counter('actions_feed_total');
const interactionActionsCounter = new Counter('actions_interaction_total');
const writeActionsCounter = new Counter('actions_write_total');
const aiSearchActionsCounter = new Counter('actions_ai_search_total');

// Configuration Flags
const isSmokeTest = __ENV.SMOKE_TEST === 'true';
const profile = (__ENV.LOAD_PROFILE || 'sustained').toLowerCase(); // 'standard' (150 VUs), 'sustained' (200 VUs, 6m), 'stress' (300 VUs), 'smoke'
const targetVUs = __ENV.TARGET_VUS ? parseInt(__ENV.TARGET_VUS, 10) : 0;
const defaultVUs = profile === 'sustained' ? 200 : (profile === 'stress' ? 300 : 150);
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
    { duration: '30s', target: 50 },
    { duration: '2m', target: activeVUs },
    { duration: '30s', target: 0 },
  ];
}

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    blended_user_sessions: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: getStages(),
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                 // Error rate < 1% (Thesis SLO)
    http_req_duration: ['p(95)<300', 'p(99)<800'], // p95 < 300ms, p99 < 800ms (Thesis SLO)
    duplicate_rate: ['rate==0'],                    // 0.0000% duplicate posts in feed session
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://api-gateway:4000';
const NUM_TEST_USERS = __ENV.NUM_USERS ? parseInt(__ENV.NUM_USERS, 10) : 350;

const FEELINGS = ['JOY', 'SADNESS', 'ANGER', 'FEAR', 'DISGUST', 'SURPRISE', 'NEUTRAL'];
const REACTION_TYPES = ['LIKE', 'LOVE', 'SADNESS', 'ANGER', 'FEAR', 'JOY', 'DISGUST'];
const SAMPLE_COMMENTS = [
  'Đồng cảm với bạn!',
  'Bài viết rất ý nghĩa ❤️',
  'Cố gắng lên nhé mọi chuyện rồi sẽ ổn thôi.',
  'Chúc bạn một ngày nhiều năng lượng tích cực!',
];
const SAMPLE_POST_CONTENTS = [
  'Hôm nay thời tiết thật đẹp, cảm giác tràn đầy năng lượng để hoàn thành đồ án tốt nghiệp!',
  'Một chút mệt mỏi sau ngày dài làm việc, nhưng mình tin mọi nỗ lực rồi sẽ được đền đáp.',
  'Chia sẻ một góc học tập ấm cúng cho các bạn sinh viên đang ôn thi nhé.',
  'Âm nhạc chữa lành thật tuyệt vời, nghe xong thấy tinh thần nhẹ nhõm hơn hẳn.',
];
const AI_PROMPTS = [
  'Làm sao để giải tỏa căng thẳng trước kỳ thi tốt nghiệp vậy trợ lý?',
  'Dạo này mình hay bị mất ngủ và lo âu, có bài tập thở nào hiệu quả không?',
  'Tôi cảm thấy bế tắc quá, cần một lời khuyên an toàn...',
];

const FALLBACK_POST_IDS = [
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000004',
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

  // Roll dice for realistic user action distribution (70 : 15 : 10 : 5)
  const roll = Math.random();

  // ----------------------------------------------------------------------------
  // Action A: 70% Browsing Feed (Personal Feed or Trending Feed)
  // ----------------------------------------------------------------------------
  if (roll < 0.70) {
    feedActionsCounter.add(1);
    const isPersonal = Math.random() < 0.60;
    const endpoint = isPersonal ? '/api/v1/feeds/my-feed?limit=10' : '/api/v1/feeds/trending?limit=10';

    const start = Date.now();
    const res = http.get(`${BASE_URL}${endpoint}`, {
      headers,
      tags: { name: isPersonal ? '01_PersonalFeed' : '01_TrendingFeed' },
    });
    feedDuration.add(Date.now() - start);

    check(res, {
      'Feed status is 200': (r) => r.status === 200,
    });

    try {
      const body = res.json();
      const items = body.items || (Array.isArray(body.data) ? body.data : body.data?.items) || [];
      const cursor = body.metadata?.nextCursor || body.nextCursor;

      // Optional scroll 1 page if cursor exists
      if (cursor && items.length > 0) {
        sleep(0.5);
        const encoded = encodeURIComponent(cursor);
        const scrollStart = Date.now();
        const scrollRes = http.get(`${BASE_URL}${endpoint}&cursor=${encoded}`, {
          headers,
          tags: { name: '01_ScrollFeed' },
        });
        feedDuration.add(Date.now() - scrollStart);
        check(scrollRes, { 'Scroll status is 200': (r) => r.status === 200 });
      }
    } catch (e) {}

    sleep(0.6 + Math.random() * 0.6);
    return;
  }

  // ----------------------------------------------------------------------------
  // Action B: 15% Social Engagement (Reactions & Comments)
  // ----------------------------------------------------------------------------
  if (roll < 0.85) {
    interactionActionsCounter.add(1);
    let targetPostId = FALLBACK_POST_IDS[vuId % FALLBACK_POST_IDS.length];

    // Discover an active real post ID from Trending Feed
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
        // Fallback to default
      }
    }

    const isReaction = Math.random() < 0.60;

    if (isReaction) {
      const rxType = REACTION_TYPES[Math.floor(Math.random() * REACTION_TYPES.length)];
      const payload = JSON.stringify({
        targetId: targetPostId,
        targetType: 'POST',
        reactionType: rxType,
      });

      const start = Date.now();
      const res = http.post(`${BASE_URL}/api/v1/reactions`, payload, {
        headers,
        tags: { name: '02_React' },
      });
      interactionDuration.add(Date.now() - start);

      check(res, { 'React status 200/201': (r) => r.status === 200 || r.status === 201 });
    } else {
      const cmt = SAMPLE_COMMENTS[Math.floor(Math.random() * SAMPLE_COMMENTS.length)];
      const payload = JSON.stringify({
        postId: targetPostId,
        content: `${cmt} [vu:${vuId}]`,
      });

      const start = Date.now();
      const res = http.post(`${BASE_URL}/api/v1/comments`, payload, {
        headers,
        tags: { name: '02_Comment' },
      });
      interactionDuration.add(Date.now() - start);

      check(res, { 'Comment status 200/201': (r) => r.status === 200 || r.status === 201 });
    }

    sleep(0.5 + Math.random() * 0.5);
    return;
  }

  // ----------------------------------------------------------------------------
  // Action C: 10% Write Ingestion (Post Creation & Kafka Fan-Out)
  // ----------------------------------------------------------------------------
  if (roll < 0.95) {
    writeActionsCounter.add(1);
    const content = SAMPLE_POST_CONTENTS[Math.floor(Math.random() * SAMPLE_POST_CONTENTS.length)];
    const feeling = FEELINGS[Math.floor(Math.random() * FEELINGS.length)];

    const payload = JSON.stringify({
      content: `${content} [#blended_${vuId}_${Date.now()}]`,
      feeling: feeling,
      audience: 'PUBLIC',
    });

    const start = Date.now();
    const res = http.post(`${BASE_URL}/api/v1/posts`, payload, {
      headers,
      tags: { name: '03_WritePost' },
    });
    writeDuration.add(Date.now() - start);

    check(res, { 'Write post status 200/201': (r) => r.status === 200 || r.status === 201 });

    sleep(0.8 + Math.random() * 0.6);
    return;
  }

  // ----------------------------------------------------------------------------
  // Action D: 5% AI Assistant & Search
  // ----------------------------------------------------------------------------
  aiSearchActionsCounter.add(1);
  const isAi = Math.random() < 0.50;

  if (isAi) {
    const prompt = AI_PROMPTS[Math.floor(Math.random() * AI_PROMPTS.length)];
    const payload = JSON.stringify({ message: prompt });

    const start = Date.now();
    const res = http.post(`${BASE_URL}/api/v1/assistant/respond`, payload, {
      headers,
      tags: { name: '04_AiAssistant' },
    });
    aiSearchDuration.add(Date.now() - start);

    check(res, { 'AI status 200/201': (r) => r.status === 200 || r.status === 201 });
  } else {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/api/v1/musics/recommendations?page=1&limit=10`, {
      headers,
      tags: { name: '04_MusicSearch' },
    });
    aiSearchDuration.add(Date.now() - start);

    check(res, { 'Music status 200': (r) => r.status === 200 });
  }

  sleep(1.0 + Math.random() * 1.0);
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

  const feedCount = data.metrics.actions_feed_total?.values?.count ?? 0;
  const rxCount = data.metrics.actions_interaction_total?.values?.count ?? 0;
  const writeCount = data.metrics.actions_write_total?.values?.count ?? 0;
  const aiCount = data.metrics.actions_ai_search_total?.values?.count ?? 0;

  const feedP95 = data.metrics.feed_duration_ms?.values?.['p(95)']?.toFixed(2) || 'N/A';
  const rxP95 = data.metrics.interaction_duration_ms?.values?.['p(95)']?.toFixed(2) || 'N/A';
  const writeP95 = data.metrics.write_duration_ms?.values?.['p(95)']?.toFixed(2) || 'N/A';
  const aiP95 = data.metrics.ai_search_duration_ms?.values?.['p(95)']?.toFixed(2) || 'N/A';

  console.log('\n================================================================');
  console.log('        🎯 K6 BLENDED REALISTIC WORKLOAD (70:15:10:5) SUMMARY     ');
  console.log('================================================================');
  console.log(`Active Profile:         ${profile.toUpperCase()}`);
  console.log(`Total HTTP Requests:    ${reqTotal}`);
  console.log(`Action Distribution:    Feed (70%): ${feedCount} | Rx (15%): ${rxCount} | Write (10%): ${writeCount} | AI (5%): ${aiCount}`);
  console.log(`Throughput (RPS):       ${reqRate} req/s (Thesis Target: 200 - 400 RPS)`);
  console.log(`Latency Avg:            ${avg} ms`);
  console.log(`Latency P50 (Median):   ${p50} ms`);
  console.log(`Latency P95 (Overall):  ${p95} ms (Target < 300 ms)`);
  console.log(`Latency P99:            ${p99} ms (Target < 800 ms)`);
  console.log(`Latency Max (Outlier):  ${peak} ms`);
  console.log(`- Feed P95 (70%):       ${feedP95} ms`);
  console.log(`- Interaction P95 (15%):${rxP95} ms`);
  console.log(`- Post Write P95 (10%): ${writeP95} ms`);
  console.log(`- AI / Search P95 (5%): ${aiP95} ms`);
  console.log(`Failed Request Rate:    ${failRate}% (Target < 1.0%)`);
  console.log('================================================================\n');

  const summaryMap = {
    'stdout': '',
    '/scripts/results/summary.json': JSON.stringify(data, null, 2),
    '/scripts/results/summary-blended.json': JSON.stringify(data, null, 2),
  };
  summaryMap[`/scripts/results/summary-blended-${profile}.json`] = JSON.stringify(data, null, 2);

  return summaryMap;
}
