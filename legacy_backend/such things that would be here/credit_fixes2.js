const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

function spliceBlock(startMarker, endMarker, newBlock) {
  const sIdx = code.indexOf(startMarker);
  if (sIdx === -1) return false;
  const eIdx = code.indexOf(endMarker, sIdx);
  if (eIdx === -1) return false;
  const blockEnd = eIdx + endMarker.length;
  code = code.slice(0, sIdx) + newBlock + code.slice(blockEnd);
  return true;
}

// Fix runFaceswap URL failure block
spliceBlock(
  "if (!swapUrl || !targetUrl) {",
  "}\n\n  const key =",
  "if (!swapUrl || !targetUrl) {\n    adjustPoints(u.id, cost, 'faceswap_refund_urls_failed', { isVideo });\n    return { error: 'Failed to generate file URLs.', points: user.points };\n  }\n\n  const key ="
);

// Fix API error extra brace by normalizing try block structure
code = code.replace(
  /return \{ error: 'API Error:[\s\S]*?points: user\.points \};\n\s*\}\n\s*\n\s*\/\/ --- PERSISTENCE START ---/m,
  (m) => m.replace(/\n\s*\}\n\s*\n/, "\n\n")
);

// Confirm: ensure reason and reply total
code = code.replace(
  /adjustPoints\(uid, pts, 'purchase_webhook', \{ session_id: s\.id, points: pts \}\);/,
  "adjustPoints(uid, pts, 'purchase_confirm', { session_id: sid, points: pts });"
);
code = code.replace(
  /ctx\.reply\(`Success! Added \$\{pts\} points\. Total: \$\{DB\.users\[uid\]\.points\}`\);/,
  "ctx.reply(`Success! Added ${pts} points. Total: ${DB.users[uid].points}`);"
);

// Webhook: ensure reason and session id variable names
code = code.replace(
  /adjustPoints\(uid, pts, 'purchase_confirm', \{ session_id: sid, points: pts \}\);/,
  "adjustPoints(uid, pts, 'purchase_webhook', { session_id: s.id, points: pts });"
);

fs.writeFileSync(target, code);
console.log('credit fixes 2 applied to', target);
