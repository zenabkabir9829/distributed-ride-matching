const redis = require('../config/redis');
const Redlock = require('redlock').default;
const Trip = require('../models/Trip');
const { rideRequestCounter, lockContentionCounter } = require('../metrics');
const { sendToUser } = require('../ws/socket');

const redlock = new Redlock([redis], {
  retryCount: 3,
  retryDelay: 200,
});

function calculateETA(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R * c;

  const avgSpeedKmh = 25;
  const etaMinutes = Math.ceil((distanceKm / avgSpeedKmh) * 60);

  return { distanceKm: parseFloat(distanceKm.toFixed(2)), etaMinutes };
}

// Busy flag expires on its own so a crashed instance can never strand a driver forever.
// Complete/cancel delete it explicitly; this is only the safety net.
const BUSY_TTL_SEC = 30 * 60;

async function assignDriver(driverId, riderId, riderLat, riderLng) {
  const lockKey = `lock:driver:${driverId}`;
  let lock;
  try {
    lock = await redlock.acquire([lockKey], 5000);
  } catch (err) {
    console.error('Redlock/Redis unavailable:', err.message);
    rideRequestCounter.labels('infra_error').inc();
    return { success: false, reason: 'Service temporarily unavailable', infra: true };
  }

  // Track what we've changed so a failure part-way through can be undone.
  let claimed = false;      // busy flag + lastpos written
  let removedFromGeo = false;
  let trip = null;
  let driverLat = null;
  let driverLng = null;

  try {
    const status = await redis.get(`driver:${driverId}:status`);
    if (status === 'busy') {
      lockContentionCounter.inc();
      throw new Error('Driver already assigned');
    }

    const driverPos = await redis.geopos('drivers:locations', driverId);
    [driverLng, driverLat] = driverPos[0] || [null, null];

    let eta = null;
    if (driverLat && driverLng && riderLat && riderLng) {
      eta = calculateETA(parseFloat(riderLat), parseFloat(riderLng), parseFloat(driverLat), parseFloat(driverLng));
    }

    // Order matters: do the step most likely to fail (Mongo) BEFORE removing the
    // driver from the pool, so the common failure leaves nothing to undo.
    await redis.set(`driver:${driverId}:status`, 'busy', 'EX', BUSY_TTL_SEC);
    claimed = true;

    if (driverLat && driverLng) {
      await redis.set(
        `driver:${driverId}:lastpos`,
        JSON.stringify({ lat: driverLat, lng: driverLng }),
        'EX', BUSY_TTL_SEC
      );
    }

    trip = await Trip.create({ driverId, riderId, status: 'assigned' });

    await redis.zrem('drivers:locations', driverId);
    removedFromGeo = true;

    sendToUser(driverId, { type: 'new_ride_request', riderId, tripId: trip._id });

    rideRequestCounter.labels('success').inc();
    return { success: true, driverId, riderId, tripId: trip._id, eta };
  } catch (err) {
    if (claimed) {
      await rollbackAssignment({ driverId, trip, removedFromGeo, driverLat, driverLng });
      rideRequestCounter.labels('infra_error').inc();
      return { success: false, reason: 'Service temporarily unavailable', infra: true };
    }
    rideRequestCounter.labels('failed').inc();
    return { success: false, reason: err.message };
  } finally {
    if (lock) await lock.release().catch(() => {});
  }
}

// Compensating actions: best-effort undo of a half-finished assignment.
// Each step is isolated so one failing (e.g. Redis down) doesn't skip the rest.
async function rollbackAssignment({ driverId, trip, removedFromGeo, driverLat, driverLng }) {
  const attempt = async (label, fn) => {
    try { await fn(); } catch (e) { console.error(`Rollback step "${label}" failed:`, e.message); }
  };

  if (trip) {
    await attempt('cancel trip', () => Trip.findByIdAndUpdate(trip._id, { status: 'cancelled' }));
  }
  if (removedFromGeo && driverLat && driverLng) {
    await attempt('restore geo', () => redis.geoadd('drivers:locations', driverLng, driverLat, driverId));
  }
  await attempt('clear busy', () => redis.del(`driver:${driverId}:status`));
}

module.exports = { assignDriver, calculateETA, BUSY_TTL_SEC };