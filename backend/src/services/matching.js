const redis = require('../config/redis');
const Redlock = require('redlock').default;
const Trip = require('../models/Trip');
const { sendToUser } = require('../ws/socket');
const redlock = new Redlock([redis], {
  retryCount: 3,
  retryDelay: 200, // ms
});
function calculateETA(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R * c;

  const avgSpeedKmh = 25; // rough city-traffic average
  const etaMinutes = Math.ceil((distanceKm / avgSpeedKmh) * 60);

  return { distanceKm: parseFloat(distanceKm.toFixed(2)), etaMinutes };
}

module.exports.calculateETA = calculateETA;
async function assignDriver(driverId, riderId, riderLat, riderLng) {
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

    const driverPos = await redis.geopos('drivers:locations', driverId);
    const [driverLng, driverLat] = driverPos[0] || [null, null];

    let eta = null;
    if (driverLat && driverLng && riderLat && riderLng) {
      eta = calculateETA(parseFloat(riderLat), parseFloat(riderLng), parseFloat(driverLat), parseFloat(driverLng));
    }

        await redis.set(`driver:${driverId}:status`, 'busy');

    if (driverLat && driverLng) {
      await redis.set(`driver:${driverId}:lastpos`, JSON.stringify({ lat: driverLat, lng: driverLng }));
    }

    await redis.zrem('drivers:locations', driverId);

    const trip = await Trip.create({ driverId, riderId, status: 'assigned' });

    sendToUser(driverId, { type: 'new_ride_request', riderId, tripId: trip._id });

    return { success: true, driverId, riderId, tripId: trip._id, eta };
  } catch (err) {
    return { success: false, reason: err.message };
  } finally {
    if (lock) await lock.release().catch(() => {}); // don't crash if release also fails
  }
}

module.exports = { assignDriver };