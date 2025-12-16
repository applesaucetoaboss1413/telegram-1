const fetch = require('node-fetch');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

async function testMagicAPI() {
  const apiKey = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;

  console.log('🧪 Testing MagicAPI FaceSwap Endpoints');
  console.log('======================================');

  if (!apiKey || apiKey === 'your_magicapi_key_here') {
    console.error('❌ ERROR: MAGICAPI_KEY is missing or set to placeholder in .env');
    console.error('   Please update .env with your actual API key to run this test.');
    // We continue just to show the endpoints we are testing
  } else {
      console.log('🔑 API Key found (first 5 chars):', apiKey.substring(0, 5) + '...');
  }
  console.log('');

  // 1. Test Image FaceSwap (MagicAPI Native)
  const imagePayload = {
    swap_image: 'https://blog.api.market/wp-content/uploads/2024/06/Elon_Musk.png',
    target_image: 'https://blog.api.market/wp-content/uploads/2024/06/Shahrukh_khan.png'
  };
  const imageEndpoint = 'https://api.magicapi.dev/api/v1/magicapi/faceswap/faceswap';

  console.log('📸 Testing IMAGE Endpoint:', imageEndpoint);
  console.log('   Payload:', JSON.stringify(imagePayload));
  await runTest(imageEndpoint, imagePayload, apiKey);

  console.log('\n--------------------------------------------------\n');

  // 2. Test Video FaceSwap (Capix)
  const videoPayload = {
    swap_url: 'https://blog.api.market/wp-content/uploads/2024/06/Elon_Musk.png',
    target_url: 'https://storage.ws.pho.to/s2/7e2131eaef5e5cbb0d2c9eef7e2f19343b5a1292.mp4' // Public sample video
  };
  const videoEndpoint = 'https://api.magicapi.dev/api/v1/capix/faceswap/faceswap/v1/video';

  console.log('🎥 Testing VIDEO Endpoint:', videoEndpoint);
  console.log('   Payload:', JSON.stringify(videoPayload));
  await runTest(videoEndpoint, videoPayload, apiKey, true);
}

async function runTest(endpoint, payload, key, isVideo = false) {
    try {
        const start = Date.now();
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'x-magicapi-key': key || 'dummy',
                'Content-Type': 'application/json', // Using JSON as per User instructions, though Capix docs say form-url. 
                                                    // Server.js uses JSON for Capix too. MagicAPI usually handles both.
                'accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const duration = Date.now() - start;
        
        console.log(`   Response Time: ${duration}ms`);
        console.log(`   Status: ${response.status} ${response.statusText}`);
        
        const text = await response.text();
        console.log('   Body:', text.substring(0, 500)); // Truncate if long

        if (response.ok) {
            console.log('   ✅ SUCCESS');
        } else {
            if (response.status === 401) {
                console.log('   ✅ Endpoint reached (401 Unauthorized is expected with dummy key)');
            } else if (response.status === 404) {
                console.log('   ❌ Endpoint NOT FOUND (Check URL)');
            } else {
                console.log('   ⚠️ Request Failed');
            }
        }

    } catch (e) {
        console.error('   ❌ Network/Script Error:', e.message);
    }
}

testMagicAPI();
