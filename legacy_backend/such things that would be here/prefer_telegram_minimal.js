const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let raw = fs.readFileSync(target, 'utf8');
let code = raw.replace(/\r\n/g, '\n');

// Remove early PUBLIC_BASE return
code = code.replace(
  /\nasync function getFileUrl\(ctx, fileId, localPath\) \{\n\s*if \(PUBLIC_BASE\) return \`\$\{PUBLIC_BASE\}\/uploads\/\$\{path\.basename\(localPath\)\}\`\;\n\s*try \{/,
  '\nasync function getFileUrl(ctx, fileId, localPath) {\n  try {'
);

// Add PUBLIC_BASE fallback inside catch
code = code.replace(
  /\n\s*\} catch \(e\) \{\n/,
  '\n  } catch (e) {\n    if (PUBLIC_BASE) return `'+ '${PUBLIC_BASE}' + '/uploads/'+ '${path.basename(localPath)}' + '`;\n'
);

const final = code.replace(/\n/g, '\r\n');
fs.writeFileSync(target, final);
console.log('Adjusted getFileUrl to prefer Telegram link and fallback to PUBLIC_BASE in catch');
