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
        points INTEGER DEFAULT 10,
        created_at INTEGER,
        is_premium INTEGER DEFAULT 0
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
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) {
        const now = Date.now();
        db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(id, now);
        return { id, points: 10, created_at: now, is_premium: 0 };
    }
    return user;
};

const updateUserPoints = (id, delta) => {
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(delta, id);
    return getUser(id);
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
    createJob,
    updateJobStatus,
    getPendingJobs,
    getJob,
    addTransaction
};
