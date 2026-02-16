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
            logger.info('Welcome credits granted - new record', {
                telegramUserId: tId,
                stripeCustomerId,
                amount: 69,
                newRecord: true
            });
            return true;
        }

        if (!record.welcome_granted) {
            // Update existing record to grant credits
            db.prepare(`
                UPDATE user_credits 
                SET credits = credits + 69, welcome_granted = 1, updated_at = ?
                WHERE id = ?
            `).run(now, record.id);
            logger.info('Welcome credits granted - existing record', {
                telegramUserId: tId,
                stripeCustomerId,
                amount: 69,
                previousCredits: record.credits,
                newRecord: false
            });
            return true;
        }

        logger.info('Welcome credits already granted - no action taken', {
            telegramUserId: tId,
            stripeCustomerId,
            currentCredits: record.credits
        });
        return false;
    } catch (error) {
        logger.error('Error granting welcome credits', {
            error: error.message,
            telegramUserId,
            stripeCustomerId,
            stack: error.stack
        });
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

/**
 * Grants credits to a user (general function).
 */
const grantCredits = ({ telegramUserId, amount }) => {
    try {
        const tId = String(telegramUserId);
        const now = Date.now();

        // Get existing record
        let record = db.prepare('SELECT * FROM user_credits WHERE telegram_user_id = ? ORDER BY updated_at DESC').get(tId);
        if (!record) {
            // Create new
            db.prepare(`
                INSERT INTO user_credits (telegram_user_id, credits, created_at, updated_at)
                VALUES (?, ?, ?, ?)
            `).run(tId, amount, now, now);
        } else {
            // Update
            db.prepare(`
                UPDATE user_credits
                SET credits = credits + ?, updated_at = ?
                WHERE id = ?
            `).run(amount, now, record.id);
        }
        logger.info('Credits granted', { telegramUserId: tId, amount });
        return true;
    } catch (error) {
        logger.error('Error granting credits', { error: error.message, telegramUserId, amount });
        return false;
    }
};

/**
 * Deducts credits from a user.
 */
const deductCredits = ({ telegramUserId, amount }) => {
    return spendCredits({ telegramUserId, amount });
};

/**
 * Initializes user credits record with 0 credits if not exists.
 */
const initializeUserCredits = (telegramUserId) => {
    try {
        const tId = String(telegramUserId);
        const now = Date.now();
        let record = db.prepare('SELECT * FROM user_credits WHERE telegram_user_id = ?').get(tId);
        if (!record) {
            db.prepare(`
                INSERT INTO user_credits (telegram_user_id, credits, created_at, updated_at)
                VALUES (?, 0, ?, ?)
            `).run(tId, now, now);
        }
    } catch (error) {
        logger.error('Error initializing user credits', { error: error.message, telegramUserId });
    }
};

/**
 * Gets all users' credit balances.
 */
const getAllUserCredits = () => {
    try {
        return db.prepare('SELECT telegram_user_id, SUM(credits) as credits_balance FROM user_credits GROUP BY telegram_user_id').all();
    } catch (error) {
        logger.error('Error getting all user credits', { error: error.message });
        return [];
    }
};

// ============ NEW MONETIZATION FEATURES ============

/**
 * Check and grant daily free credits (10 credits/day to drive engagement)
 * Returns { granted: boolean, amount: number, nextClaimTime: number }
 */
const claimDailyCredits = ({ telegramUserId }) => {
    try {
        const tId = String(telegramUserId);
        const now = Date.now();
        const dailyAmount = Number(process.env.DAILY_FREE_CREDITS || 10);

        // Get or create daily claims record
        let claim = db.prepare('SELECT * FROM daily_claims WHERE telegram_user_id = ?').get(tId);

        if (!claim) {
            // First claim ever - grant credits
            db.prepare('INSERT INTO daily_claims (telegram_user_id, last_claim, streak) VALUES (?, ?, 1)').run(tId, now);
            grantCredits({ telegramUserId: tId, amount: dailyAmount });
            logger.info('Daily credits claimed (first time)', { telegramUserId: tId, amount: dailyAmount });
            return { granted: true, amount: dailyAmount, streak: 1, nextClaimTime: now + 24 * 60 * 60 * 1000 };
        }

        const lastClaim = claim.last_claim;
        const timeSinceClaim = now - lastClaim;
        const oneDayMs = 24 * 60 * 60 * 1000;

        if (timeSinceClaim < oneDayMs) {
            // Too soon - can't claim yet
            const nextClaimTime = lastClaim + oneDayMs;
            const hoursLeft = Math.ceil((nextClaimTime - now) / (60 * 60 * 1000));
            return { granted: false, amount: 0, streak: claim.streak, nextClaimTime, hoursLeft };
        }

        // Can claim! Check streak
        const twoDaysMs = 2 * oneDayMs;
        let newStreak = timeSinceClaim < twoDaysMs ? (claim.streak || 0) + 1 : 1;

        // Streak bonus: +2 credits per day of streak (max +20)
        const streakBonus = Math.min(newStreak * 2, 20);
        const totalAmount = dailyAmount + streakBonus;

        db.prepare('UPDATE daily_claims SET last_claim = ?, streak = ? WHERE telegram_user_id = ?').run(now, newStreak, tId);
        grantCredits({ telegramUserId: tId, amount: totalAmount });

        logger.info('Daily credits claimed', { telegramUserId: tId, amount: totalAmount, streak: newStreak, streakBonus });
        return { granted: true, amount: totalAmount, streak: newStreak, streakBonus, nextClaimTime: now + oneDayMs };

    } catch (error) {
        logger.error('Error claiming daily credits', { error: error.message, telegramUserId });
        return { granted: false, amount: 0, error: error.message };
    }
};

/**
 * Get user's purchase history to determine if first purchase (for discount)
 */
const isFirstPurchase = ({ telegramUserId }) => {
    try {
        const tId = String(telegramUserId);
        const purchase = db.prepare('SELECT * FROM purchases WHERE telegram_user_id = ? LIMIT 1').get(tId);
        return !purchase;
    } catch (error) {
        logger.error('Error checking first purchase', { error: error.message, telegramUserId });
        return true; // Assume first purchase on error (better for conversion)
    }
};

/**
 * Record a purchase
 */
const recordPurchase = ({ telegramUserId, amount, packType, stripeSessionId }) => {
    try {
        const tId = String(telegramUserId);
        const now = Date.now();
        db.prepare('INSERT INTO purchases (telegram_user_id, amount_cents, pack_type, stripe_session_id, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(tId, amount, packType, stripeSessionId, now);
        logger.info('Purchase recorded', { telegramUserId: tId, amount, packType });
        return true;
    } catch (error) {
        logger.error('Error recording purchase', { error: error.message, telegramUserId });
        return false;
    }
};

/**
 * Get total videos created (for social proof)
 */
const getTotalVideosCreated = () => {
    try {
        const result = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'completed'").get();
        return result ? result.count : 0;
    } catch (error) {
        logger.error('Error getting total videos', { error: error.message });
        return 0;
    }
};

/**
 * Get total paying users (for social proof)
 */
const getTotalPayingUsers = () => {
    try {
        const result = db.prepare('SELECT COUNT(DISTINCT telegram_user_id) as count FROM purchases').get();
        return result ? result.count : 0;
    } catch (error) {
        logger.error('Error getting total paying users', { error: error.message });
        return 0;
    }
};

module.exports = {
    grantWelcomeCredits,
    getCredits,
    spendCredits,
    grantCredits,
    deductCredits,
    initializeUserCredits,
    getAllUserCredits,
    // New monetization features
    claimDailyCredits,
    isFirstPurchase,
    recordPurchase,
    getTotalVideosCreated,
    getTotalPayingUsers
};
