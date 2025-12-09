const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let src = fs.readFileSync(target, 'utf8');

function ensureAckHelper(code) {
  if (code.includes('function ack(ctx')) return code;
  const insertAfter = 'async function getFileUrl';
  const idx = code.indexOf(insertAfter);
  if (idx === -1) return code;
  const endIdx = code.indexOf('}\n', idx);
  const snippet = '\n\n// --- UX helpers for Telegram buttons ---\nfunction ack(ctx, text) {\n  if (ctx && ctx.updateType === \"callback_query\") {\n    return ctx.answerCbQuery(text || \"Processing…\").catch(() => {});\n  }\n}\n\n';
  return code.slice(0, endIdx + 2) + snippet + code.slice(endIdx + 2);
}

function enhanceLogging(code) {
  return code.replace(
    /bot\.use\(async \(ctx, next\) => \{[\s\S]*?return next\(\);\n\}\);/,
    `bot.use(async (ctx, next) => {\n  try {\n    if (ctx.updateType === 'callback_query') {\n      const data = (ctx.update && ctx.update.callback_query && ctx.update.callback_query.data) || '';
      console.log('update callback_query', (ctx.from && ctx.from.id), 'data=', data.slice(0, 80), 'len=', data.length);\n    } else {\n      console.log('update', ctx.updateType, (ctx.from && ctx.from.id));\n    }\n  } catch (_) {}\n  return next();\n});`
  );
}

function addSetMyCommands(code) {
  if (code.includes('setMyCommands([')) return code;
  const marker = /bot\.command\('start',[\s\S]*?\}\);/;
  const m = code.match(marker);
  if (!m) return code;
  const insert = `\n\n// Expose commands for better accessibility\nbot.telegram.setMyCommands([\n  { command: 'start', description: 'Start the bot' },\n  { command: 'status', description: 'System status' },\n  { command: 'faceswap', description: 'Video face swap' },\n  { command: 'imageswap', description: 'Image face swap' },\n  { command: 'reset', description: 'Reset state' },\n  { command: 'debug', description: 'Show current state' }\n]).catch(() => {});\n`;
  return code.replace(marker, (s) => s + insert);
}

function addAckCalls(code) {
  code = code.replace(/bot\.action\('buy',[\s\S]*?\{\s*try \{/, (s) => s + "\n    ack(ctx, 'Opening packages…');");
  code = code.replace(/bot\.action\(\/buy:\(\.\+\)\/[\s\S]*?\{\s*try \{/, (s) => s + "\n    ack(ctx, 'Select currency…');");
  code = code.replace(/bot\.action\('cancel',[\s\S]*?\{/, (s) => s + "\n  ack(ctx, 'Cancelled');");
  // Keep payment regexes unchanged; only insert acknowledgements in concrete handlers
  code = code.replace(/bot\.action\(\/pay:\\w\+:\(\.\+\)\/[\s\S]*?\{\s*try \{/, (s) => s + "\n    ack(ctx, 'Creating checkout…');");
  code = code.replace(/bot\.action\(\/confirm:\(\.\+\)\/[\s\S]*?\{\s*try \{/, (s) => s + "\n    ack(ctx, 'Verifying payment…');");
  code = code.replace(/bot\.action\('faceswap',[\s\S]*?\{/, (s) => s + "\n  ack(ctx, 'Mode set: Video');");
  code = code.replace(/bot\.action\('imageswap',[\s\S]*?\{/, (s) => s + "\n  ack(ctx, 'Mode set: Image');");
  return code;
}

function addFallbackHandler(code) {
  if (code.includes("bot.on('callback_query'")) return code;
  const marker = '// --- Express App ---';
  const idx = code.indexOf(marker);
  if (idx === -1) return code;
  const snippet = `\n// Fallback for unknown/invalid callback data to avoid unresponsive buttons\nbot.on('callback_query', async (ctx) => {\n  try {\n    const data = (ctx.update && ctx.update.callback_query && ctx.update.callback_query.data) || '';
    const known = (\n      data === 'buy' || data === 'faceswap' || data === 'imageswap' || data === 'cancel' ||\n      /^buy:/.test(data) || /^pay:/.test(data) || /^confirm:/.test(data)\n    );\n    if (!known) {\n      await ack(ctx, 'Unsupported button');\n      await ctx.reply('That button is not recognized. Please use /start and try again.').catch(()=>{});\n    }\n  } catch (e) {\n    console.error('Callback fallback error', e);\n  }\n});\n\n`;
  return code.slice(0, idx) + snippet + code.slice(idx);
}

src = ensureAckHelper(src);
src = enhanceLogging(src);
src = addSetMyCommands(src);
src = addAckCalls(src);
src = addFallbackHandler(src);

fs.writeFileSync(target, src);
console.log('Button responsiveness fixes applied to', target);
