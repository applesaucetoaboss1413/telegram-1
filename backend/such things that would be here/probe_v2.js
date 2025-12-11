const https = require('https');

const key = 'cmilqkb360001ib04ita6qnhj';
const endpoints = [
  '/api/v1/magicapi/faceswap-v2/faceswap-image',
  '/api/v1/magicapi/faceswap-v2/faceswap-video',
  '/api/v1/magicapi/faceswap-v2/image',
  '/api/v1/magicapi/faceswap-v2/video',
  '/api/v1/magicapi/faceswap-v2/faceswap/image',
  '/api/v1/magicapi/faceswap-v2/faceswap/video',
  '/api/v1/magicapi/faceswap-v2/result'
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
      console.log(`[${res.statusCode}] ${ep} : ${buf.slice(0, 150)}`);
    });
  });
  req.on('error', e => console.log(`ERR ${ep}: ${e.message}`));
  req.end();
});
