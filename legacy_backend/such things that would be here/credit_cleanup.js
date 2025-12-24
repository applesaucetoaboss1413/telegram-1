const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

function r(re, repl) { code = code.replace(re, repl); }

// Remove stray braces after URL failure return
r(/(return \{ error: 'Failed to generate file URLs\.', points: user\.points \};\n\s*\})\;\n\s*\}/m, "$1\n");

// Webhook: use purchase_webhook and s.id
r(/adjustPoints\(uid, pts, 'purchase_confirm', \{ session_id: sid, points: pts \}\);/, "adjustPoints(uid, pts, 'purchase_webhook', { session_id: s.id, points: pts });");

// Confirm: use purchase_confirm and sid
r(/adjustPoints\(uid, pts, 'purchase_webhook', \{ session_id: s\.id, points: pts \}\);/, "adjustPoints(uid, pts, 'purchase_confirm', { session_id: sid, points: pts });");

fs.writeFileSync(target, code);
console.log('credit cleanup applied to', target);
