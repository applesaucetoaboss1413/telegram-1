const https = require('https');

const key = 'cmilqkb360001ib04ita6qnhj';
const endpoints = [
  // Try the "MagicAPI FaceSwap" endpoint (Result 3) - JSON body
  { path: '/api/v1/magicapi/faceswap/faceswap', method: 'POST', type: 'application/json' },
  // Try the "Capix Compatible" endpoint but maybe different suffix?
  { path: '/api/v1/magicapi/faceswap-capix/faceswap/v1/image', method: 'POST', type: 'application/x-www-form-urlencoded' },
  // Try the old Capix endpoint again just to be sure
  { path: '/api/v1/capix/faceswap/faceswap/v1/image', method: 'POST', type: 'application/x-www-form-urlencoded' }
];

endpoints.forEach(ep => {
  const req = https.request({
    hostname: 'api.magicapi.dev',
    path: ep.path,
    method: ep.method,
    headers: {
      'x-magicapi-key': key,
      'Content-Type': ep.type,
      'Content-Length': 2 // minimal body
    }
  }, res => {
    let buf = '';
    res.on('data', c => buf += c);
    res.on('end', () => {
      console.log(`[${res.statusCode}] ${ep.path} : ${buf.slice(0, 150)}`);
    });
  });
  req.on('error', e => console.log(`ERR ${ep.path}: ${e.message}`));
  req.write('{}');
  req.end();
});
