const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

code = code.replace(/.*db8c81c.*\r?\n/g, '');
code = code.replace(/.*fix: responsive Telegram buttons and payment callbacks.*\r?\n/g, '');

fs.writeFileSync(target, code);
console.log('server.js cleanup applied');
