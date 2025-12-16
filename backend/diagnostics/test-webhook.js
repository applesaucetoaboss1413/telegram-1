const { Telegraf } = require('telegraf');
require('dotenv').config({ path: '../.env' });

async function testWebhook() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  console.log('🧪 Testing Telegram Webhook Configuration');
  console.log('=========================================\n');

  try {
    // Get current webhook info
    const info = await bot.telegram.getWebhookInfo();

    console.log('📍 Current Webhook Status:');
    console.log('  URL:', info.url || '(not set)');
    console.log('  IP Address:', info.ip_address || 'N/A');
    console.log('  Pending Updates:', info.pending_update_count);
    console.log('  Has Custom Certificate:', info.has_custom_certificate);
    console.log('  Last Error:', info.last_error_message || '(none)');
    console.log('  Last Error Date:', info.last_error_date ? new Date(info.last_error_date * 1000) : 'N/A');

    if (process.env.RENDER_EXTERNAL_URL) {
      const expectedUrl = `${process.env.RENDER_EXTERNAL_URL}/telegram/webhook`;
      const altExpectedUrl = `${process.env.RENDER_EXTERNAL_URL}/telegram`;

      if (info.url === expectedUrl || info.url === altExpectedUrl) {
        console.log('\n✅ Webhook URL matches RENDER_EXTERNAL_URL');
      } else {
        console.log('\n⚠️ Webhook URL mismatch!');
        console.log('  Expected:', expectedUrl);
        console.log('  Actual:', info.url);
      }
    }

    // Test bot token validity
    const me = await bot.telegram.getMe();
    console.log('\n👤 Bot Identity:');
    console.log('  Username:', '@' + me.username);
    console.log('  Name:', me.first_name);
    console.log('  ID:', me.id);

    console.log('\n✅ Webhook configuration OK');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testWebhook();
