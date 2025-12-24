const { app } = require('../server.js'); // adjust path if needed. server.js is in backend root.
const http = require('http');

console.log('Starting Deployment Simulation...');

try {
    const server = http.createServer(app);
    server.listen(0, () => {
        console.log('✅ Server started successfully (Deployment Simulation)');
        server.close();
        process.exit(0);
    });
} catch (e) {
    console.error('❌ Server crash on start:', e);
    process.exit(1);
}

// Timeout if it hangs
setTimeout(() => {
    console.error('❌ Server start TIMED OUT (Possible polling hang?)');
    process.exit(1);
}, 5000);
