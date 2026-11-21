import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ==============================================================================
// Custom Performance & Functional Metrics [LT-02: Write Ingestion]
// ==============================================================================
const postsCreatedCounter = new Counter('posts_created_total');
const postCreateDuration = new Trend('post_create_duration_ms', true);

// Configuration Flags
const isSmokeTest = __ENV.SMOKE_TEST === 'true';
const profile = (__ENV.LOAD_PROFILE || 'standard').toLowerCase(); // 'standard' (50 VUs), 'sustained' (80 VUs), 'stress' (120 VUs), 'smoke'
const targetVUs = __ENV.TARGET_VUS ? parseInt(__ENV.TARGET_VUS, 10) : 0;
const defaultVUs = profile === 'sustained' ? 80 : (profile === 'stress' ? 120 : 50);
const activeVUs = targetVUs > 0 ? targetVUs : defaultVUs;

function getStages() {
  if (isSmokeTest || profile === 'smoke') {
    return [
      { duration: '3s', target: 5 },
      { duration: '10s', target: 5 },
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
      { duration: '30s', target: 30 },
      { duration: '1m30s', target: 80 },
      { duration: '1m30s', target: activeVUs },
      { duration: '30s', target: 0 },
    ];
  }

  // Standard Write Ingestion Test (50 VUs steady for 2m)
  return [
    { duration: '20s', target: activeVUs },
    { duration: '2m', target: activeVUs },
    { duration: '20s', target: 0 },
  ];
}

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    post_write_ingestion: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: getStages(),
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                 // Error rate < 1% (Thesis SLO)
    http_req_duration: ['p(95)<300', 'p(99)<800'], // p95 < 300ms, p99 < 800ms (Thesis SLO for write)
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://api-gateway:4000';
const NUM_TEST_USERS = __ENV.NUM_USERS ? parseInt(__ENV.NUM_USERS, 10) : 350;

// Emotion feeling labels aligned with 7 basic emotion model
const FEELINGS = ['JOY', 'SADNESS', 'ANGER', 'FEAR', 'DISGUST', 'SURPRISE', 'NEUTRAL'];

const SAMPLE_POST_CONTENTS = [
  'Hôm nay thời tiết thật đẹp, cảm giác tràn đầy năng lượng để hoàn thành đồ án tốt nghiệp!',
  'Một chút mệt mỏi sau ngày dài làm việc, nhưng mình tin mọi nỗ lực rồi sẽ được đền đáp xứng đáng.',
  'Chia sẻ một góc học tập ấm cúng cho các bạn sinh viên đang ôn thi nhé.',
  'Âm nhạc chữa lành thật tuyệt vời, nghe xong thấy tinh thần nhẹ nhõm hơn hẳn.',
  'Đôi khi cho phép bản thân nghỉ ngơi cũng là một cách dũng cảm để bước tiếp.',
  'Thảo luận về ứng dụng AI trong hỗ trợ tâm lý: các bạn thấy tiềm năng nhất ở điểm nào?',
  'Cuối tuần rồi, hãy dành thời gian cho gia đình và những người thân yêu nhé mọi người.',
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

  const contentIdx = Math.floor(Math.random() * SAMPLE_POST_CONTENTS.length);
  const feelingIdx = Math.floor(Math.random() * FEELINGS.length);

  const payload = JSON.stringify({
    content: `${SAMPLE_POST_CONTENTS[contentIdx]} [#loadtest_${vuId}_${Date.now()}]`,
    feeling: FEELINGS[feelingIdx],
    audience: 'PUBLIC',
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/posts`, payload, {
    headers,
    tags: { name: '01_CreatePost' },
  });
  postCreateDuration.add(Date.now() - start);

  const isOk = check(res, {
    'Post created successfully (HTTP 201)': (r) => r.status === 201 || r.status === 200,
    'Has post ID': (r) => {
      try {
        const body = r.json();
        const data = body.data || body;
        return !!(data.id || data._id || data.postId);
      } catch (e) {
        return false;
      }
    },
  });

  if (isOk) {
    postsCreatedCounter.add(1);
  }

  // Realistic human post creation pause between actions (0.8s - 1.6s)
  sleep(0.8 + Math.random() * 0.8);
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
  const postsCreated = data.metrics.posts_created_total?.values?.count ?? 0;

  console.log('\n================================================================');
  console.log('        🎯 K6 POST WRITE INGESTION BENCHMARK SUMMARY             ');
  console.log('================================================================');
  console.log(`Active Profile:         ${profile.toUpperCase()}`);
  console.log(`Total HTTP Requests:    ${reqTotal}`);
  console.log(`Posts Created Total:    ${postsCreated}`);
  console.log(`Throughput (RPS):       ${reqRate} req/s (Thesis Target: 50 - 100 RPS)`);
  console.log(`Latency Avg:            ${avg} ms`);
  console.log(`Latency P50 (Median):   ${p50} ms`);
  console.log(`Latency P95 (Overall):  ${p95} ms (Target < 300 ms)`);
  console.log(`Latency P99:            ${p99} ms (Target < 800 ms)`);
  console.log(`Latency Max (Outlier):  ${peak} ms`);
  console.log(`Failed Request Rate:    ${failRate}% (Target < 1.0%)`);
  console.log('================================================================\n');

  const summaryMap = {
    'stdout': '',
    '/scripts/results/summary.json': JSON.stringify(data, null, 2),
    '/scripts/results/summary-write.json': JSON.stringify(data, null, 2),
  };
  summaryMap[`/scripts/results/summary-write-${profile}.json`] = JSON.stringify(data, null, 2);

  return summaryMap;
}
