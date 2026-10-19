// These tests need Redis only: Mongo is mocked so failures can be injected deterministically.
jest.mock('../src/models/Trip');

const http = require('http');
const WebSocket = require('ws');
const Trip = require('../src/models/Trip');
const redis = require('../src/config/redis');
const { assignDriver, BUSY_TTL_SEC } = require('../src/services/matching');
const { setupWebSocket, sendToUser, CHANNEL } = require('../src/ws/socket');

const DRIVER = 'resilience-driver';

async function reset() {
  await redis.del(`driver:${DRIVER}:status`, `driver:${DRIVER}:lastpos`);
  await redis.geoadd('drivers:locations', 75.7873, 26.9124, DRIVER);
}

beforeEach(async () => {
  jest.restoreAllMocks();
  Trip.create.mockReset();
  Trip.findByIdAndUpdate.mockReset();
  await reset();
});

afterAll(async () => {
  await redis.del(`driver:${DRIVER}:status`, `driver:${DRIVER}:lastpos`);
  await redis.zrem('drivers:locations', DRIVER);
  await redis.quit();
});

describe('assignDriver - failure atomicity', () => {
  it('leaves the driver available if Mongo fails (no stranded busy driver)', async () => {
    Trip.create.mockRejectedValue(new Error('mongo down'));

    const res = await assignDriver(DRIVER, 'rider-1', 26.91, 75.78);

    expect(res.success).toBe(false);
    expect(await redis.get(`driver:${DRIVER}:status`)).toBeNull();
    const [pos] = await redis.geopos('drivers:locations', DRIVER);
    expect(pos).not.toBeNull(); // still searchable
  });

  it('cancels the trip and restores the driver if removal from the geo set fails', async () => {
    Trip.create.mockResolvedValue({ _id: 'trip-1' });
    jest.spyOn(redis, 'zrem').mockRejectedValueOnce(new Error('redis blip'));

    const res = await assignDriver(DRIVER, 'rider-1', 26.91, 75.78);

    expect(res.success).toBe(false);
    expect(Trip.findByIdAndUpdate).toHaveBeenCalledWith('trip-1', { status: 'cancelled' });
    expect(await redis.get(`driver:${DRIVER}:status`)).toBeNull();
    const [pos] = await redis.geopos('drivers:locations', DRIVER);
    expect(pos).not.toBeNull();
  });

  it('puts a TTL on the busy flag so a crash cannot strand the driver forever', async () => {
    Trip.create.mockResolvedValue({ _id: 'trip-2' });

    const res = await assignDriver(DRIVER, 'rider-1', 26.91, 75.78);

    expect(res.success).toBe(true);
    const ttl = await redis.ttl(`driver:${DRIVER}:status`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(BUSY_TTL_SEC);
  });
});

describe('WebSocket fan-out across instances', () => {
  it('sendToUser broadcasts on the shared channel', async () => {
    const sub = redis.duplicate();
    await sub.subscribe(CHANNEL);
    const received = new Promise((resolve) => sub.on('message', (_c, raw) => resolve(JSON.parse(raw))));

    sendToUser('someone-on-another-instance', { type: 'ping' });

    const msg = await received;
    expect(msg.userId).toBe('someone-on-another-instance');
    expect(msg.data).toEqual({ type: 'ping' });
    await sub.quit();
  });

  it('delivers an event published by another instance to a locally connected user', async () => {
    const server = http.createServer();
    const { wss, sub } = setupWebSocket(server);
    await new Promise((r) => server.listen(0, r));
    const { port } = server.address();

    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise((r) => client.on('open', r));
    client.send(JSON.stringify({ type: 'register', userId: 'u1' }));
    await new Promise((r) => setTimeout(r, 100)); // let register + subscribe settle

    const got = new Promise((resolve) => client.on('message', (m) => resolve(JSON.parse(m))));
    await redis.publish(
      CHANNEL,
      JSON.stringify({ origin: 'some-other-instance', userId: 'u1', data: { type: 'new_ride_request' } })
    );

    expect(await got).toEqual({ type: 'new_ride_request' });

    client.close();
    wss.close();
    await sub.quit();
    await new Promise((r) => server.close(r));
  });
});