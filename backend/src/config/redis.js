const Redis = require('ioredis');
require('dotenv').config();

const redisOptions = {
  maxRetriesPerRequest: 2,   // fail a command after 2 retries instead of hanging forever
  retryStrategy(times) {
    return Math.min(times * 200, 2000); // backoff between reconnect attempts
  },
};

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, redisOptions)
  : new Redis({ host: 'localhost', port: 6379, ...redisOptions });

module.exports = redis;