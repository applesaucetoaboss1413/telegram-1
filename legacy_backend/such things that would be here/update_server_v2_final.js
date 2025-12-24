const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

// Update endpoint selection logic to use new V2 REST paths found via MCP probing
// Old: '/api/v1/magicapi/faceswap-video-v2/video' etc.
// New: '/api/v1/magicapi/faceswap-v2/faceswap/video/run' and '/api/v1/magicapi/faceswap-v2/faceswap/image/run'

code = code.replace(
  "'/api/v1/magicapi/faceswap-video-v2/video'",
  "'/api/v1/magicapi/faceswap-v2/faceswap/video/run'"
);
code = code.replace(
  "'/api/v1/magicapi/faceswap-video-v2/image'",
  "'/api/v1/magicapi/faceswap-v2/faceswap/image/run'"
);

// Update polling logic
// Old: '/api/v1/magicapi/faceswap-video-v2/result/'
// New: '/api/v1/magicapi/faceswap-v2/faceswap/video/status/' + requestId (or image status)
// We need to change the polling function to handle dynamic path based on type or just use video status?
// The probe showed: /faceswap/image/status/{id} and /faceswap/video/status/{id}
// Server code currently has one poll function for both. I need to modify pollMagicResult to accept 'isVideo' or infer it.
// Or I can just patch the poll path to a function that decides?
// Actually, server.js pollMagicResult signature is `pollMagicResult(requestId, chatId)`. It doesn't know isVideo easily unless I pass it or store it.
// The `DB.pending_swaps` entry HAS `isVideo`.
// So inside pollMagicResult, I can retrieve `isVideo` from DB.

// First, let's patch the endpoint strings.
// Then I'll write a specific patch for pollMagicResult to use dynamic path.

// Update request payload format?
// MCP schema says: { input: { swap_image: "...", target_image: "..." } }
// Current code sends: querystring { target_url, swap_url }
// V2 error message "Invalid swap_image" suggests it expects JSON body or specific keys.
// The error `{"error":"Invalid swap_image: ...` suggests it accepted the request but failed validation.
// Wait, my probe sent `{}` JSON.
// Current code uses `application/x-www-form-urlencoded` and keys `target_url`/`swap_url`.
// MCP schema says keys are `swap_image` and `target_image` (or `target_video`).
// And content-type `application/json`?
// I need to change the payload construction too.

fs.writeFileSync(target, code);
console.log('Updated endpoints in server.js');
