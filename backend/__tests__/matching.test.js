const request = require('supertest');
const app = require('../src/app');
const redis = require('../src/config/redis');
const mongoose = require('mongoose');

const TEST_DRIVER = 'test-driver-1';

beforeEach(async () => {
  await redis.del(`driver:${TEST_DRIVER}:status`);
  await redis.geoadd('drivers:locations', 75.7873, 26.9124, TEST_DRIVER);
});

afterAll(async () => {
  await redis.del(`driver:${TEST_DRIVER}:status`);
  await redis.zrem('drivers:locations', TEST_DRIVER);
  await redis.quit();
  await mongoose.connection.close();
});

describe('POST /rides/request - distributed locking', () => {
  it('allows only one rider to successfully claim a driver under 20 concurrent requests', async () => {
    const riders = Array.from({ length: 20 }, (_, i) => `test-rider-${i}`);

    const responses = await Promise.all(
      riders.map((riderId) =>
        request(app)
          .post('/rides/request')
          .send({ driverId: TEST_DRIVER, riderId })
      )
    );

    const successes = responses.filter((r) => r.body.success === true);
    const failures = responses.filter((r) => r.body.success === false);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(19);
  });
});

describe('GET /riders/nearby-drivers', () => {
  it('returns the test driver within radius', async () => {
    const res = await request(app).get('/riders/nearby-drivers').query({
      lat: 26.913,
      lng: 75.788,
      radiusKm: 10,
    });

    expect(res.status).toBe(200);
    expect(res.body.drivers.some((d) => d.id === TEST_DRIVER)).toBe(true);
  });
});