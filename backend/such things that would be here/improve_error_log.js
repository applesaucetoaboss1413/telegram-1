const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

const oldPhrase = '(Likely face detection issue or NSFW)';
const newPhrase = '(Likely face detection issue or inaccessible input URLs)';
code = code.replace(oldPhrase, newPhrase);

fs.writeFileSync(target, code);
console.log('Updated server.js with detailed error logging');
