import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ==============================================================================
// Custom Performance & Functional Metrics [LT-05: Music & Search]
// ==============================================================================
const searchQueriesCounter = new Counter('search_queries_total');
const musicRecDuration = new Trend('music_rec_duration_ms', true);
const searchPostDuration = new Trend('search_post_duration_ms', true);

// Configuration Flags
const isSmokeTest = __ENV.SMOKE_TEST === 'true';
const profile = (__ENV.LOAD_PROFILE || 'standard').toLowerCase(); // 'standard' (80 VUs), 'sustained' (120 VUs), 'stress' (200 VUs), 'smoke'
const targetVUs = __ENV.TARGET_VUS ? parseInt(__ENV.TARGET_VUS, 10) : 0;
const defaultVUs = profile === 'sustained' ? 120 : (profile === 'stress' ? 200 : 80);
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
      { duration: '1m30s', target: 120 },
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
    music_search_workload: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: getStages(),
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                 // Error rate < 1% (Thesis SLO)
    http_req_duration: ['p(95)<250', 'p(99)<600'], // p95 < 250ms, p99 < 600ms (Thesis SLO)
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://api-gateway:4000';
const NUM_TEST_USERS = __ENV.NUM_USERS ? parseInt(__ENV.NUM_USERS, 10) : 350;

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

export default function () {
  const vuId = (__VU && __VU > 0) ? __VU : 1;
  const userNum = ((vuId - 1) % NUM_TEST_USERS) + 1;
  const userId = `load_user_${userNum}`;

  const headers = {
    'Content-Type': 'application/json',
    'x-mock-user-id': userId,
    'Authorization': `Bearer mock_user_${userId}`,
  };

  // 50% Music recommendations (PostgreSQL pgvector / ISO principle) + 50% Post search (Elasticsearch 9)
  const isMusic = Math.random() < 0.50;

  if (isMusic) {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/api/v1/musics/recommendations?page=1&limit=10`, {
      headers,
      tags: { name: '01_MusicRecommendations' },
    });
    musicRecDuration.add(Date.now() - start);

    check(res, {
      'Music recommendations status is 200': (r) => r.status === 200,
      'Music response has items': (r) => {
        try {
          const body = r.json();
          const items = Array.isArray(body) ? body : (body.data || body.items || []);
          return Array.isArray(items);
        } catch (e) {
          return false;
        }
      },
    });
  } else {
    const kw = SEARCH_KEYWORDS[Math.floor(Math.random() * SEARCH_KEYWORDS.length)];
    const encodedKw = encodeURIComponent(kw);

    const start = Date.now();
    const res = http.get(`${BASE_URL}/api/v1/search/posts?query=${encodedKw}&limit=10`, {
      headers,
      tags: { name: '02_SearchPosts' },
    });
    searchPostDuration.add(Date.now() - start);

    check(res, {
      'Search posts status is 200': (r) => r.status === 200,
    });
  }

  searchQueriesCounter.add(1);

  // Realistic human think-time (0.6s - 1.4s)
  sleep(0.6 + Math.random() * 0.8);
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

  const musicP95 = data.metrics.music_rec_duration_ms?.values?.['p(95)']?.toFixed(2) || 'N/A';
  const searchP95 = data.metrics.search_post_duration_ms?.values?.['p(95)']?.toFixed(2) || 'N/A';

  console.log('\n================================================================');
  console.log('        🎯 K6 MUSIC & SEARCH ENGINE BENCHMARK SUMMARY            ');
  console.log('================================================================');
  console.log(`Active Profile:         ${profile.toUpperCase()}`);
  console.log(`Total HTTP Requests:    ${reqTotal}`);
  console.log(`Throughput (RPS):       ${reqRate} req/s (Thesis Target: 80 - 150 RPS)`);
  console.log(`Latency Avg:            ${avg} ms`);
  console.log(`Latency P50 (Median):   ${p50} ms`);
  console.log(`Latency P95 (Overall):  ${p95} ms (Target < 250 ms)`);
  console.log(`Latency P99:            ${p99} ms (Target < 600 ms)`);
  console.log(`Latency Max (Outlier):  ${peak} ms`);
  console.log(`- Music Recommendations P95: ${musicP95} ms`);
  console.log(`- Post Full-text Search P95: ${searchP95} ms`);
  console.log(`Failed Request Rate:    ${failRate}% (Target < 1.0%)`);
  console.log('================================================================\n');

  const summaryMap = {
    'stdout': '',
    '/scripts/results/summary.json': JSON.stringify(data, null, 2),
    '/scripts/results/summary-music-search.json': JSON.stringify(data, null, 2),
  };
  summaryMap[`/scripts/results/summary-music-search-${profile}.json`] = JSON.stringify(data, null, 2);

  return summaryMap;
}
