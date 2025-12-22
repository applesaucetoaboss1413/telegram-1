require('dotenv').config();
const bot = require('./src/bot');
const app = require('./src/server');
const queueService = require('./src/services/queueService');
const winston = require('winston');

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

        // Start Server
        app.listen(PORT, () => {
            logger.info(`Express Server running on port ${PORT}`);
        });

        // Start Bot
        const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
            await bot.launch();
            logger.info('Telegram Bot Started');
        } else {
            logger.warn('BOT_TOKEN missing, bot not started');
        }

    } catch (e) {
        logger.error('Startup Failed', e);
        process.exit(1);
    }
}

start();
