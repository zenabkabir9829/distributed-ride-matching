const http = require('http');
const app = require('./app');
const { setupWebSocket } = require('./ws/socket');

const server = http.createServer(app);
setupWebSocket(server);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));