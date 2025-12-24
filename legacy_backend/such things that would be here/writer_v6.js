const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

// Restore the points action to a clean, responsive handler using index-based replacement
const startMarker = "bot.action('points',";
const startIdx = code.indexOf(startMarker);
if (startIdx !== -1) {
  const endIdx = code.indexOf('\n});', startIdx);
  if (endIdx !== -1) {
    const replacement = `bot.action('points', async ctx => {\n  const u = getOrCreateUser(String(ctx.from.id));\n  await ctx.answerCbQuery();\n  const kb = Markup.inlineKeyboard([\n    [Markup.button.callback('Buy Points', 'buy'), Markup.button.callback('Check-In', 'checkin')],\n    [Markup.button.callback('Main Menu', 'menu')]\n  ]);\n  await ctx.reply(\`Points: \${u.points}\`, kb);\n});`;
    code = code.slice(0, startIdx) + replacement + code.slice(endIdx + 4);
  }
}

fs.writeFileSync(target, code);
console.log('writer_v6 restored points action in', target);
