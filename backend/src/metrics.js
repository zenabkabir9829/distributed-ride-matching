const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register }); // CPU, memory, event loop lag, etc.

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

const lockContentionCounter = new client.Counter({
  name: 'ride_matching_lock_contention_total',
  help: 'Number of times a driver lock was already held (contention)',
});

const rideRequestCounter = new client.Counter({
  name: 'ride_requests_total',
  help: 'Total ride requests, labeled by outcome',
  labelNames: ['outcome'], // 'success' | 'failed' | 'infra_error'
});

register.registerMetric(httpRequestDuration);
register.registerMetric(lockContentionCounter);
register.registerMetric(rideRequestCounter);

module.exports = { register, httpRequestDuration, lockContentionCounter, rideRequestCounter };