const https = require('https');
const querystring = require('querystring');

const key = 'cmilqkb360001ib04ita6qnhj';
const endpoints = [
  '/api/v1/capix/faceswap/faceswap/v1/image',
  '/api/v1/magicapi/faceswap/faceswap/v1/image',
  '/api/v1/magicapi/faceswap-capix/faceswap/v1/image',
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
