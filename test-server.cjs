// Minimal server starter - no imports needed, just use the already-compiled modules
// This script assumes the竞彩助手 app is already set up
const http = require('http');

// Just test if something is on port 9000
const testServer = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('test ok');
});
testServer.listen(9000, '0.0.0.0', () => {
  console.log('Test server on 9000');
  // Close after 2 seconds
  setTimeout(() => { testServer.close(); process.exit(0); }, 2000);
});