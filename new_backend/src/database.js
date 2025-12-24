const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath);
}

const db = new Database(path.join(dbPath, 'faceswap.db'));

// Initialize Schema
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        points INTEGER DEFAULT 0,
        created_at INTEGER,
        is_premium INTEGER DEFAULT 0,
        referred_by TEXT,
        has_purchased INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS jobs (
        request_id TEXT PRIMARY KEY,
        user_id TEXT,
        chat_id TEXT,
        type TEXT,
        status TEXT,
        created_at INTEGER,
        result_url TEXT,
        error_message TEXT,
        meta TEXT
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        amount INTEGER,
        reason TEXT,
        created_at INTEGER
    );
`);

// User Methods
const getUser = (id) => {
    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

    // Special override for admin/testing user
    if (String(id) === '1087968824' || String(id) === '8063916626') {
        if (!user) {
            // If admin doesn't exist, create with 10000 points
            const now = Date.now();
            db.prepare('INSERT INTO users (id, points, created_at) VALUES (?, ?, ?)').run(String(id), 10000, now);
            console.log(`INFO: test user ${id} created with balance=10000`);
            return { id: String(id), points: 10000, created_at: now, is_premium: 0, referred_by: null, has_purchased: 0 };
        } else if (user.points < 10000) {
            // If admin exists but has low points, top up to 10000
            db.prepare('UPDATE users SET points = 10000 WHERE id = ?').run(String(id));
            console.log(`INFO: test user ${id} balance updated to 10000`);
            user.points = 10000;
        } else {
             console.log(`INFO: test user ${id} already has high balance=${user.points}`);
        }
    }

    if (!user) {
        const now = Date.now();
        // New regular users start with 0 points
        db.prepare('INSERT INTO users (id, points, created_at) VALUES (?, 0, ?)').run(id, now);
        return { id, points: 0, created_at: now, is_premium: 0, referred_by: null, has_purchased: 0 };
    }
    return user;
};

const updateUserPoints = (id, delta) => {
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(delta, id);
    return getUser(id);
};

const setReferredBy = (userId, referrerId) => {
    // Only set if not already set and not self-referral
    if (userId === referrerId) return;
    const user = getUser(userId);
    if (!user.referred_by) {
        db.prepare('UPDATE users SET referred_by = ? WHERE id = ?').run(referrerId, userId);
    }
};

const markPurchased = (userId) => {
    db.prepare('UPDATE users SET has_purchased = 1 WHERE id = ?').run(userId);
};

// Job Methods
const createJob = (requestId, userId, chatId, type, meta = {}) => {
    db.prepare(`
        INSERT INTO jobs (request_id, user_id, chat_id, type, status, created_at, meta)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(requestId, userId, chatId, type, 'processing', Date.now(), JSON.stringify(meta));
};

const updateJobStatus = (requestId, status, resultUrl = null, error = null) => {
    const result = db.prepare(`
        UPDATE jobs 
        SET status = ?, result_url = ?, error_message = ? 
        WHERE request_id = ? AND status = 'processing'
    `).run(status, resultUrl, error, requestId);
    return result.changes;
};

const updateJobMeta = (requestId, meta = {}) => {
    db.prepare(`
        UPDATE jobs
        SET meta = ?
        WHERE request_id = ?
    `).run(JSON.stringify(meta), requestId);
};
const getPendingJobs = () => {
    return db.prepare("SELECT * FROM jobs WHERE status = 'processing'").all();
};

const getJob = (requestId) => {
    return db.prepare('SELECT * FROM jobs WHERE request_id = ?').get(requestId);
};

// Transaction Methods
const addTransaction = (userId, amount, reason) => {
    db.prepare('INSERT INTO transactions (user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)').run(userId, amount, reason, Date.now());
};

module.exports = {
    db,
    getUser,
    updateUserPoints,
    setReferredBy,
    markPurchased,
    createJob,
    updateJobStatus,
    updateJobMeta,
    getPendingJobs,
    getJob,
    addTransaction
};
