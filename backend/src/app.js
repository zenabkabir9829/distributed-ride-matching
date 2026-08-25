const express = require('express');
const cors = require('cors');
const Trip = require('./models/Trip');
const redis = require('./config/redis');
const connectMongo = require('./config/mongo');
const { assignDriver } = require('./services/matching');
const { sendToUser } = require('./ws/socket');
const { trackRiderDemand, getSurgeMultiplier } = require('./services/pricing');

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[PORT ${process.env.PORT || 4000}] ${req.method} ${req.path}`);
  next();
});

connectMongo();

app.get('/pricing/surge', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const multiplier = await getSurgeMultiplier(parseFloat(lat), parseFloat(lng));
    res.json({ surgeMultiplier: multiplier });
  } catch (err) {
    console.error('Redis error in pricing/surge:', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
});

app.post('/rides/demand-signal', async (req, res) => {
  try {
    const { riderId } = req.body;
    await trackRiderDemand(riderId);
    res.json({ status: 'tracked' });
  } catch (err) {
    console.error('Redis error in demand-signal:', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
});

app.post('/driver/:id/location', async (req, res) => {
  try {
    const { id } = req.params;
    const { lat, lng, riderId } = req.body;
    await redis.geoadd('drivers:locations', lng, lat, id);

    if (riderId) {
      sendToUser(riderId, { type: 'driver_location', driverId: id, lat, lng });
    }

    res.json({ status: 'updated', id, lat, lng });
  } catch (err) {
    console.error('Redis error in location update:', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
});

app.get('/riders/nearby-drivers', async (req, res) => {
  try {
    const { lat, lng, radiusKm = 5 } = req.query;
    const results = await redis.geosearch(
      'drivers:locations', 'FROMLONLAT', lng, lat,
      'BYRADIUS', radiusKm, 'km', 'ASC',
      'WITHCOORD'
    );

    const drivers = results.map(([id, [dLng, dLat]]) => ({
      id,
      lat: parseFloat(dLat),
      lng: parseFloat(dLng),
    }));

    res.json({ drivers });
  } catch (err) {
    console.error('Redis error in nearby-drivers:', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
});

app.post('/rides/request', async (req, res) => {
  try {
    const { driverId, riderId, riderLat, riderLng } = req.body;
    const result = await assignDriver(driverId, riderId, riderLat, riderLng);
    res.json(result);
  } catch (err) {
    console.error('Error in rides/request:', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
});

app.post('/rides/:tripId/complete', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { lat, lng } = req.body;

    const trip = await Trip.findById(tripId);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    trip.status = 'completed';
    trip.endLocation = { lat, lng };
    await trip.save();

    await redis.del(`driver:${trip.driverId}:status`);
    await redis.geoadd('drivers:locations', lng, lat, trip.driverId);

    res.json({ success: true, tripId, status: 'completed' });
  } catch (err) {
    console.error('Error in rides/complete:', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
});

module.exports = app;