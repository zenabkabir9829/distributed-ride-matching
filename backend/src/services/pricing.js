const redis = require('../config/redis');

// Call this when a rider requests a ride (before matching)
async function trackRiderDemand(riderId) {
  await redis.setex(`demand:rider:${riderId}`, 60, '1'); // expires in 60s
}

async function getSurgeMultiplier(lat, lng, radiusKm = 5) {
  // Count available drivers nearby
  const nearbyDrivers = await redis.geosearch(
    'drivers:locations', 'FROMLONLAT', lng, lat,
    'BYRADIUS', radiusKm, 'km'
  );
  const availableDrivers = nearbyDrivers.length;

  // Count active demand signals (riders who requested in last 60s)
  const demandKeys = await redis.keys('demand:rider:*');
  const activeDemand = demandKeys.length;

  if (availableDrivers === 0) return 2.5; // max surge if no drivers at all

  const ratio = activeDemand / availableDrivers;

  if (ratio >= 3) return 2.0;
  if (ratio >= 2) return 1.5;
  if (ratio >= 1) return 1.2;
  return 1.0; // no surge
}

module.exports = { trackRiderDemand, getSurgeMultiplier };