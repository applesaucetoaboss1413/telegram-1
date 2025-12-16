const { getUser, updateUserPoints, createJob, getPendingJobs, updateJobStatus } = require('../src/database');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Clean fake DB
const dbPath = path.join(__dirname, '../../data/faceswap.db');
console.log('Using DB:', dbPath);

async function runTest() {
    console.log('--- Starting Core Tests ---');

    // 1. User Test
    console.log('Testing User Creation...');
    const userId = 'test_user_' + Date.now();
    let user = getUser(userId);
    assert.strictEqual(user.points, 10, 'New user should have 10 points');
    
    user = updateUserPoints(userId, 50);
    assert.strictEqual(user.points, 60, 'User should have 60 points after update');
    console.log('✅ User Tests Passed');

    // 2. Job Test
    console.log('Testing Job Creation...');
    const requestId = 'req_' + Date.now();
    createJob(requestId, userId, 'chat_123', 'video');
    
    const pending = getPendingJobs();
    const myJob = pending.find(j => j.request_id === requestId);
    assert.ok(myJob, 'Job should be in pending list');
    assert.strictEqual(myJob.status, 'processing', 'Job status should be processing');
    console.log('✅ Job Creation Passed');

    // 3. Status Update Test
    console.log('Testing Job Update...');
    updateJobStatus(requestId, 'completed', 'http://result.com/video.mp4');
    
    const pendingAfter = getPendingJobs();
    const myJobAfter = pendingAfter.find(j => j.request_id === requestId);
    assert.strictEqual(myJobAfter, undefined, 'Completed job should not be in pending list (depending on query)');
    
    // Check direct DB read if needed, but getPendingJobs filters by status='processing'
    console.log('✅ Job Update Passed');

    console.log('--- All Core Tests Passed ---');
}

runTest().catch(console.error);
