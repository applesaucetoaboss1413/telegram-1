const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

function r(re, repl) { code = code.replace(re, repl); }

// Fix double closing braces in faceswap URL failure block
r(/adjustPoints\(u\.id, cost, 'faceswap_refund_urls_failed', \{ isVideo \}\);\n\s*return \{ error: 'Failed to generate file URLs\.', points: user\.points \};\n\s*\};\n\s*\}/m,
  "adjustPoints(u.id, cost, 'faceswap_refund_urls_failed', { isVideo });\n    return { error: 'Failed to generate file URLs.', points: user.points };\n  }"
);

// Fix extra closing brace after API error block
r(/return \{ error: 'API Error:[\s\S]*?points: user\.points \};\n\s*\}\n\s*\}/m,
  (m) => m.replace(/\n\s*\}\n\s*\}$/m, "\n    }")
);

// Confirm action: correct adjustPoints and reply total
r(/adjustPoints\(uid, pts, 'purchase_webhook', \{ session_id: s\.id, points: pts \}\);/,
  "adjustPoints(uid, pts, 'purchase_confirm', { session_id: sid, points: pts });"
);
r(/ctx\.reply\(`Success! Added \$\{pts\} points\. Total: \$\{u\.points\}`\);/,
  "ctx.reply(`Success! Added ${pts} points. Total: ${DB.users[uid].points}`);"
);

// Webhook: correct adjustPoints reason and session id
r(/adjustPoints\(uid, pts, 'purchase_confirm', \{ session_id: sid, points: pts \}\);/,
  "adjustPoints(uid, pts, 'purchase_webhook', { session_id: s.id, points: pts });"
);

fs.writeFileSync(target, code);
console.log('credit fixes applied to', target);
