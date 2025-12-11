const https = require('https');

const key = 'cmilqkb360001ib04ita6qnhj';
const mcpEndpoint = '/api/mcp/magicapi/faceswap-v2';

const payload = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {}
});

const req = https.request({
  hostname: 'prod.api.market',
  path: mcpEndpoint,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-market-key': key,
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  let buf = '';
  res.on('data', c => buf += c);
  res.on('end', () => {
    console.log(`[${res.statusCode}] Response:`);
    try {
      const j = JSON.parse(buf);
      console.log(JSON.stringify(j, null, 2));
    } catch(e) {
      console.log(buf);
    }
  });
});

req.on('error', e => console.error('Error:', e));
req.write(payload);
req.end();
