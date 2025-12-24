const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

function r(re, repl) { code = code.replace(re, repl); }

// Remove '};\n  }' after URL failure return
r(/\};\n\s*\}/, "\n  }");

// Remove duplicate closing brace after API error block before persistence
r(/\n\s*\}\n\s*\n\s*\/\/ --- PERSISTENCE START ---/, "\n\n// --- PERSISTENCE START ---");

fs.writeFileSync(target, code);
console.log('credit cleanup 2 applied to', target);
