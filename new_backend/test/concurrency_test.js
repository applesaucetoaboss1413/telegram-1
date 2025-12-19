const { db, createJob, updateJobStatus } = require('../src/database');
const assert = require('assert');

// Setup
const requestId = 'test_req_' + Date.now();
const userId = 'user_123';
const chatId = 'chat_123';

console.log('Creating test job...');
createJob(requestId, userId, chatId, 'video', {});

// Simulate Worker 1
console.log('Worker 1 attempting to complete job...');
const changes1 = updateJobStatus(requestId, 'completed', 'http://url1.com');
console.log(`Worker 1 changes: ${changes1}`);
assert.strictEqual(changes1, 1, 'Worker 1 should have updated 1 row');

// Simulate Worker 2 (Race condition)
console.log('Worker 2 attempting to complete SAME job...');
const changes2 = updateJobStatus(requestId, 'completed', 'http://url2.com');
console.log(`Worker 2 changes: ${changes2}`);
assert.strictEqual(changes2, 0, 'Worker 2 should have updated 0 rows (job already completed)');

// Verify final state
const job = db.prepare('SELECT * FROM jobs WHERE request_id = ?').get(requestId);
console.log('Final job state:', job);
assert.strictEqual(job.status, 'completed');
assert.strictEqual(job.result_url, 'http://url1.com', 'Result URL should match Worker 1');

console.log('SUCCESS: Optimistic concurrency control verified!');
process.exit(0);
