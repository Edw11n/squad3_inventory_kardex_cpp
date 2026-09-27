import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '15s', target: 20 },
    { duration: '45s', target: 50 },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000/api/v1';
const TOKEN = __ENV.AUTH_TOKEN || 'mock-token';

export default function () {
  const payload = JSON.stringify({
    branchId: '00000000-0000-0000-0000-000000000001',
    paymentMethod: 'EFECTIVO',
    cashTendered: 100000,
    items: [
      {
        productId: '00000000-0000-0000-0000-000000000002',
        quantity: 2,
        unitPrice: 32000,
      },
    ],
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      'X-Idempotency-Key': `k6-${__VU}-${__ITER}-${Date.now()}`,
    },
  };

  const response = http.post(`${BASE_URL}/pos/checkout`, payload, params);

  check(response, {
    'Estado HTTP es 201': (r) => r.status === 201 || r.status === 200,
    'Latencia menor a 300ms': (r) => r.timings.duration < 300,
  });

  sleep(1);
}
