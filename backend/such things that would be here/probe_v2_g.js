const https = require('https');

const key = 'cmilqkb360001ib04ita6qnhj';
const endpoints = [
  '/api/v1/magicapi/faceswap-v2/image',
  '/api/v1/magicapi/faceswap-v2/video',
  '/api/v1/magicapi/faceswap-v2/faceswap/image',
  '/api/v1/magicapi/faceswap-v2/faceswap/video',
  '/api/v1/magicapi/faceswap-v2/faceswap-image',
  '/api/v1/magicapi/faceswap-v2/faceswap-video',
  '/api/v1/magicapi/faceswap-v2/faceswap',
  '/api/v1/magicapi/faceswap-v2/swap',
  '/api/v1/magicapi/faceswap-v2/run',
  '/api/v1/magicapi/faceswap-v2/submit',
];

endpoints.forEach(ep => {
  const req = https.request({
    hostname: 'api.magicapi.dev',
    path: ep,
    method: 'POST',
    headers: {
      'x-magicapi-key': key,
      'Content-Type': 'application/json',
      'Content-Length': 2 // {}
    }
  }, res => {
    let buf = '';
    res.on('data', c => buf += c);
    res.on('end', () => {
      console.log(`[${res.statusCode}] ${ep} : ${buf.slice(0, 100)}`);
    });
  });
  req.on('error', e => console.log(`ERR ${ep}: ${e.message}`));
  req.write('{}');
  req.end();
});
