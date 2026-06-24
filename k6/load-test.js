import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

const searchFailureRate = new Rate('search_failures');
const searchDuration = new Trend('search_duration');
const apiLatency = new Trend('api_latency');

export const options = {
  stages: [
    { duration: '2m', target: 10 },
    { duration: '5m', target: 50 },
    { duration: '2m', target: 100 },
    { duration: '3m', target: 100 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    search_failures: ['rate<0.05'],
  },
};

export default function () {
  const start = Date.now();

  // Health check
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { 'health status is 200': (r) => r.status === 200 });

  // List sessions
  const sessions = http.get(`${BASE_URL}/api/sessions?limit=20`);
  check(sessions, { 'sessions status is 200': (r) => r.status === 200 });
  apiLatency.add(Date.now() - start);

  // Search
  const searchStart = Date.now();
  const search = http.post(`${BASE_URL}/api/search`, JSON.stringify({
    q: 'api',
    size: 10,
  }), { headers: { 'Content-Type': 'application/json' } });

  check(search, { 'search status is 200': (r) => r.status === 200 });
  searchDuration.add(Date.now() - searchStart);
  searchFailureRate.add(search.status !== 200);

  // Facets
  const facets = http.get(`${BASE_URL}/api/search/facets`);

  // Session detail (if available)
  try {
    const body = JSON.parse(sessions.body);
    if (body.sessions && body.sessions.length > 0) {
      const sid = body.sessions[0].id;
      http.get(`${BASE_URL}/api/sessions/${sid}`);
      http.get(`${BASE_URL}/api/sessions/${sid}/timeline`);

      if (body.sessions[0].pages && body.sessions[0].pages.length > 0) {
        http.get(`${BASE_URL}/api/pages/${body.sessions[0].pages[0].id}/screenshots`);
      }
    }
  } catch {}

  sleep(1);
}
