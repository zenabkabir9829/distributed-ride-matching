const redis = require('../config/redis');
const Redlock = require('redlock').default;
const Trip = require('../models/Trip');
const { sendToUser } = require('../ws/socket');
const redlock = new Redlock([redis], {
  retryCount: 3,
  retryDelay: 200, // ms
});

async function assignDriver(driverId, riderId) {
  const lockKey = `lock:driver:${driverId}`;
  let lock;
  try {
    lock = await redlock.acquire([lockKey], 5000);
  } catch (err) {
    console.error('Redlock/Redis unavailable:', err.message);
    return { success: false, reason: 'Service temporarily unavailable', infra: true };
  }

  try {
    const status = await redis.get(`driver:${driverId}:status`);
    if (status === 'busy') {
      throw new Error('Driver already assigned');
    }

    await redis.set(`driver:${driverId}:status`, 'busy');
    await redis.zrem('drivers:locations', driverId);

        const trip = await Trip.create({ driverId, riderId, status: 'assigned' });

    sendToUser(driverId, { type: 'new_ride_request', riderId, tripId: trip._id });

    return { success: true, driverId, riderId, tripId: trip._id };
  } catch (err) {
    return { success: false, reason: err.message };
  } finally {
    if (lock) await lock.release().catch(() => {}); // don't crash if release also fails
  }
}

module.exports = { assignDriver };