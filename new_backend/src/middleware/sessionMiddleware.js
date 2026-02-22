const { db } = require('../database');
const winston = require('winston');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

/**
 * SQLite-backed session middleware for Telegraf.
 * Persists session state across bot restarts and enforces User-ID based scoping
 * (instead of Chat-ID based), allowing state to persist between DM and Channels.
 */
module.exports = () => async (ctx, next) => {
    const key = ctx.from && ctx.from.id ? String(ctx.from.id) : null;
    
    // If no user context (e.g. channel post without user), skip session persistence
    if (!key) {
        ctx.session = {};
        return next();
    }

    // Load session
    let session = {};
    try {
        const row = db.prepare('SELECT session FROM sessions WHERE id = ?').get(key);
        if (row && row.session) {
            session = JSON.parse(row.session);
        }
    } catch (e) {
        logger.error('Session load error', { error: e.message, userId: key });
    }

    // Initialize default session structure if needed
    if (!session) session = {};
    
    // Attach to context
    ctx.session = session;

    try {
        // Process update
        await next();
    } finally {
        // Save session (only if context exists and session is object)
        try {
            if (ctx.session) {
                const json = JSON.stringify(ctx.session);
                const now = Date.now();
                
                // Upsert session
                db.prepare(`
                    INSERT INTO sessions (id, session, updated_at) 
                    VALUES (?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET session = ?, updated_at = ?
                `).run(key, json, now, json, now);
            }
        } catch (e) {
            logger.error('Session save error', { error: e.message, userId: key });
        }
    }
};
