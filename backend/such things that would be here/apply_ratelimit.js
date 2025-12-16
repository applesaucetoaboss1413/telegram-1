const fs = require('fs');
const path = require('path');

const serverPath = path.resolve(__dirname, '../server.js');

try {
  let code = fs.readFileSync(serverPath, 'utf8');

  // Check if already installed
  if (code.includes("require('express-rate-limit')")) {
    console.log('Rate limit already present.');
    process.exit(0);
  }

  // Insert require
  const requireLine = "const rateLimit = require('express-rate-limit');";
  // We look for 'const express = require('express');'
  const expressRequire = "const express = require('express');";
  if (code.includes(expressRequire)) {
    code = code.replace(expressRequire, expressRequire + '\n' + requireLine);
  } else {
    // Fallback: top of file
    code = requireLine + '\n' + code;
  }

  // Insert middleware usage
  // app.use(express.json()); is a good anchor
  const appUseJson = "app.use(express.json());";
  const limiterCode = `
// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);
`;

  if (code.includes(appUseJson)) {
    code = code.replace(appUseJson, appUseJson + limiterCode);
  } else {
    // Fallback: find const app = express();
    const appInit = "const app = express();";
    if (code.includes(appInit)) {
      code = code.replace(appInit, appInit + limiterCode);
    } else {
      console.error('Could not find app initialization to insert middleware.');
      process.exit(1);
    }
  }

  fs.writeFileSync(serverPath, code);
  console.log('Rate limiting added to server.js');

} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
