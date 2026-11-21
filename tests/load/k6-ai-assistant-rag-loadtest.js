import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ==============================================================================
// Custom Performance & Functional Metrics [LT-04: AI Safe Space Assistant]
// ==============================================================================
const crisisRequestsCounter = new Counter('crisis_requests_total');
const ragRequestsCounter = new Counter('rag_requests_total');
const crisisLatency = new Trend('crisis_latency_ms', true);
const ragLatency = new Trend('rag_latency_ms', true);

// Configuration Flags
const isSmokeTest = __ENV.SMOKE_TEST === 'true';
const profile = (__ENV.LOAD_PROFILE || 'standard').toLowerCase(); // 'standard' (30 VUs), 'sustained' (40 VUs), 'stress' (60 VUs), 'smoke'
const targetVUs = __ENV.TARGET_VUS ? parseInt(__ENV.TARGET_VUS, 10) : 0;
const defaultVUs = profile === 'sustained' ? 40 : (profile === 'stress' ? 60 : 30);
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
      { duration: '20s', target: activeVUs },
      { duration: '4m', target: activeVUs },
      { duration: '20s', target: 0 },
    ];
  }

  if (profile === 'stress') {
    return [
      { duration: '20s', target: 20 },
      { duration: '1m', target: 40 },
      { duration: '1m30s', target: activeVUs },
      { duration: '20s', target: 0 },
    ];
  }

  return [
    { duration: '15s', target: activeVUs },
    { duration: '1m30s', target: activeVUs },
    { duration: '15s', target: 0 },
  ];
}

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    ai_assistant_sessions: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: getStages(),
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                 // Error rate < 1%
    http_req_duration: ['p(95)<2500'],              // RAG LLM response P95 < 2.5s (Thesis target)
    crisis_latency_ms: ['p(95)<150'],               // Crisis guard emergency interrupt P95 < 150ms
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://api-gateway:4000';
const NUM_TEST_USERS = __ENV.NUM_USERS ? parseInt(__ENV.NUM_USERS, 10) : 350;

const CRISIS_PROMPTS = [
  'Tôi cảm thấy bế tắc quá, muốn chết đi cho xong...',
  'Tôi muốn tự tử, không còn lối thoát nào nữa rồi.',
  'Cuộc sống này chẳng còn ý nghĩa gì với tôi, muốn biến mất.',
  'Tôi đang nghĩ đến việc uống thuốc ngủ kết liễu tất cả.',
];

const NORMAL_RAG_PROMPTS = [
  'Làm sao để giải tỏa căng thẳng trước kỳ thi tốt nghiệp vậy trợ lý?',
  'Dạo này mình hay bị mất ngủ và lo âu, có bài tập thở nào hiệu quả không?',
  'Mình cảm thấy áp lực đồng trang lứa khi bạn bè đều đã có định hướng, nên làm gì?',
  'Làm thế nào để duy trì thói quen tập thể dục và ngủ đúng giờ?',
  'Gợi ý cho mình một số phương pháp quản lý cảm xúc khi gặp mâu thuẫn.',
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

  // 20% requests trigger Crisis Guard Intervention; 80% go through RAG pipeline
  const isCrisis = Math.random() < 0.20;
  const promptList = isCrisis ? CRISIS_PROMPTS : NORMAL_RAG_PROMPTS;
  const selectedMsg = promptList[Math.floor(Math.random() * promptList.length)];

  const payload = JSON.stringify({
    message: selectedMsg,
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/assistant/respond`, payload, {
    headers,
    tags: { name: isCrisis ? '01_CrisisIntervention' : '02_NormalRAGRespond' },
  });
  const duration = Date.now() - start;

  if (isCrisis) {
    crisisLatency.add(duration);
    crisisRequestsCounter.add(1);
    check(res, {
      'Crisis guard responded (HTTP 200/201)': (r) => r.status === 200 || r.status === 201,
      'Crisis message has safety hotline or warning': (r) => {
        try {
          const body = r.json();
          const text = JSON.stringify(body);
          return text.includes('1900') || text.includes('hỗ trợ') || text.includes('an toàn') || text.includes('crisis') || text.includes('CRISIS');
        } catch (e) {
          return false;
        }
      },
    });
  } else {
    ragLatency.add(duration);
    ragRequestsCounter.add(1);
    check(res, {
      'RAG responded (HTTP 200/201)': (r) => r.status === 200 || r.status === 201,
      'Has assistant answer': (r) => {
        try {
          const body = r.json();
          return !!(body.data || body.message || body.response || body.content);
        } catch (e) {
          return false;
        }
      },
    });
  }

  // Realistic user pacing between chatting with AI (1.5s - 3.0s)
  sleep(1.5 + Math.random() * 1.5);
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

  const crisisCount = data.metrics.crisis_requests_total?.values?.count ?? 0;
  const ragCount = data.metrics.rag_requests_total?.values?.count ?? 0;
  const crisisP95 = data.metrics.crisis_latency_ms?.values?.['p(95)']?.toFixed(2) || 'N/A';
  const ragP95 = data.metrics.rag_latency_ms?.values?.['p(95)']?.toFixed(2) || 'N/A';

  console.log('\n================================================================');
  console.log('        🎯 K6 AI ASSISTANT & CRISIS GUARD BENCHMARK SUMMARY      ');
  console.log('================================================================');
  console.log(`Active Profile:         ${profile.toUpperCase()}`);
  console.log(`Total HTTP Requests:    ${reqTotal} (Crisis: ${crisisCount}, RAG: ${ragCount})`);
  console.log(`Throughput (RPS):       ${reqRate} req/s`);
  console.log(`Latency Avg:            ${avg} ms`);
  console.log(`Latency P50 (Median):   ${p50} ms`);
  console.log(`Latency P95 (Overall):  ${p95} ms`);
  console.log(`Latency P99:            ${p99} ms`);
  console.log(`Latency Max (Outlier):  ${peak} ms`);
  console.log(`- Crisis Guard P95:     ${crisisP95} ms (Target < 150 ms)`);
  console.log(`- Normal RAG P95:       ${ragP95} ms (Target < 2500 ms)`);
  console.log(`Failed Request Rate:    ${failRate}% (Target < 1.0%)`);
  console.log('================================================================\n');

  const summaryMap = {
    'stdout': '',
    '/scripts/results/summary.json': JSON.stringify(data, null, 2),
    '/scripts/results/summary-ai.json': JSON.stringify(data, null, 2),
  };
  summaryMap[`/scripts/results/summary-ai-${profile}.json`] = JSON.stringify(data, null, 2);

  return summaryMap;
}
