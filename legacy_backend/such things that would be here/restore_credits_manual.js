const http = require('http');

const userId = process.argv[2];
const amount = process.argv[3] || 69;
const secret = process.argv[4] || 'admin123';

if (!userId) {
  console.log('Usage: node restore_credits_manual.js <userId> [amount] [secret]');
  console.log('Example: node restore_credits_manual.js 123456789 69');
  process.exit(1);
}

const data = JSON.stringify({
  userId: userId,
  amount: amount,
  reason: 'Manual Restoration',
  secret: secret
});

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 3000,
  path: '/admin/grant-points',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, res => {
  console.log(`Status: ${res.statusCode}`);
  res.on('data', d => {
    process.stdout.write(d);
  });
});

req.on('error', error => {
  console.error('Error:', error.message);
  console.log('Make sure the server is running locally or adjust hostname/port.');
});

req.write(data);
req.end();
