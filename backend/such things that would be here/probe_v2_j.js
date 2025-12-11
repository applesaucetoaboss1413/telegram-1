const https = require('https');

const key = 'cmilqkb360001ib04ita6qnhj';
const endpoints = [
  // Capix structure on faceswap-v2
  '/api/v1/magicapi/faceswap-v2/faceswap/faceswap/v1/image',
  '/api/v1/magicapi/faceswap-v2/faceswap/faceswap/v1/video',
  
  // Variation
  '/api/v1/magicapi/faceswap-v2/faceswap/v1/image',
  '/api/v1/magicapi/faceswap-v2/faceswap/v1/video',
  
  // Maybe faceswap-capix structure?
  '/api/v1/magicapi/faceswap-v2/faceswap-capix/faceswap/v1/image',
  
  // Just 'v2' in path?
  '/api/v1/magicapi/faceswap-v2/v2/image',
  
  // Try faceswap-video-v2 product again with capix structure
  '/api/v1/magicapi/faceswap-video-v2/faceswap/faceswap/v1/video',
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
