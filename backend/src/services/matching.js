const redis = require('../config/redis');
const Redlock = require('redlock').default;
const Trip = require('../models/Trip');

const redlock = new Redlock([redis], {
  retryCount: 3,
  retryDelay: 200, // ms
});

async function assignDriver(driverId, riderId) {
  const lockKey = `lock:driver:${driverId}`;
  let lock;
  try {
    // Try to acquire an exclusive lock on this driver for 5 seconds
    lock = await redlock.acquire([lockKey], 5000);

    // Check driver isn't already mid-trip
    const status = await redis.get(`driver:${driverId}:status`);
    if (status === 'busy') {
      throw new Error('Driver already assigned');
    }

    // Mark driver as busy, remove from available pool
    // Mark driver as busy, remove from available pool
    await redis.set(`driver:${driverId}:status`, 'busy');
    await redis.zrem('drivers:locations', driverId);

    // Persist the trip
    const trip = await Trip.create({ driverId, riderId, status: 'assigned' });

    return { success: true, driverId, riderId, tripId: trip._id };
  } catch (err) {
    return { success: false, reason: err.message };
  } finally {
    if (lock) await lock.release();
  }
}

module.exports = { assignDriver };