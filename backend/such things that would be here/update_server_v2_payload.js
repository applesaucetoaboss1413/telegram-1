const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

// 1. Replace querystring payload with JSON body in runFaceswap
// We need to replace the entire block constructing 'form' and 'reqOpts' and the write(form) part.

const oldBlock = `  const form = querystring.stringify({ target_url: targetUrl, swap_url: swapUrl });
  const reqOpts = {
    hostname: 'api.magicapi.dev',
    path: endpoint,
    method: 'POST',
    headers: {
      'x-magicapi-key': key,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(form)
    }
  };`;

const newBlock = `  // V2 uses JSON payload structure: { input: { swap_image: ..., target_image/video: ... } }
  // Endpoint paths are: /api/v1/magicapi/faceswap-v2/faceswap/video/run or .../image/run
  
  const payload = JSON.stringify({
    input: {
      swap_image: swapUrl,
      [isVideo ? 'target_video' : 'target_image']: targetUrl
    }
  });

  const reqOpts = {
    hostname: 'api.magicapi.dev',
    path: endpoint,
    method: 'POST',
    headers: {
      'x-magicapi-key': key,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };`;

code = code.replace(oldBlock, newBlock);

// Replace r.write(form) with r.write(payload)
code = code.replace('r.write(form);', 'r.write(payload);');


// 2. Update pollMagicResult to use dynamic status path and GET method (as per MCP 'getfaceswapvideostatus')
// The MCP tool 'getfaceswapvideostatus' uses GET /faceswap/video/status/{id}
// Our previous logic used POST with request_id body. V2 seems to use GET with ID in path.

// We need to find `function pollMagicResult(requestId, chatId) {` and modify the poll loop.
// Since `pollMagicResult` doesn't have `isVideo` passed in, we need to fetch it from DB inside the function.

// Let's inject a line to get job details at start of pollMagicResult
const pollStart = `function pollMagicResult(requestId, chatId) {
  let tries = 0;`;

const pollStartNew = `function pollMagicResult(requestId, chatId) {
  let tries = 0;
  const job = DB.pending_swaps[requestId];
  const isVideo = job ? job.isVideo : true; // Default to true if missing, or maybe try both paths?`;

code = code.replace(pollStart, pollStartNew);

// Replace the request construction in poll()
// Old: POST to .../result/ with form body
// New: GET to .../faceswap/{type}/status/{id}

const oldPollReq = `    const form = querystring.stringify({ request_id: requestId });
    const req = https.request({
      hostname: 'api.magicapi.dev',
      path: '/api/v1/magicapi/faceswap-video-v2/result/',
      method: 'POST',
      headers: { 'x-magicapi-key': key, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) }
    }, res => {`;

const newPollReq = `    const typePath = isVideo ? 'video' : 'image';
    const req = https.request({
      hostname: 'api.magicapi.dev',
      path: \`/api/v1/magicapi/faceswap-v2/faceswap/\${typePath}/status/\${requestId}\`,
      method: 'GET',
      headers: { 'x-magicapi-key': key, 'Content-Type': 'application/json' }
    }, res => {`;

code = code.replace(oldPollReq, newPollReq);

// Remove req.write(form) in poll
code = code.replace('    req.write(form);', '// req.write(form); // GET request has no body');

fs.writeFileSync(target, code);
console.log('Updated server.js to use V2 JSON payload and GET polling');
