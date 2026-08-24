const express = require('express');
const Trip = require('./models/Trip');
const redis = require('./config/redis');
const http = require('http');
const { assignDriver } = require('./services/matching');
const { setupWebSocket, sendToUser } = require('./ws/socket');
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[PORT ${process.env.PORT || 4000}] ${req.method} ${req.path}`);
  next();
});
const connectMongo = require('./config/mongo');
connectMongo();
const { trackRiderDemand, getSurgeMultiplier } = require('./services/pricing');
const cors = require('cors');
app.use(cors());
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
app.post('/debug/free-driver/:id', async (req, res) => {
  try {
    await redis.del(`driver:${req.params.id}:status`);
    res.json({ status: 'freed', id: req.params.id });
  } catch (err) {
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
// Driver sends their location
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

// Find nearby drivers to a rider location
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
    const { driverId, riderId } = req.body;
    const result = await assignDriver(driverId, riderId);
    res.json(result);
  } catch (err) {
    console.error('Error in rides/request:', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable' });
  }
});
const server = http.createServer(app);
const { clients } = setupWebSocket(server);
app.post('/rides/:tripId/complete', async (req, res) => {
  const { tripId } = req.params;
  const { lat, lng } = req.body; // driver's final location

  const trip = await Trip.findById(tripId);
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  trip.status = 'completed';
  trip.endLocation = { lat, lng };
  await trip.save();

  // Free the driver: clear busy status, re-add to available pool
  await redis.del(`driver:${trip.driverId}:status`);
  await redis.geoadd('drivers:locations', lng, lat, trip.driverId);

  res.json({ success: true, tripId, status: 'completed' });
});
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));