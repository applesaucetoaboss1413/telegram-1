const { PROMO_IMAGES, PROMO_CONFIG } = require('../config/promoImages');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

async function postPromoBatch(bot) {
    try {
        logger.info('Posting promo batch', { count: PROMO_IMAGES.length, channel: PROMO_CONFIG.channelId });
        
        const me = await bot.telegram.getMe();
        const botUsername = me.username;
        
        // Construct media group (album)
        const mediaGroup = PROMO_IMAGES.map(promo => ({
            type: 'photo',
            media: promo.path,
            caption: promo.caption.replace(/@YourBotName/g, `@${botUsername}`)
        }));
        
        await bot.telegram.sendMediaGroup(PROMO_CONFIG.channelId, mediaGroup);
        
        logger.info('Promo batch posted successfully');
    } catch (error) {
        logger.error('Failed to post promo batch:', { error: error.message, stack: error.stack });
        
        // Retry logic on failure
        logger.info(`Retrying in ${PROMO_CONFIG.retryDelayMs / 60000} minutes...`);
        setTimeout(() => postPromoBatch(bot), PROMO_CONFIG.retryDelayMs);
    }
}

function startPromoScheduler(bot) {
    logger.info('Starting promo scheduler (Batch Mode)');
    
    // Initial post
    postPromoBatch(bot).catch(err => {
        logger.error('Initial promo batch post failed', { error: err.message });
    });
    
    // Recurring interval
    setInterval(() => postPromoBatch(bot), PROMO_CONFIG.intervalMs);
}

module.exports = { startPromoScheduler };
