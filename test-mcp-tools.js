const https = require('https');

const API_KEY = process.env.API_MARKET_KEY || 'YOUR_KEY_HERE';

function makeRpcCall(method, params = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 10000),
      method,
      params
    });

    const options = {
      hostname: 'prod.api.market',
      path: '/api/mcp/magicapi/faceswap',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-api-market-key': API_KEY
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  try {
    console.log('DEBUG: Calling tools/list on MCP endpoint...\n');
    const result = await makeRpcCall('tools/list', {});
    console.log('DEBUG: Full tools/list response:');
    console.log(JSON.stringify(result, null, 2));

    if (result.result && result.result.tools) {
      const faceswapTools = result.result.tools.filter(t =>
        t.name && (t.name.includes('faceswap') || t.name.includes('swap'))
      );

      console.log('\n\nDEBUG: Faceswap-related tools found:');
      faceswapTools.forEach(tool => {
        console.log(`\nTool: ${tool.name}`);
        console.log(`Description: ${tool.description}`);
        console.log('Input Schema:');
        console.log(JSON.stringify(tool.inputSchema, null, 2));
      });
    } else {
      console.log('No tools found in response');
    }
  } catch (e) {
    console.error('ERROR:', e);
  }
}

run();
