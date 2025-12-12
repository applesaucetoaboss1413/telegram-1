const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

// Patch the success check to include 'completed'
const oldCheck = `if (status.includes('success') || status.includes('done')) {`;
const newCheck = `if (status.includes('success') || status.includes('done') || status.includes('completed')) {`;

code = code.replace(oldCheck, newCheck);

fs.writeFileSync(target, code);
console.log('Updated server.js to recognize COMPLETED status');
