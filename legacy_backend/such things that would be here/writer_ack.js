const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

function replaceOnce(re, repl) {
  code = code.replace(re, repl);
}

function insertAfter(re, addition) {
  const m = code.match(re);
  if (!m) return false;
  const idx = code.indexOf(m[0]) + m[0].length;
  code = code.slice(0, idx) + addition + code.slice(idx);
  return true;
}

function replaceBlock(startString, newBlock) {
  const startIdx = code.indexOf(startString);
  if (startIdx === -1) return false;
  const endIdx = code.indexOf('});', startIdx);
  if (endIdx === -1) return false;
  code = code.slice(0, startIdx) + newBlock + code.slice(endIdx + 3);
  return true;
}

function injectAfterInBlock(startString, anchorString, injection) {
  const startIdx = code.indexOf(startString);
  if (startIdx === -1) return false;
  const anchorIdx = code.indexOf(anchorString, startIdx);
  if (anchorIdx === -1) return false;
  const insertIdx = anchorIdx + anchorString.length;
  code = code.slice(0, insertIdx) + injection + code.slice(insertIdx);
  return true;
}

// Enhance bot.use logging (string replacement for reliability)
replaceBlock(
  "bot.use(async (ctx, next) => {",
  "bot.use(async (ctx, next) => {\n  try {\n    if (ctx.updateType === 'callback_query') {\n      const data = (ctx.update && ctx.update.callback_query && ctx.update.callback_query.data) || '';\n      console.log('update callback_query', (ctx.from && ctx.from.id), 'data=', data.slice(0, 80), 'len=', data.length);\n    } else {\n      console.log('update', ctx.updateType, (ctx.from && ctx.from.id));\n    }\n  } catch (_) {}\n  return next();\n});"
);

// Add ack helper after getFileUrl
insertAfter(/async function getFileUrl[\s\S]*?\n\}/, `\n\nasync function ack(ctx, text) {\n  if (ctx && ctx.updateType === 'callback_query') {\n    try { await ctx.answerCbQuery(text || 'Processing…'); } catch (_) {}\n  }\n}\n`);

insertAfter(/function addAudit[\s\S]*?\n\}/, `\n\nfunction adjustPoints(userId, delta, reason, meta) {\n  const u = getOrCreateUser(String(userId));\n  const before = Number(u.points || 0);\n  let after = before + Number(delta);\n  if (after < 0) after = 0;\n  u.points = after;\n  if (delta > 0) {\n    u.has_recharged = true;\n    u.recharge_total_points = Number(u.recharge_total_points || 0) + Number(delta);\n  }\n  addAudit(String(userId), Number(delta), reason, meta);\n  saveDB();\n  return after;\n}\n`);

// Ack in buy action
replaceOnce(/bot\.action\('buy',[\s\S]*?\{\s*try \{/, (s) => s + "\n    await ack(ctx, 'Opening packages…');");

// Ack in buy tier selection
injectAfterInBlock("bot.action(/buy:(.+)/, async ctx => {", "try {", "\n    await ack(ctx, 'Select currency…');");

// Cancel action: make async and ack
replaceOnce(/bot\.action\('cancel',\s*ctx => \{/, "bot.action('cancel', async ctx => {\n  await ack(ctx, 'Cancelled');");

// Ack in pay action
injectAfterInBlock("bot.action(/pay:(\\w+):(.+)/, async ctx => {", "try {", "\n    await ack(ctx, 'Creating checkout…');");

// Ack in confirm action
injectAfterInBlock("bot.action(/confirm:(.+)/, async ctx => {", "try {", "\n    await ack(ctx, 'Verifying payment…');");

// Faceswap/imageswap actions: make async and ack
replaceOnce(/bot\.action\('faceswap',\s*ctx => \{/, "bot.action('faceswap', async ctx => {\n  await ack(ctx, 'Mode set: Video');");
replaceOnce(/bot\.action\('imageswap',\s*ctx => \{/, "bot.action('imageswap', async ctx => {\n  await ack(ctx, 'Mode set: Image');");

// Fallback callback_query handler before Express app
insertAfter(/\n\s*\/\/ --- Express App ---/, `\nbot.on('callback_query', async (ctx) => {\n  try {\n    const d = (ctx.update && ctx.update.callback_query && ctx.update.callback_query.data) || '';\n    const known = (d === 'buy' || d === 'faceswap' || d === 'imageswap' || d === 'cancel' || /^buy:/.test(d) || /^pay:/.test(d) || /^confirm:/.test(d));\n    if (!known) {\n      await ack(ctx, 'Unsupported button');\n      await ctx.reply('That button is not recognized. Please use /start and try again.').catch(()=>{});\n    }\n  } catch (e) {\n    console.error('Callback fallback error', e);\n  }\n});\n`);

replaceOnce(/user\.points\s*-=?\s*cost;\s*\n\s*saveDB\(\);\s*\n\s*addAudit\(u\.id,\s*-cost,[\s\S]*?\);/, "adjustPoints(u.id, -cost, 'faceswap_start', { isVideo });");
replaceOnce(/user\.points\s*\+=\s*cost;\s*\n\s*saveDB\(\);\s*\n\s*return \{ error: 'Failed to generate file URLs\.'[\s\S]*?\}/, "adjustPoints(u.id, cost, 'faceswap_refund_urls_failed', { isVideo });\n    return { error: 'Failed to generate file URLs.', points: user.points };\n  }");
replaceOnce(/user\.points\s*\+=\s*cost;\s*\n\s*saveDB\(\);\s*\n\s*console\.error\('MagicAPI Error',[\s\S]*?return \{ error: 'API Error:[\s\S]*?\};/, "adjustPoints(u.id, cost, 'faceswap_refund_api_error', { isVideo });\n      console.error('MagicAPI Error', result);\n      return { error: 'API Error: ' + (result.message || JSON.stringify(result)), points: user.points };\n    }");
replaceOnce(/\} catch \(e\) \{\s*\n\s*user\.points\s*\+=\s*cost;\s*\n\s*saveDB\(\);\s*\n\s*return \{ error: 'Network Error:[\s\S]*?\};\s*\n\s*\}/, "} catch (e) {\n    adjustPoints(u.id, cost, 'faceswap_refund_network_error', { isVideo });\n    return { error: 'Network Error: ' + e.message, points: user.points };\n  }");

replaceOnce(/const u = getOrCreateUser\(uid\);\s*\n\s*u\.points \+= pts;/, "adjustPoints(uid, pts, 'purchase_webhook', { session_id: s.id, points: pts });");
replaceOnce(/const u = getOrCreateUser\(uid\);\s*\n\s*u\.points \+= pts;/, "adjustPoints(uid, pts, 'purchase_confirm', { session_id: sid, points: pts });");

insertAfter(/app\.get\('\/',[\s\S]*?\);/, `\n\napp.get('/api/points', (req, res) => {\n  const uid = String(req.query.userId || '');\n  if (!uid) return res.status(400).json({ error: 'userId required' });\n  const u = getOrCreateUser(uid);\n  res.json({ id: u.id, points: u.points, has_recharged: !!u.has_recharged, recharge_total_points: Number(u.recharge_total_points || 0) });\n});\n\napp.get('/api/audits', (req, res) => {\n  const uid = String(req.query.userId || '');\n  if (!uid) return res.status(400).json({ error: 'userId required' });\n  const u = getOrCreateUser(uid);\n  const entries = (DB.audits && DB.audits[uid]) || [];\n  res.json({ id: u.id, points: u.points, audits: entries });\n});\n`);

fs.writeFileSync(target, code);
console.log('ack and callback fixes applied to', target);
