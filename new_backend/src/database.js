const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const winston = require('winston');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

const dbPath = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath);
}

const db = new Database(path.join(dbPath, 'faceswap.db'));

// Initialize Schema - including new monetization tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        points INTEGER DEFAULT 0,
        created_at INTEGER,
        is_premium INTEGER DEFAULT 0,
        referred_by TEXT,
        has_purchased INTEGER DEFAULT 0,
        language TEXT DEFAULT 'en'
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

    CREATE TABLE IF NOT EXISTS user_credits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_user_id TEXT,
        stripe_customer_id TEXT,
        credits INTEGER DEFAULT 0,
        welcome_granted INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(telegram_user_id, stripe_customer_id)
    );

    -- NEW: Daily claims for engagement
    CREATE TABLE IF NOT EXISTS daily_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_user_id TEXT UNIQUE,
        last_claim INTEGER,
        streak INTEGER DEFAULT 0
    );

    -- NEW: Purchase history for tracking first purchase discounts
    CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_user_id TEXT,
        amount_cents INTEGER,
        pack_type TEXT,
        stripe_session_id TEXT,
        created_at INTEGER
    );

    -- NEW: Promotional credits with expiry
    CREATE TABLE IF NOT EXISTS promo_credits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_user_id TEXT,
        credits INTEGER,
        source TEXT,
        expires_at INTEGER,
        created_at INTEGER
    );

    -- NEW: Analytics events for conversion tracking
    CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_user_id TEXT,
        event_type TEXT,
        event_data TEXT,
        created_at INTEGER
    );

    -- NEW: User templates for storing user-provided templates
    CREATE TABLE IF NOT EXISTS user_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        template_video_url TEXT NOT NULL,
        template_photo_url TEXT NOT NULL,
        video_size INTEGER NOT NULL,
        photo_size INTEGER NOT NULL,
        video_duration INTEGER,
        photo_width INTEGER,
        photo_height INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    );

    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(telegram_user_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);
`);

// Add language column if it doesn't exist (migration for existing databases)
try {
    db.prepare("ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'en'").run();
    console.log('Added language column to users table');
} catch (e) {
    // Column already exists, ignore
}

// Add last_activity column for re-engagement tracking
try {
    db.prepare("ALTER TABLE users ADD COLUMN last_activity INTEGER").run();
    console.log('Added last_activity column to users table');
} catch (e) {
    // Column already exists, ignore
}

// Add winback_sent column for tracking win-back offers
try {
    db.prepare("ALTER TABLE users ADD COLUMN winback_sent INTEGER DEFAULT 0").run();
    console.log('Added winback_sent column to users table');
} catch (e) {
    // Column already exists, ignore
}

// Migration: Add has_purchased column if it doesn't exist
try {
    const columns = db.pragma("table_info('users')");
    const hasColumn = columns.some(col => col.name === 'has_purchased');
    if (!hasColumn) {
        db.exec('ALTER TABLE users ADD COLUMN has_purchased INTEGER DEFAULT 0');
        console.log('Added has_purchased column to users table');
    }
} catch (e) {
    console.log('Migration check for has_purchased column:', e.message);
}

// User Methods
const getUser = (id) => {
    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

    // Special override for admin/testing user
    const adminIds = (process.env.ADMIN_IDS || '1087968824,8063916626').split(',').map(s => s.trim());
    if (adminIds.includes(String(id))) {
        if (!user) {
            const now = Date.now();
            db.prepare('INSERT INTO users (id, points, created_at) VALUES (?, ?, ?)').run(String(id), 10000, now);
            logger.info(`test user ${id} created with balance=10000`);
            return { id: String(id), points: 10000, created_at: now, is_premium: 0, referred_by: null, has_purchased: 0 };
        } else if (user.points < 10000) {
            db.prepare('UPDATE users SET points = 10000 WHERE id = ?').run(String(id));
            logger.info(`test user ${id} balance updated to 10000`);
            user.points = 10000;
        }
    }

    if (!user) {
        const now = Date.now();
        db.prepare('INSERT INTO users (id, points, created_at) VALUES (?, 0, ?)').run(id, now);
        return { id, points: 0, created_at: now, is_premium: 0, referred_by: null, has_purchased: 0 };
    }

    // Update last activity
    db.prepare('UPDATE users SET last_activity = ? WHERE id = ?').run(Date.now(), id);

    return user;
};

const updateUserPoints = (id, delta) => {
    db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(delta, id);
    return getUser(id);
};

const setReferredBy = (userId, referrerId) => {
    if (userId === referrerId) return;
    const user = getUser(userId);
    if (!user.referred_by) {
        db.prepare('UPDATE users SET referred_by = ? WHERE id = ?').run(referrerId, userId);
    }
};

const markPurchased = (userId) => {
    db.prepare('UPDATE users SET has_purchased = 1 WHERE id = ?').run(userId);
};

const setUserLanguage = (userId, language) => {
    try {
        getUser(userId); // Ensure user exists
        db.prepare('UPDATE users SET language = ? WHERE id = ?').run(language, String(userId));
        console.log(`Language set to ${language} for user ${userId}`);
    } catch (e) {
        console.error('setUserLanguage error:', e.message);
    }
};

const getUserLanguage = (userId) => {
    try {
        const user = getUser(userId);
        return user?.language || 'en';
    } catch (e) {
        return 'en';
    }
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

// Analytics Methods (NEW)
const trackEvent = (telegramUserId, eventType, eventData = {}) => {
    try {
        db.prepare('INSERT INTO analytics_events (telegram_user_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)')
            .run(String(telegramUserId), eventType, JSON.stringify(eventData), Date.now());
    } catch (error) {
        logger.error('Error tracking event', { error: error.message, eventType });
    }
};

const getEventCount = (eventType, sinceTimestamp = 0) => {
    try {
        const result = db.prepare('SELECT COUNT(*) as count FROM analytics_events WHERE event_type = ? AND created_at > ?')
            .get(eventType, sinceTimestamp);
        return result ? result.count : 0;
    } catch (error) {
        return 0;
    }
};

module.exports = {
    db,
    getUser,
    updateUserPoints,
    setReferredBy,
    markPurchased,
    setUserLanguage,
    getUserLanguage,
    createJob,
    updateJobStatus,
    updateJobMeta,
    getPendingJobs,
    getJob,
    addTransaction,
    trackEvent,
    getEventCount
};
