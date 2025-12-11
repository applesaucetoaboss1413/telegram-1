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

// 1) Normalize faceswap URL failure block
replace(/if \(!swapUrl \|\| !targetUrl\) \{[\s\S]*?\}\s*\n\s*const key =/m,
  "if (!swapUrl || !targetUrl) {\n    adjustPoints(u.id, cost, 'faceswap_refund_urls_failed', { isVideo });\n    return { error: 'Failed to generate file URLs.', points: user.points };\n  }\n\n  const key ="
);

// 2) Remove all ack definitions and add a single one after getFileUrl
replace(/async function ack\([\s\S]*?\)\s*\{[\s\S]*?\}\s*/g, '');
insertAfter(/async function getFileUrl[\s\S]*?\n\}/,
  "\n\nasync function ack(ctx, text) {\n  if (ctx && ctx.updateType === 'callback_query') {\n    try { await ctx.answerCbQuery(text || 'Processing…'); } catch (_) {}\n  }\n}\n"
);

// 3) Remove duplicate callback_query handlers and insert one fallback
replace(/bot\.on\('callback_query'[\s\S]*?\);\s*/g, '');
insertAfter(/\n\s*\/\/ --- Express App ---/,
  "\nbot.on('callback_query', async (ctx) => {\n  try {\n    const d = (ctx.update && ctx.update.callback_query && ctx.update.callback_query.data) || '';\n    const known = (d === 'buy' || d === 'faceswap' || d === 'imageswap' || d === 'cancel' || /^buy:/.test(d) || /^pay:/.test(d) || /^confirm:/.test(d));\n    if (!known) {\n      await ack(ctx, 'Unsupported button');\n      await ctx.reply('That button is not recognized. Please use /start and try again.').catch(()=>{});\n    }\n  } catch (e) {\n    console.error('Callback fallback error', e);\n  }\n});\n"
);

fs.writeFileSync(target, code);
console.log('server cleanup applied to', target);
