require('dotenv').config();
const { bot, runPromo } = require('./src/bot');
const app = require('./src/server');
const queueService = require('./src/services/queueService');
const winston = require('winston');
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.PUBLIC_BASE || '';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
});

const PORT = process.env.PORT || 3000;

async function start() {
    try {
        console.log(`🔥 DEMO BOT LIVE: using PUBLIC_URL=${PUBLIC_URL || '<<missing>>'}`);
        // Start Queue
        queueService.start();

        // Mount Telegram webhook route
        app.post('/telegram/webhook', bot.webhookCallback('/telegram/webhook'));

        // Start Server
        app.listen(PORT, () => {
            logger.info(`Express Server running on port ${PORT}`);
        });

        // Start Bot
        const token = process.env.BOT_TOKEN;
        if (token) {
            try {
                const tail = token.slice(-4);
                logger.info(`Using BOT_TOKEN (ends with ****${tail})`);
            } catch (_) { }
            if (PUBLIC_URL && typeof PUBLIC_URL === 'string' && PUBLIC_URL.trim().length > 0) {
                let domain = PUBLIC_URL.trim();
                if (!/^https?:\/\//i.test(domain)) domain = 'https://' + domain;
                const fullUrl = domain.replace(/\/+$/, '') + '/telegram/webhook';
                try {
                    await bot.telegram.setWebhook(fullUrl);
                    logger.info(`Telegram Webhook set: ${fullUrl}`);
                    try { global.__BOT_RUNNING = 'webhook'; } catch (_) { }
                } catch (e) {
                    logger.error(`ERROR: Failed to set Telegram webhook: ${e.message}`);
                    try {
                        await bot.telegram.deleteWebhook();
                    } catch (_) { }
                    await bot.launch();
                    logger.info('Telegram Bot Started (Polling)');
                    try { global.__BOT_RUNNING = 'polling'; } catch (_) { }
                }
            } else {
                logger.error('ERROR: PUBLIC_URL missing; webhook not set');
                await bot.launch();
                logger.info('Telegram Bot Started (Polling)');
                try { global.__BOT_RUNNING = 'polling'; } catch (_) { }
            }
        } else {
            logger.warn('BOT_TOKEN missing, bot not started');
        }

    } catch (e) {
        logger.error('Startup Failed', { error: e.message, stack: e.stack });
        process.exit(1);
    }
    logger.info("Bot started successfully");
    
    // Trigger startup promo after a short delay
    setTimeout(() => {
        runPromo().catch(err => logger.error('Startup promo failed:', err));
    }, 5000);
}

start();
