const { Telegraf } = require('telegraf');
const fs = require('fs');
const fetch = require('node-fetch');
require('dotenv').config({ path: '../.env' });

async function testFileDownload() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  // Use a dummy file_id for testing structure
  // This won't work without real file
  const testFileId = 'AgACAgIAAxkBAAIBc2ZkTJU...'; 

  console.log('🧪 Testing File Download Chain');
  console.log('==============================\n');

  try {
    // Step 1: Get file info
    console.log('1️⃣ Getting file info from Telegram...');
    let file;
    try {
        file = await bot.telegram.getFile(testFileId);
        console.log('   File ID:', file.file_id);
        console.log('   File Size:', file.file_size, 'bytes');
        console.log('   File Path:', file.file_path);
    } catch (e) {
        console.log('   ❌ Failed to get file info (Expected if file_id is dummy)');
        console.log('   Error:', e.message);
        console.log('\n   ℹ️  To test this properly, replace "testFileId" with a valid file_id from a recent message.');
        return;
    }

    // Step 2: Get download link
    console.log('\n2️⃣ Generating download link...');
    const fileLink = await bot.telegram.getFileLink(testFileId);
    console.log('   Download URL:', fileLink);

    // Step 3: Download as buffer
    console.log('\n3️⃣ Downloading as buffer...');
    const response = await fetch(fileLink);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.buffer();
    console.log('   Downloaded:', buffer.length, 'bytes');

    // Step 4: Verify binary
    console.log('\n4️⃣ File Magic (first 4 bytes):');
    const magic = buffer.slice(0, 4).toString('hex');
    console.log('   Hex:', magic);

    // Identify file type
    if (magic.startsWith('ffd8')) console.log('   Type: JPEG ✓');
    else if (magic === '89504e47') console.log('   Type: PNG ✓');
    else if (magic === 'gif89a9' || magic === 'gif87a9') console.log('   Type: GIF ✓');
    else console.log('   Type: Unknown');

    console.log('\n✅ File download chain works');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testFileDownload();
