const { db } = require('../database');
const winston = require('winston');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

/**
 * Grants 69 welcome credits to a new paying user.
 * Credits are only granted once per (telegramUserId, stripeCustomerId) pair.
 */
const grantWelcomeCredits = ({ telegramUserId, stripeCustomerId }) => {
    try {
        const now = Date.now();
        const tId = String(telegramUserId);

        // Try to get existing record
        let record = db.prepare('SELECT * FROM user_credits WHERE telegram_user_id = ? AND stripe_customer_id = ?')
            .get(tId, stripeCustomerId);

        if (!record) {
            // Create new record and grant credits
            db.prepare(`
                INSERT INTO user_credits (telegram_user_id, stripe_customer_id, credits, welcome_granted, created_at, updated_at)
                VALUES (?, ?, 69, 1, ?, ?)
            `).run(tId, stripeCustomerId, now, now);
            logger.info('Welcome credits granted', { telegramUserId: tId, stripeCustomerId, amount: 69 });
            return true;
        }

        if (!record.welcome_granted) {
            // Update existing record to grant credits
            db.prepare(`
                UPDATE user_credits 
                SET credits = 69, welcome_granted = 1, updated_at = ?
                WHERE id = ?
            `).run(now, record.id);
            logger.info('Welcome credits granted to existing user', { telegramUserId: tId, stripeCustomerId, amount: 69 });
            return true;
        }

        logger.info('Welcome credits already granted', { telegramUserId: tId, stripeCustomerId });
        return false;
    } catch (error) {
        logger.error('Error granting welcome credits', { error: error.message, telegramUserId, stripeCustomerId });
        return false;
    }
};

/**
 * Gets current credit balance for a user.
 */
const getCredits = ({ telegramUserId }) => {
    try {
        const record = db.prepare('SELECT SUM(credits) as total FROM user_credits WHERE telegram_user_id = ?')
            .get(String(telegramUserId));
        return record ? (record.total || 0) : 0;
    } catch (error) {
        logger.error('Error getting credits', { error: error.message, telegramUserId });
        return 0;
    }
};

/**
 * Spends credits for a user. Atomic operation to prevent double-spending.
 */
const spendCredits = ({ telegramUserId, amount }) => {
    try {
        const tId = String(telegramUserId);
        const now = Date.now();

        // Find the first available record with enough credits (simple logic for now)
        // In a multi-record scenario (unlikely per spec), we might need to deduct across records.
        // But per spec, we usually have one primary record for this user.
        const record = db.prepare('SELECT * FROM user_credits WHERE telegram_user_id = ? AND credits >= ? ORDER BY updated_at DESC')
            .get(tId, amount);

        if (!record) {
            logger.warn('Insufficient credits', { telegramUserId: tId, required: amount });
            return false;
        }

        const result = db.prepare(`
            UPDATE user_credits 
            SET credits = credits - ?, updated_at = ?
            WHERE id = ? AND credits >= ?
        `).run(amount, now, record.id, amount);

        if (result.changes > 0) {
            logger.info('Credits spent', { telegramUserId: tId, amount, remaining: record.credits - amount });
            return true;
        }

        return false;
    } catch (error) {
        logger.error('Error spending credits', { error: error.message, telegramUserId, amount });
        return false;
    }
};

module.exports = {
    grantWelcomeCredits,
    getCredits,
    spendCredits
};
