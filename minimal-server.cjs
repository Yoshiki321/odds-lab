// minimal-server.js - just start the HTTP server
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('ok');
});
server.listen(9000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:9000');
});