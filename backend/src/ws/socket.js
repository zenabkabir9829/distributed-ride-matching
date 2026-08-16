const WebSocket = require('ws');

let clients = new Map(); // userId -> ws connection

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      const data = JSON.parse(msg);
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

  return { wss, clients };
}

function sendToUser(userId, data) {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

module.exports = { setupWebSocket, sendToUser };