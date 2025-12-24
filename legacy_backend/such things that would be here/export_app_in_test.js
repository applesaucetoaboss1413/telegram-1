const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let raw = fs.readFileSync(target, 'utf8');
let code = raw.replace(/\r\n/g, '\n');

const oldListen = `const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`Server running on port ${'$'}{PORT}\`);
  bot.launch().then(() => console.log('Bot launched')).catch(e => console.error('Bot launch failed', e));
});`;

const newListen = `const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(\`Server running on port ${'$'}{PORT}\`);
    bot.launch().then(() => console.log('Bot launched')).catch(e => console.error('Bot launch failed', e));
  });
}

module.exports = { app };`;

if (!code.includes(oldListen)) {
  console.error('Expected listen block not found');
  process.exit(1);
}

code = code.replace(oldListen, newListen);
const final = code.replace(/\n/g, '\r\n');
fs.writeFileSync(target, final);
console.log('Updated server.js to export app and skip listen/bot.launch in tests');
