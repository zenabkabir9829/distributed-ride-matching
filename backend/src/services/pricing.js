const redis = require('../config/redis');

const DEMAND_SET_KEY = 'demand:active-riders';

// Call this when a rider requests a ride (before matching)
async function trackRiderDemand(riderId) {
  await redis.sadd(DEMAND_SET_KEY, riderId);
  // Set overall set to expire cleanup after 60s of no new activity
  // (simple approach: also track per-rider TTL key, remove from set via a sweep)
  await redis.setex(`demand:rider:${riderId}`, 60, '1');
}

async function getSurgeMultiplier(lat, lng, radiusKm = 5) {
  const nearbyDrivers = await redis.geosearch(
    'drivers:locations', 'FROMLONLAT', lng, lat,
    'BYRADIUS', radiusKm, 'km'
  );
  const availableDrivers = nearbyDrivers.length;

  // Clean expired riders out of the demand set, then count
  const riderIds = await redis.smembers(DEMAND_SET_KEY);
  let activeDemand = 0;
  for (const riderId of riderIds) {
    const stillActive = await redis.exists(`demand:rider:${riderId}`);
    if (stillActive) {
      activeDemand++;
    } else {
      await redis.srem(DEMAND_SET_KEY, riderId); // sweep stale entry
    }
  }

  if (availableDrivers === 0) return 2.5;

  const ratio = activeDemand / availableDrivers;

  if (ratio >= 3) return 2.0;
  if (ratio >= 2) return 1.5;
  if (ratio >= 1) return 1.2;
  return 1.0;
}

module.exports = { trackRiderDemand, getSurgeMultiplier };