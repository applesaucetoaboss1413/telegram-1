const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

function replace(re, repl) { code = code.replace(re, repl); }
function insertAfter(re, addition) {
  const m = code.match(re);
  if (!m) return false;
  const idx = code.indexOf(m[0]) + m[0].length;
  code = code.slice(0, idx) + addition + code.slice(idx);
  return true;
}

replace(/if \(!swapUrl \|\| !targetUrl\) \{[\s\S]*?\}\s*\n\s*const key =/m,
  "if (!swapUrl || !targetUrl) {\n    adjustPoints(u.id, cost, 'faceswap_refund_urls_failed', { isVideo });\n    return { error: 'Failed to generate file URLs.', points: user.points };\n  }\n\n  const key ="
);

replace(/async function ack\([\s\S]*?\)\s*\{[\s\S]*?\}\s*/g, '');
insertAfter(/async function getFileUrl[\s\S]*?\n\}/,
  "\n\nasync function ack(ctx, text) {\n  if (ctx && ctx.updateType === 'callback_query') {\n    try { await ctx.answerCbQuery(text || 'Processing…'); } catch (_) {}\n  }\n}\n"
);

// Force-rebuild ack block if it's malformed
const ackStart = code.indexOf('async function ack(');
const runStart = code.indexOf('async function runFaceswap(');
if (ackStart !== -1 && runStart !== -1 && runStart > ackStart) {
  const head = code.slice(0, ackStart);
  const tail = code.slice(runStart);
  const ackBlock = "\nasync function ack(ctx, text) {\n  if (ctx && ctx.updateType === 'callback_query') {\n    try { await ctx.answerCbQuery(text || 'Processing…'); } catch (_) {}\n  }\n}\n\n";
  code = head + ackBlock + tail;
}

replace(/bot\.on\('callback_query'[\s\S]*?\);\s*/g, '');
insertAfter(/\n\s*\/\/ --- Express App ---/,
  "\nbot.on('callback_query', async (ctx) => {\n  try {\n    const d = (ctx.update && ctx.update.callback_query && ctx.update.callback_query.data) || '';\n    const known = (d === 'buy' || d === 'faceswap' || d === 'imageswap' || d === 'cancel' || /^buy:/.test(d) || /^pay:/.test(d) || /^confirm:/.test(d));\n    if (!known) {\n      await ack(ctx, 'Unsupported button');\n      await ctx.reply('That button is not recognized. Please use /start and try again.').catch(()=>{});\n    }\n  } catch (e) {\n    console.error('Callback fallback error', e);\n  }\n});\n"
);

// Hard splice any junk between Express marker and app init, keep single fallback
const expressMarker = "\n// --- Express App ---";
const appInit = "const app = express();";
const sIdx = code.indexOf(expressMarker);
const aIdx = code.indexOf(appInit);
if (sIdx !== -1 && aIdx !== -1 && aIdx > sIdx) {
  const head = code.slice(0, sIdx + expressMarker.length);
  const tail = code.slice(aIdx);
  const fallback = "\nbot.on('callback_query', async (ctx) => {\n  try {\n    const d = (ctx.update && ctx.update.callback_query && ctx.update.callback_query.data) || '';\n    const known = (d === 'buy' || d === 'faceswap' || d === 'imageswap' || d === 'cancel' || /^buy:/.test(d) || /^pay:/.test(d) || /^confirm:/.test(d));\n    if (!known) {\n      await ack(ctx, 'Unsupported button');\n      await ctx.reply('That button is not recognized. Please use /start and try again.').catch(()=>{});\n    }\n  } catch (e) {\n    console.error('Callback fallback error', e);\n  }\n});\n";
  code = head + fallback + tail;
}

// Remove duplicate API endpoints before reinserting single versions
replace(/app\.get\('\/api\/points'[\s\S]*?\);\s*/g, '');
replace(/app\.get\('\/api\/audits'[\s\S]*?\);\s*/g, '');

fs.writeFileSync(target, code);
console.log('server cleanup applied to', target);
