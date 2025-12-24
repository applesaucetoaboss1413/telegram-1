require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

async function main() {
  const key = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;
  if (!key) {
    console.error('Missing MAGICAPI_KEY');
    process.exit(1);
  }
  const endpoint = 'https://api.magicapi.dev/api/v1/magicapi/faceswap-v2/faceswap/image/run';
  const payload = {
    input: {
      swap_image: 'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?q=80&w=600',
      target_image: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=600'
    }
  };
  try {
    const res = await axios.post(endpoint, payload, {
      headers: { 'x-magicapi-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
      timeout: 30000
    });
    console.log('Status:', res.status);
    console.log('Body:', JSON.stringify(res.data));
  } catch (e) {
    const status = e.response && e.response.status;
    const body = e.response && e.response.data;
    console.error('Error status:', status || 'n/a');
    console.error('Error body:', body ? JSON.stringify(body) : String(e.message));
    process.exit(1);
  }
}

main();
