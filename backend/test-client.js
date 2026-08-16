const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:4000');

ws.on('open', () => {
  console.log('Connected!');
  ws.send(JSON.stringify({ type: 'register', userId: 'riderA' }));
});

ws.on('message', (msg) => {
  console.log('Received:', msg.toString());
});