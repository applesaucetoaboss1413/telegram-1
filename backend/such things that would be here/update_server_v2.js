const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

// Update endpoints to V2
code = code.replace(
  "'/api/v1/capix/faceswap/faceswap/v1/video'",
  "'/api/v1/magicapi/faceswap-video-v2/video'"
);
code = code.replace(
  "'/api/v1/capix/faceswap/faceswap/v1/image'",
  "'/api/v1/magicapi/faceswap-video-v2/image'"
);

// Also update the result polling endpoint if needed?
// Capix V1 used: /api/v1/capix/faceswap/result/
// V2 likely uses: /api/v1/magicapi/faceswap-video-v2/result/ ?
// I should probe this first?
// probe_v2_f.js didn't probe result.
// But usually MagicAPI uses standard result path.
// Let's assume /api/v1/magicapi/faceswap-video-v2/result/ or stick to capix one if it's cross-compatible?
// No, cross-compatible is unlikely if product is different.
// I'll update result path to use magicapi/faceswap-video-v2 too.
code = code.replace(
  "'/api/v1/capix/faceswap/result/'",
  "'/api/v1/magicapi/faceswap-video-v2/result/'"
);

fs.writeFileSync(target, code);
console.log('Updated server.js to V2 endpoints');
