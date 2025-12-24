const https = require('https');

const key = 'cmilqkb360001ib04ita6qnhj';
const endpoints = [
  '/api/v1/magicapi/faceswap-v2/api/aifaceswap/v1/faceswap',
  '/api/v1/magicapi/faceswap-v2/aifaceswap/v1/faceswap',
  '/api/v1/magicapi/faceswap-v2/api/v1/faceswap',
  '/api/v1/magicapi/faceswap-v2/v1/faceswap',
  '/api/v1/magicapi/faceswap-v2/api/faceswap',
  
  // Try 'video_faceswap' from aifaceswap docs
  '/api/v1/magicapi/faceswap-v2/api/aifaceswap/v1/video_faceswap',
  '/api/v1/magicapi/faceswap-v2/video_faceswap',
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
