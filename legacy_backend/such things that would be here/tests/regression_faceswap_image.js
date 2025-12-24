const https = require('https');
const fs = require('fs');
const path = require('path');

const key = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY || 'cmilqkb360001ib04ita6qnhj';
const swap = 'https://blog.api.market/wp-content/uploads/2024/06/Elon_Musk.png';
const target = 'https://blog.api.market/wp-content/uploads/2024/06/Shahrukh_khan.png';
const outDir = path.resolve(__dirname, '../../outputs');

function postJson(hostname, pathUrl, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path: pathUrl,
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'x-magicapi-key': key,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let buf=''; res.on('data', c=>buf+=c); res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getJson(hostname, pathUrl) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: pathUrl, method: 'GET', headers: { 'accept': 'application/json', 'x-magicapi-key': key } }, res => {
      let buf=''; res.on('data', c=>buf+=c); res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const run = await postJson('api.magicapi.dev', '/api/v1/magicapi/faceswap-v2/faceswap/image/run', { input: { swap_image: swap, target_image: target } });
  if (!run || !run.id) throw new Error('Run failed: ' + JSON.stringify(run));
  const id = run.id;

  let tries = 0;
  while (tries < 80) {
    tries++;
    await new Promise(r => setTimeout(r, 3000));
    const st = await getJson('api.magicapi.dev', `/api/v1/magicapi/faceswap-v2/faceswap/image/status/${id}`);
    const status = String(st.status || st.state || '').toLowerCase();
    if (status.includes('completed') || status.includes('success') || status.includes('done')) {
      const out = st.output;
      if (out && String(out).startsWith('data:')) {
        const dest = path.join(outDir, `reg_image_${Date.now()}.jpg`);
        fs.writeFileSync(dest, String(out).split(',')[1], 'base64');
        console.log('Wrote', dest);
        process.exit(0);
      } else {
        console.log('Completed but no base64 output found');
        process.exit(1);
      }
    } else if (status.includes('fail') || status.includes('error')) {
      console.log('Failed:', st.error || status);
      process.exit(1);
    }
  }
  console.log('Timeout waiting for completion for', id);
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
