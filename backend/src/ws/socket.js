const WebSocket = require('ws');
const crypto = require('crypto');
const redis = require('../config/redis');

const CHANNEL = 'ws:events';
const INSTANCE_ID = crypto.randomUUID(); // identifies this process so we skip our own broadcasts

let clients = new Map(); // userId -> ws connection (only users connected to THIS instance)

function deliverLocal(userId, data) {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      let data;
      try {
        data = JSON.parse(msg);
      } catch {
        return; // ignore malformed frames instead of crashing the process
      }
      if (data.type === 'register') {
        clients.set(data.userId, ws);
        console.log(`Registered: ${data.userId}`);
      }
    });
    ws.on('close', () => {
      for (const [id, sock] of clients.entries()) {
        if (sock === ws) clients.delete(id);
      }
    });
  });

  // Subscribe to events published by OTHER instances. A subscribed ioredis
  // connection can't run normal commands, so it needs its own connection.
  const sub = redis.duplicate();
  sub.on('error', (err) => console.error('Redis subscriber error:', err.message));
  sub.subscribe(CHANNEL).catch((err) => console.error('Subscribe failed:', err.message));
  sub.on('message', (channel, raw) => {
    if (channel !== CHANNEL) return;
    try {
      const { origin, userId, data } = JSON.parse(raw);
      if (origin === INSTANCE_ID) return; // already delivered locally by the sender
      deliverLocal(userId, data);
    } catch (err) {
      console.error('Bad pub/sub message:', err.message);
    }
  });

  return { wss, clients, sub };
}

// Delivers locally if the user is connected here, and always broadcasts so the
// instance that actually holds the socket (if it's another one) can deliver.
function sendToUser(userId, data) {
  const delivered = deliverLocal(userId, data);
  redis
    .publish(CHANNEL, JSON.stringify({ origin: INSTANCE_ID, userId, data }))
    .catch((err) => console.error('Pub/sub publish failed:', err.message));
  return delivered;
}

module.exports = { setupWebSocket, sendToUser, CHANNEL };