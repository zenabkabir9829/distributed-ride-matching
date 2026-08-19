const Redis = require('ioredis');
require('dotenv').config();

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL)
  : new Redis({ host: 'localhost', port: 6379 });

module.exports = redis;