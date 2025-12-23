require('dotenv').config();
const bot = require('./src/bot');
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
        // Start Queue
        queueService.start();

        // Mount Telegram webhook route
        app.post('/telegram/webhook', bot.webhookCallback('/telegram/webhook'));

        // Start Server
        app.listen(PORT, () => {
            logger.info(`Express Server running on port ${PORT}`);
        });

        // Start Bot
        const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
            if (PUBLIC_URL && typeof PUBLIC_URL === 'string' && PUBLIC_URL.trim().length > 0) {
                let domain = PUBLIC_URL.trim();
                if (!/^https?:\/\//i.test(domain)) domain = 'https://' + domain;
                const fullUrl = domain.replace(/\/+$/,'') + '/telegram/webhook';
                try {
                    await bot.telegram.setWebhook(fullUrl);
                    logger.info(`Telegram Webhook set: ${fullUrl}`);
                } catch (e) {
                    logger.warn(`Failed to set webhook, falling back to polling: ${e.message}`);
                    try {
                        await bot.telegram.deleteWebhook();
                    } catch (_) {}
                    await bot.launch();
                    logger.info('Telegram Bot Started (Polling)');
                }
            } else {
                try {
                    await bot.telegram.deleteWebhook();
                } catch (_) {}
                await bot.launch();
                logger.info('Telegram Bot Started (Polling)');
            }
        } else {
            logger.warn('BOT_TOKEN missing, bot not started');
        }

    } catch (e) {
        logger.error('Startup Failed', e);
        process.exit(1);
    }
}

start();
