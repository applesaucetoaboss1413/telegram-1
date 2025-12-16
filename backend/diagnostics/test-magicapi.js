const fetch = require('node-fetch');
require('dotenv').config({ path: '../.env' });

async function testMagicAPI() {
  const apiKey = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;

  if (!apiKey) {
    console.error('ERROR: MAGICAPI_KEY not set');
    process.exit(1);
  }

  // Using public test images from MagicAPI documentation
  const testPayload = {
    swap_image: 'https://blog.api.market/wp-content/uploads/2024/06/Elon_Musk.png',
    target_image: 'https://blog.api.market/wp-content/uploads/2024/06/Shahrukh_khan.png'
  };

  console.log('🧪 Testing MagicAPI FaceSwap Endpoint');
  console.log('=====================================');
  console.log('API Key (first 10 chars):', apiKey.substring(0, 10) + '...');
  console.log('Payload:', JSON.stringify(testPayload, null, 2));
  console.log('');

  try {
    const startTime = Date.now();

    const response = await fetch(
      'https://api.magicapi.dev/api/v1/magicapi/faceswap/faceswap',
      {
        method: 'POST',
        headers: {
          'x-magicapi-key': apiKey,
          'Content-Type': 'application/json',
          'accept': 'application/json'
        },
        body: JSON.stringify(testPayload),
        timeout: 120000
      }
    );

    const duration = Date.now() - startTime;

    console.log('📊 Response Details:');
    console.log('  Status Code:', response.status);
    console.log('  Status Text:', response.statusText);
    console.log('  Response Time:', duration + 'ms');

    const headers = {};
    response.headers.forEach((v, k) => headers[k] = v);
    console.log('  Headers:', JSON.stringify(headers, null, 2));

    const body = await response.text();
    console.log('  Body (raw):', body);

    if (response.ok) {
      const json = JSON.parse(body);
      console.log('\n✅ SUCCESS!');
      console.log('  Output URL:', json.output);
      console.log('\n  To verify image: open in browser:');
      console.log('  ' + json.output);
    } else {
      console.log('\n❌ FAILED');
      console.log('  Check API key and request format');
    }

  } catch (error) {
    console.error('\n❌ REQUEST FAILED');
    console.error('  Error:', error.message);
    console.error('  Type:', error.name);
    if (error.code) console.error('  Code:', error.code);
  }
}

testMagicAPI();
