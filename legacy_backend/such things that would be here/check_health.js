require('dotenv').config({ path: require('path').join(__dirname, '../../.env') }); 
const https = require('https');
const os = require('os');
const fs = require('fs');
const path = require('path');

console.log('--- DIAGNOSTIC START ---');
console.log('Node Version:', process.version);
console.log('Platform:', process.platform);

// 1. Check Token
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ BOT_TOKEN is missing in process.env');
  console.log('Checking for .env file...');
  const envPath = path.join(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
      console.log('Found .env at', envPath);
  } else {
      console.log('No .env found at', envPath);
  }
} else {
  console.log('✅ BOT_TOKEN is present (starts with ' + token.substring(0, 5) + '...)');
  
  // 2. Test Telegram Connectivity
  console.log('Testing connection to api.telegram.org...');
  const req = https.get(`https://api.telegram.org/bot${token}/getMe`, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.ok) {
          console.log('✅ Telegram API connection SUCCESS:', json.result.username);
        } else {
          console.error('❌ Telegram API returned ERROR:', json.description);
        }
      } catch (e) {
        console.error('❌ Failed to parse Telegram response:', data);
      }
    });
  });
  req.on('error', e => {
    console.error('❌ Network Error connecting to Telegram:', e.message);
  });
}

// 3. Check Persistence
const tmpDir = os.tmpdir();
const testFile = path.join(tmpDir, 'test_write.txt');
try {
  fs.writeFileSync(testFile, 'ok');
  console.log('✅ /tmp is writable');
  fs.unlinkSync(testFile);
} catch (e) {
  console.error('❌ /tmp is NOT writable:', e.message);
}

console.log('--- DIAGNOSTIC END ---');
