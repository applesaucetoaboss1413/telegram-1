require('dotenv').config();
const { bot, runPromo } = require('./src/bot');
const app = require('./src/server');
const express = require('express');
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
        logger.info(`Bot starting`, { publicUrl: PUBLIC_URL });
        bot.on('polling_error', (err) => logger.error('Polling error:', err));

        // Start Queue
        queueService.start();

        // Mount Telegram webhook route
        app.use('/telegram/webhook', express.json());
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
            try {
                const me = await bot.telegram.getMe();
                logger.info('Telegram bot identity', { username: me && me.username, id: me && me.id });
            } catch (e) {
                logger.error(`ERROR: BOT_TOKEN invalid or Telegram unreachable: ${e.message}`);
            }
            if (PUBLIC_URL && typeof PUBLIC_URL === 'string' && PUBLIC_URL.trim().length > 0) {
                let base = PUBLIC_URL.trim().replace(/[,\s]+$/g, '');
                if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
                let fullUrl;
                try {
                    const u = new URL(base.replace(/[,\s]+$/g, ''));
                    u.hash = '';
                    u.search = '';
                    u.pathname = u.pathname.replace(/\/+$/g, '');
                    if (!u.pathname.endsWith('/telegram/webhook')) {
                        u.pathname = `${u.pathname}/telegram/webhook`.replace(/\/{2,}/g, '/');
                    }
                    fullUrl = u.toString().replace(/[,\s]+$/g, '');
                } catch (_) {
                    fullUrl = base.replace(/[,\s]+$/g, '').replace(/\/+$/g, '') + '/telegram/webhook';
                    fullUrl = fullUrl.replace(/[,\s]+$/g, '');
                }
                try {
                    await bot.telegram.setWebhook(fullUrl, { drop_pending_updates: true });
                    logger.info(`Telegram Webhook set: ${fullUrl}`);
                    try {
                        const info = await bot.telegram.getWebhookInfo();
                        logger.info('Telegram Webhook info', {
                            url: info && info.url,
                            pending_update_count: info && info.pending_update_count,
                            last_error_date: info && info.last_error_date,
                            last_error_message: info && info.last_error_message
                        });
                    } catch (e) {
                        logger.error(`ERROR: Failed to read Telegram webhook info: ${e.message}`);
                    }
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
