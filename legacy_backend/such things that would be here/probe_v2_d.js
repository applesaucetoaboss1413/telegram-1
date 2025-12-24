const https = require('https');

const key = 'cmilqkb360001ib04ita6qnhj';
const endpoints = [
  '/api/v1/magicapi/faceswap/faceswap',
  '/api/v1/magicapi/faceswap/faceswap/image',
  '/api/v1/magicapi/faceswap/faceswap/video',
  '/api/v1/magicapi/faceswap-v2/faceswap',
  '/api/v1/magicapi/faceswap-v2',
  '/api/v1/magicapi/faceswap/v2/faceswap',
  '/api/v1/magicapi/faceswap-v2/faceswap/faceswap',
  
  // Try without v1 prefix? No, MagicAPI always has v1
];

endpoints.forEach(ep => {
  const req = https.request({
    hostname: 'api.magicapi.dev',
    path: ep,
    method: 'POST',
    headers: {
      'x-magicapi-key': key,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': 0
    }
  }, res => {
    let buf = '';
    res.on('data', c => buf += c);
    res.on('end', () => {
      console.log(`[${res.statusCode}] ${ep} : ${buf.slice(0, 100)}`);
    });
  });
  req.on('error', e => console.log(`ERR ${ep}: ${e.message}`));
  req.end();
});
