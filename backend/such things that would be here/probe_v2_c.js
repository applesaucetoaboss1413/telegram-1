const https = require('https');

const key = 'cmilqkb360001ib04ita6qnhj';
const endpoints = [
  // Product: faceswap-v2
  '/api/v1/magicapi/faceswap-v2/image',
  '/api/v1/magicapi/faceswap-v2/video',
  '/api/v1/magicapi/faceswap-v2/faceswap/image',
  '/api/v1/magicapi/faceswap-v2/faceswap/video',
  '/api/v1/magicapi/faceswap-v2/faceswap-image',
  '/api/v1/magicapi/faceswap-v2/faceswap-video',
  '/api/v1/magicapi/faceswap-v2/v1/image',
  '/api/v1/magicapi/faceswap-v2/v1/video',
  '/api/v1/magicapi/faceswap-v2/v2/image',
  '/api/v1/magicapi/faceswap-v2/v2/video',
  
  // Product: faceswap (maybe v2 path?)
  '/api/v1/magicapi/faceswap/v2/image',
  '/api/v1/magicapi/faceswap/v2/video',
  '/api/v1/magicapi/faceswap/faceswap/v2/image',
  '/api/v1/magicapi/faceswap/faceswap/v2/video',
  
  // Product: faceswap-video-v2 (guess)
  '/api/v1/magicapi/faceswap-video-v2/image',
  '/api/v1/magicapi/faceswap-video-v2/video',

  // Capix check again
  '/api/v1/capix/faceswap/faceswap/v2/image' 
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
