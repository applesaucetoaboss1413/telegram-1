const https = require('https');

const key = 'cmilqkb360001ib04ita6qnhj';
const endpoints = [
  '/api/v1/magicapi/faceswap-v2/faceswap-v2/image',
  '/api/v1/magicapi/faceswap-v2/faceswap-v2/video',
  '/api/v1/magicapi/faceswap-v2/api/image',
  '/api/v1/magicapi/faceswap-v2/v1/faceswap-image',
  '/api/v1/magicapi/faceswap-v2/v1/faceswap-video',
  '/api/v1/magicapi/faceswap-v2/v1/image', // Tried before?
  '/api/v1/magicapi/faceswap-v2/v1/video',
  '/api/v1/magicapi/faceswap-v2/faceswap-image/v1',
  '/api/v1/magicapi/faceswap-v2/faceswap-video/v1',
  '/api/v1/magicapi/faceswap-v2/faceswap/v1',
  '/api/v1/magicapi/faceswap-v2/faceswap/v2',
  
  // Try 'faceswap-v2' as the resource name under 'magicapi/faceswap' product?
  '/api/v1/magicapi/faceswap/faceswap-v2/image',
  
  // Try 'magicapi' provider, 'faceswap-image' product?
  '/api/v1/magicapi/faceswap-image/image',
  '/api/v1/magicapi/faceswap-image/v1/image',
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
