const { PROMO_IMAGES, PROMO_CONFIG } = require('../config/promoImages');
const { getKV, setKV } = require('../database');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [new winston.transports.Console()]
});

const OWNER_DM_ID = process.env.OWNER_DM_ID || 8063916626;

async function sendAdminAlert(bot, message) {
    try {
        await bot.telegram.sendMessage(OWNER_DM_ID, `🚨 *PROMO ALERT* 🚨\n\n${message}`, { parse_mode: 'Markdown' });
    } catch (err) {
        logger.error('Failed to send admin alert', { error: err.message });
    }
}

function validateContent(promo) {
    if (!promo.id || !promo.path || !promo.caption) {
        throw new Error(`Invalid promo metadata for ID: ${promo.id}`);
    }
    if (promo.caption.length < 10) {
        throw new Error(`Caption too short for ID: ${promo.id}`);
    }
    // Simple URL validation
    if (!promo.path.startsWith('http')) {
        throw new Error(`Invalid URL for ID: ${promo.id}`);
    }
    return true;
}

async function postPromoBatch(bot, retryCount = 0) {
    const startTime = Date.now();
    try {
        logger.info('Starting promo batch execution', { count: PROMO_IMAGES.length, channel: PROMO_CONFIG.channelId, retryCount });

        // 1. Pre-posting Validation
        PROMO_IMAGES.forEach(validateContent);

        const me = await bot.telegram.getMe();
        const botUsername = me.username;

        // 2. Construct media group
        const mediaGroup = PROMO_IMAGES.map(promo => ({
            type: 'photo',
            media: promo.path,
            caption: promo.caption.replace(/@YourBotName/g, `@${botUsername}`)
        }));

        // 3. Post to Telegram
        const results = await bot.telegram.sendMediaGroup(PROMO_CONFIG.channelId, mediaGroup);
        
        // 4. Verification
        if (!results || results.length !== PROMO_IMAGES.length) {
            throw new Error(`Post verification failed: expected ${PROMO_IMAGES.length} messages, got ${results?.length || 0}`);
        }

        // 5. Success State Update
        const state = getKV('promo_state') || { error_history: [] };
        state.last_successful_post = Date.now();
        state.retry_count = 0;
        state.last_error = null;
        setKV('promo_state', state);

        logger.info('Promo batch posted successfully', { duration: Date.now() - startTime });
        
    } catch (error) {
        const errorMsg = error.message;
        logger.error('Failed to post promo batch', { error: errorMsg, retryCount, stack: error.stack });

        // Update State with Error
        const state = getKV('promo_state') || { error_history: [] };
        state.last_error = { timestamp: Date.now(), message: errorMsg };
        state.error_history.push(state.last_error);
        if (state.error_history.length > 50) state.error_history.shift(); // Limit history
        state.retry_count = retryCount + 1;
        setKV('promo_state', state);

        // Admin Alerts
        if (state.retry_count >= 3) {
            await sendAdminAlert(bot, `Persistent failure in promo scheduler (Attempt ${state.retry_count}):\n\n${errorMsg}`);
        }

        // Exponential Backoff Retry
        // Initial delay 5 mins, double each time, max 1 hour
        const delay = Math.min(PROMO_CONFIG.retryDelayMs * Math.pow(2, retryCount), 60 * 60 * 1000);
        logger.info(`Scheduling retry in ${delay / 60000} minutes...`);
        setTimeout(() => postPromoBatch(bot, state.retry_count), delay);
    }
}

async function startPromoScheduler(bot) {
    logger.info('Initializing enhanced promo scheduler');

    const state = getKV('promo_state') || {};
    const now = Date.now();
    const lastPost = state.last_successful_post || 0;
    const timeSinceLastPost = now - lastPost;

    // Heartbeat for downtime monitoring
    setInterval(() => {
        const s = getKV('promo_state') || {};
        s.last_heartbeat = Date.now();
        setKV('promo_state', s);
    }, 60000); // Every minute

    // Check for downtime on startup
    if (state.last_heartbeat && (now - state.last_heartbeat) > 15 * 60 * 1000) {
        await sendAdminAlert(bot, `System recovery detected. Downtime was approximately ${Math.round((now - state.last_heartbeat) / 60000)} minutes.`);
    }

    // Adherence check: If last post was more than 6 hours ago, post immediately
    if (timeSinceLastPost >= PROMO_CONFIG.intervalMs) {
        logger.info('Last post exceeded interval or never occurred. Posting immediately.');
        postPromoBatch(bot).catch(err => {
            logger.error('Initial startup post failed', { error: err.message });
        });
    } else {
        const remainingTime = PROMO_CONFIG.intervalMs - timeSinceLastPost;
        logger.info(`Next scheduled post in ${Math.round(remainingTime / 60000)} minutes`);
        setTimeout(() => postPromoBatch(bot), remainingTime);
    }

    // Set recurring interval
    setInterval(() => postPromoBatch(bot), PROMO_CONFIG.intervalMs);
}

module.exports = { startPromoScheduler };
