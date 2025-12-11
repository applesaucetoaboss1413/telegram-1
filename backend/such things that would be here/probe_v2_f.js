const https = require('https');

const key = 'cmilqkb360001ib04ita6qnhj';
const endpoints = [
  // Trailing slash check
  '/api/v1/magicapi/faceswap-v2/faceswap-image/',
  '/api/v1/magicapi/faceswap-v2/image/',
  
  // Product variations
  '/api/v1/magicapi/faceswap-image-v2/image',
  '/api/v1/magicapi/faceswap-image-v2/faceswap',
  '/api/v1/magicapi/faceswap-image-v2',
  
  '/api/v1/magicapi/faceswap-v2-image/image',
  '/api/v1/magicapi/faceswap-v2-video/video',
  
  // Maybe the product is just 'faceswap-v2' but endpoint is 'simple'?
  '/api/v1/magicapi/faceswap-v2/simple',
  
  // Check if faceswap-video-v2 is the one, maybe user has subscription but key is wrong?
  '/api/v1/magicapi/faceswap-video-v2/video',
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
