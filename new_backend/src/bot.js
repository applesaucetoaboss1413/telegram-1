const { Telegraf, Markup } = require('telegraf');
const path = require('path');
const os = require('os');
const sessionMiddleware = require('./middleware/sessionMiddleware');
const { getUser, createJob, addTransaction, updateJobStatus, db, trackEvent, setUserLanguage, getUserLanguage } = require('./database');
const { spendCredits, getCredits, claimDailyCredits, isFirstPurchase, getTotalVideosCreated, grantWelcomeCredits, grantCredits } = require('./services/creditsService');
const { startFaceSwap, startFaceSwapPreview, startImage2Video } = require('./services/magicService');
const queueService = require('./services/queueService');
const { downloadTo, downloadBuffer, cleanupFile } = require('./utils/fileUtils');
const { detectFaces } = require('./services/faceService');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const winston = require('winston');
const { uploadFromUrl } = require('./services/cloudinaryService');
const runImage2VideoFlow = require('../dist/ts/image2videoHandler.js').runImage2VideoFlow;
const demoCfg = require('./services/a2eConfig');
const { t } = require('./config/translations');
const { getBilingualPromoMessage, getBilingualBuyButtons, getDirectPurchaseButtons } = require('./services/promoUtils');
const BUILD_ID = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || null;
const axios = require('axios');

// ============ INPUT VALIDATION & SECURITY ============

// Allowed deep link payloads (whitelist)
const VALID_DEEP_LINKS = new Set([
    'studio', 'get_credits', 'buy_points', 'create',
    'buy_micro', 'buy_starter', 'buy_plus', 'buy_pro',
    'lang_en', 'lang_es', 'promo', 'daily', 'success',
    'cancel', 'examples'
]);

// Sanitize user text input - strip control chars, limit length
function sanitizeInput(input, maxLength = 500) {
    if (typeof input !== 'string') return '';
    // Strip null bytes, control chars (except newline/tab), and excessive whitespace
    let cleaned = input
        .replace(/\0/g, '')                    // null bytes
        .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // control chars except \n \r \t
        .trim();
    if (cleaned.length > maxLength) {
        cleaned = cleaned.substring(0, maxLength);
    }
    return cleaned;
}

// Validate Telegram user ID - must be a positive integer
function isValidTelegramId(id) {
    if (id === undefined || id === null) return false;
    const num = Number(id);
    return Number.isInteger(num) && num > 0 && num < 1e15;
}

// Rate limiter - per user, per action
const rateLimitStore = new Map();
const RATE_LIMITS = {
    command: { max: 15, windowMs: 60000 },      // 15 commands per minute
    payment: { max: 5, windowMs: 60000 },        // 5 payment attempts per minute
    deeplink: { max: 10, windowMs: 60000 },       // 10 deep links per minute
    upload: { max: 5, windowMs: 300000 },          // 5 uploads per 5 minutes
};

function checkRateLimit(userId, action = 'command') {
    const limit = RATE_LIMITS[action] || RATE_LIMITS.command;
    const key = `${userId}:${action}`;
    const now = Date.now();

    if (!rateLimitStore.has(key)) {
        rateLimitStore.set(key, []);
    }

    const timestamps = rateLimitStore.get(key).filter(ts => now - ts < limit.windowMs);
    rateLimitStore.set(key, timestamps);

    if (timestamps.length >= limit.max) {
        return false; // Rate limited
    }

    timestamps.push(now);
    return true; // Allowed
}

// Periodic cleanup of stale rate limit entries (every 5 min)
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of rateLimitStore.entries()) {
        const fresh = timestamps.filter(ts => now - ts < 300000);
        if (fresh.length === 0) {
            rateLimitStore.delete(key);
        } else {
            rateLimitStore.set(key, fresh);
        }
    }
}, 300000);

// ============ END INPUT VALIDATION & SECURITY ============

// Exchange rate helper (mirrors server.js implementation)
const SAFE_RATES_BOT = { MXN: 18.0, CAD: 1.36, EUR: 0.92, GBP: 0.79 };
const EXCHANGE_RATE_CACHE_BOT = {};
const EXCHANGE_RATE_TTL_BOT = 3600000; // 1 hour

async function fetchUsdRate(toCurrency) {
    const key = toCurrency.toUpperCase();
    if (EXCHANGE_RATE_CACHE_BOT[key] && EXCHANGE_RATE_CACHE_BOT._ts && Date.now() - EXCHANGE_RATE_CACHE_BOT._ts < EXCHANGE_RATE_TTL_BOT) {
        return EXCHANGE_RATE_CACHE_BOT[key];
    }
    try {
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
        Object.assign(EXCHANGE_RATE_CACHE_BOT, response.data.rates);
        EXCHANGE_RATE_CACHE_BOT._ts = Date.now();
        return EXCHANGE_RATE_CACHE_BOT[key] || SAFE_RATES_BOT[key] || 1;
    } catch (e) {
        logger.error('Exchange rate fetch failed', { error: e.message });
        return SAFE_RATES_BOT[key] || 1;
    }
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const UPLOADS_DIR = path.join(os.tmpdir(), 'telegram_uploads');
const fs = require('fs');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Logger setup
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

// ============ MIDDLEWARE ============

// Persistent Session Middleware (SQLite-backed, User-Scoped)
bot.use(sessionMiddleware());

// Logging + validation middleware
bot.use(async (ctx, next) => {
    try {
        const t = ctx.updateType;
        const uid = ctx.from && ctx.from.id;
        logger.info('update', { type: t, user: uid });

        // Validate user ID exists and is valid
        if (ctx.from && !isValidTelegramId(ctx.from.id)) {
            logger.warn('Invalid telegram user ID detected', { rawId: ctx.from.id });
            return; // Drop the update
        }
    } catch (_) { }
    return next();
});

// Global error handler - prevents crashes from unhandled errors
bot.catch((err, ctx) => {
    const userId = ctx.from ? ctx.from.id : 'unknown';
    logger.error('Unhandled bot error', {
        error: err.message,
        stack: err.stack,
        userId,
        updateType: ctx.updateType
    });
    try {
        if (ctx.chat && ctx.chat.type === 'private') {
            ctx.reply('Something went wrong. Please try again or use /start.').catch(() => {});
        }
    } catch (_) {}
});

const normalizeTargetId = (targetId) => {
    if (targetId === undefined || targetId === null) return null;
    const s = String(targetId).trim();
    if (/^-?\d+$/.test(s)) {
        const n = Number(s);
        if (!Number.isFinite(n)) return null;
        return n;
    }
    if (/^@[\w\d_]{5,}$/.test(s)) return s;
    if (/^https?:\/\/t\.me\/[\w\d_]{5,}$/i.test(s)) {
        const slug = s.replace(/^https?:\/\/t\.me\//i, '');
        return `@${slug}`;
    }
    return null;
};

const isValidChannelTarget = (targetId) => {
    const s = String(targetId).trim();
    return /^-100\d+$/.test(s) || /^@[\w\d_]{5,}$/.test(s);
};

// Helpers
const getFileLink = async (ctx, fileId) => {
    const link = await ctx.telegram.getFileLink(fileId);
    let url = link.href;
    return url;
};

const validatePhoto = async (ctx, fileId, fileSize) => {
    if (fileSize > 10 * 1024 * 1024) {
        throw new Error('Image too large. Maximum size is 10MB.');
    }

    const url = await getFileLink(ctx, fileId);
    let buffer;
    try {
        buffer = await downloadBuffer(url);
    } catch (e) {
        throw new Error('Failed to download image for validation.');
    }

    try {
        const faces = await detectFaces(buffer);
        if (faces.length === 0) {
            throw new Error('No human face detected. Please ensure the face is clearly visible (90% confidence).');
        }
    } catch (e) {
        logger.error('Face detection internal error:', e);
        throw new Error('Could not verify face in image. Please try another photo.');
    }

    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        logger.warn('Telegram URL missing standard image extension', { url });
    }

    return { url, buffer };
};

// Listeners for Queue
queueService.on('job_complete', async ({ job, output }) => {
    try {
        if (job.chat_id) {
            await bot.telegram.sendMessage(job.chat_id, '✅ Swap Complete!');
            if (job.type === 'video' || output.endsWith('.mp4')) {
                await bot.telegram.sendVideo(job.chat_id, output);
            } else {
                await bot.telegram.sendPhoto(job.chat_id, output);
            }
        }
    } catch (e) {
        logger.error('Failed to send result:', e);
    }
});

queueService.on('job_failed', async ({ job, error }) => {
    try {
        if (job.chat_id) {
            await bot.telegram.sendMessage(job.chat_id, `❌ Job Failed: ${error}`);
            const meta = JSON.parse(job.meta || '{}');
            const refund = Number(meta.price_points || (job.type === 'video' ? 15 : 9));
            grantCredits({ telegramUserId: job.user_id, amount: refund });
            addTransaction(job.user_id, refund, 'refund_failed_job');
            await bot.telegram.sendMessage(job.chat_id, `💰 ${refund} points have been refunded.`);
        }
    } catch (e) {
        logger.error('Failed to send failure notification:', e);
    }
});

bot.command('upload_template', async (ctx) => {
    const userId = String(ctx.from.id);
    if (!isValidTelegramId(ctx.from.id)) return;
    if (!checkRateLimit(userId, 'upload')) {
        return ctx.reply('Too many upload attempts. Please wait a few minutes.');
    }
    ctx.session = {
        mode: 'template_upload',
        step: 'awaiting_video',
        userId: userId
    };

    await ctx.replyWithMarkdown(
        `📹 *Template Upload*\n\nPlease send your **template video** (MP4 format, max 15MB, up to 30 seconds):`,
        Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'cancel_template_upload')],
            [Markup.button.callback('ℹ️ Help', 'upload_help')]
        ])
    );
});

bot.action('cancel_template_upload', async (ctx) => {
    ctx.session = null;
    await ctx.answerCbQuery('Template upload cancelled');
    await ctx.editMessageText('Template upload cancelled');
});

bot.command('upload_help', async (ctx) => {
    await ctx.replyWithMarkdown(
        `📝 *Template Upload Guide*\n\n` +
        `To create face-swap videos, you need to upload:\n` +
        `1. A *video template* (MP4 format, max 15MB, 5-30 seconds)\n` +
        `2. A *photo template* (JPEG/PNG, max 10MB, clear front-facing face)\n\n` +
        `*Requirements:*\n` +
        `- Video must show a consistent face throughout\n` +
        `- Photo must be well-lit and high quality\n` +
        `- Both files must meet size requirements\n\n` +
        `Start with /upload_template or tap the button below:`,
        Markup.inlineKeyboard([
            [Markup.button.callback('📤 Start Template Upload', 'upload_template')]
        ])
    );
});

bot.command('start', async (ctx) => {
    const userId = String(ctx.from.id);

    // Validate user ID
    if (!isValidTelegramId(ctx.from.id)) {
        return ctx.reply('Invalid request.');
    }

    const payload = ctx.message?.text?.split(' ')[1];

    if (payload) {
        // Sanitize and validate deep link payload
        const cleanPayload = sanitizeInput(payload, 50);
        logger.info('Deep link triggered', { userId, payload: cleanPayload });

        // Rate limit deep links
        if (!checkRateLimit(userId, 'deeplink')) {
            logger.warn('Rate limited deep link', { userId, payload: cleanPayload });
            return ctx.reply('Too many requests. Please wait a moment and try again.');
        }

        // Validate against whitelist
        if (!VALID_DEEP_LINKS.has(cleanPayload)) {
            logger.warn('Unknown/invalid deep link payload', { userId, payload: cleanPayload });
            return sendDemoMenuWithBuyButtons(ctx);
        }

        switch (cleanPayload) {
            case 'studio':
                return ctx.replyWithMarkdown(
                    '✨ *AI Face-Swap Studio*\n\nOpening studio...',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[{
                                text: '🚀 Open Studio',
                                web_app: { url: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp` : 'https://telegramalam.onrender.com/miniapp/' }
                            }]]
                        }
                    }
                );
            case 'get_credits':
                logger.info('Checking 69 free credits eligibility', { userId });
                // Check if already claimed
                const hasWelcomeCredits = db.prepare('SELECT 1 FROM user_credits WHERE telegram_user_id = ? AND welcome_granted = 1').get(userId);
                if (hasWelcomeCredits) {
                    return ctx.replyWithMarkdown(
                        `*Offer Already Claimed / Oferta Ya Reclamada*\n\n` +
                        `You've already received your 69 free welcome credits!\n` +
                        `_¡Ya has recibido tus 69 créditos de bienvenida!_\n\n` +
                        `Check your balance with /credits`
                    );
                }

                // Require Stripe card verification — create a setup-mode Checkout Session
                try {
                    if (!checkRateLimit(userId, 'payment')) {
                        return ctx.reply('Too many attempts. Please wait a minute.');
                    }

                    const setupSession = await stripe.checkout.sessions.create({
                        mode: 'setup',
                        adaptive_pricing: { enabled: true },
                        success_url: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp?welcome=true` : 'https://telegramalam.onrender.com/miniapp/?welcome=true',
                        cancel_url: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp?cancel=true` : 'https://telegramalam.onrender.com/miniapp/?cancel=true',
                        client_reference_id: String(userId),
                        metadata: {
                            userId: String(userId),
                            type: 'welcome_credits',
                            credits: '69',
                            source: 'telegram_bot'
                        }
                    });

                    logger.info('Free credits setup session created', { userId, sessionId: setupSession.id });

                    return ctx.replyWithMarkdown(
                        `*Get 69 FREE Credits / Obtén 69 Créditos GRATIS*\n\n` +
                        `Verify your card to claim your welcome bonus.\n` +
                        `_Verifica tu tarjeta para reclamar tu bono._\n\n` +
                        `No charge — just a quick verification.\n` +
                        `_Sin cargo — solo una verificación rápida._\n\n` +
                        `Credits are added instantly after verification.`,
                        Markup.inlineKeyboard([
                            [Markup.button.url('Verify Card & Get Credits / Verificar Tarjeta', setupSession.url)]
                        ])
                    );
                } catch (e) {
                    logger.error('Free credits setup session failed', { error: e.message, userId });
                    return ctx.reply('Could not start verification. Please try again later.');
                }
            case 'buy_points':
                return sendBuyPointsMenu(ctx);
            case 'create':
                // Go directly into faceswap flow - no template needed
                const createCredits = getCredits({ telegramUserId: userId });
                if (createCredits < (demoCfg.demoPrices['5'] || 60)) {
                    return ctx.replyWithMarkdown(
                        `You need at least *${demoCfg.demoPrices['5']} credits* to create a video.\nYou have *${createCredits} credits*.`,
                        Markup.inlineKeyboard([
                            [Markup.button.callback('Get Free Credits', 'get_free_credits')],
                            [Markup.button.callback('Buy Credits', 'buy_points_menu')]
                        ])
                    );
                }
                ctx.session = {
                    mode: 'demo',
                    step: 'awaiting_base_video',
                    duration: 5,
                    price: demoCfg.demoPrices['5'] || 60
                };
                return ctx.replyWithMarkdown(
                    `*Create Face Swap Video*\n\n` +
                    `Step 1: Send your video (max 5 seconds, MP4)\n` +
                    `Step 2: Send the target face photo\n\n` +
                    `Cost: ${demoCfg.demoPrices['5']} credits | Balance: ${createCredits} credits\n\n` +
                    `Send your video now:`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback('10s video instead (90 credits)', 'demo_len_10')],
                        [Markup.button.callback('15s video instead (125 credits)', 'demo_len_15')]
                    ])
                );

            case 'buy_micro':
                try {
                    if (!checkRateLimit(userId, 'payment')) {
                        return ctx.reply('Too many payment attempts. Please wait a minute.');
                    }
                    const sessionMicro = await createStripeCheckoutSession({ userId, packType: 'micro', currency: 'usd' });
                    return ctx.reply('Complete your purchase:', {
                        reply_markup: { inline_keyboard: [[{ text: '💳 Pay - 80 Credits', url: sessionMicro.url }]] }
                    });
                } catch (e) {
                    logger.error('buy_micro deep link failed', { error: e.message, userId });
                    return ctx.reply('Payment system error. Please try again later.');
                }

            case 'buy_starter':
                try {
                    if (!checkRateLimit(userId, 'payment')) {
                        return ctx.reply('Too many payment attempts. Please wait a minute.');
                    }
                    const sessionStarter = await createStripeCheckoutSession({ userId, packType: 'starter', currency: 'usd' });
                    return ctx.reply('Complete your purchase:', {
                        reply_markup: { inline_keyboard: [[{ text: '💳 Pay - 400 Credits', url: sessionStarter.url }]] }
                    });
                } catch (e) {
                    logger.error('buy_starter deep link failed', { error: e.message, userId });
                    return ctx.reply('Payment system error. Please try again later.');
                }

            case 'buy_plus':
                try {
                    if (!checkRateLimit(userId, 'payment')) {
                        return ctx.reply('Too many payment attempts. Please wait a minute.');
                    }
                    const sessionPlus = await createStripeCheckoutSession({ userId, packType: 'plus', currency: 'usd' });
                    return ctx.reply('Complete your purchase:', {
                        reply_markup: { inline_keyboard: [[{ text: '💳 Pay - 800 Credits', url: sessionPlus.url }]] }
                    });
                } catch (e) {
                    logger.error('buy_plus deep link failed', { error: e.message, userId });
                    return ctx.reply('Payment system error. Please try again later.');
                }

            case 'buy_pro':
                try {
                    if (!checkRateLimit(userId, 'payment')) {
                        return ctx.reply('Too many payment attempts. Please wait a minute.');
                    }
                    const sessionPro = await createStripeCheckoutSession({ userId, packType: 'pro', currency: 'usd' });
                    return ctx.reply('Complete your purchase:', {
                        reply_markup: { inline_keyboard: [[{ text: '💳 Pay - 1600 Credits', url: sessionPro.url }]] }
                    });
                } catch (e) {
                    logger.error('buy_pro deep link failed', { error: e.message, userId });
                    return ctx.reply('Payment system error. Please try again later.');
                }

            case 'lang_en':
                setUserLanguage(userId, 'en');
                await ctx.replyWithMarkdown('✅ Language changed to English');
                return sendDemoMenuWithBuyButtons(ctx);

            case 'lang_es':
                setUserLanguage(userId, 'es');
                await ctx.replyWithMarkdown('✅ Idioma cambiado a Español');
                return sendDemoMenuWithBuyButtons(ctx);

            case 'promo':
                return sendDemoMenuWithBuyButtons(ctx);

            case 'daily': {
                const dailyResult = claimDailyCredits({ telegramUserId: userId });
                if (dailyResult.granted) {
                    let dailyMsg = `🎁 *Daily Credits Claimed!*\n\n+${dailyResult.amount} credits added`;
                    if (dailyResult.streak > 1) {
                        dailyMsg += `\n🔥 *${dailyResult.streak}-day streak!* (+${dailyResult.streakBonus || 0} bonus)`;
                    }
                    dailyMsg += `\n\n_Come back tomorrow for more!_`;
                    return ctx.replyWithMarkdown(dailyMsg);
                } else {
                    const hrs = dailyResult.hoursLeft || 24;
                    return ctx.reply(`⏰ Already claimed today!\n\nCome back in ${hrs} hours.\n🔥 Streak: ${dailyResult.streak || 0} days`);
                }
            }

            case 'success':
                return ctx.replyWithMarkdown(
                    '✅ *Payment Successful!*\n\nYour credits have been added to your account.\n\nUse /start to see your balance and create videos!'
                );

            case 'cancel':
                return ctx.replyWithMarkdown(
                    '❌ *Payment Cancelled*\n\nNo worries! You can try again anytime.\n\nUse /start to see available options.',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('💳 Try Again', 'buy_points_menu')],
                        [Markup.button.callback('🎬 Create Video', 'demo_new')]
                    ])
                );

            case 'examples':
                return ctx.replyWithMarkdown(
                    '🎬 *See What You Can Create!*\n\n' +
                    'Our AI can swap faces in any video:\n' +
                    '• Music videos\n• Movie scenes\n• Funny clips\n• And more!\n\n' +
                    'Ready to try?',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('🎬 Create Video Now', 'demo_new')],
                        [Markup.button.callback('💳 Buy Credits', 'buy_points_menu')]
                    ])
                );

            default:
                logger.info('Unhandled deep link payload', { userId, payload: cleanPayload });
                return sendDemoMenuWithBuyButtons(ctx);
        }
    }

    // Initialize session if it doesn't exist
    if (!ctx.session) ctx.session = {};

    // Check if deep link payload exists (already handled above) or if it's a clean start
    // We now SHOW THE MENU by default to everyone, instead of blocking for templates.
    // This ensures consistent promos and funneling to Mini App.
    
    // Only check templates if user explicitly wants to view/manage them
    // or if they are in a specific flow that requires them.

    // Show the main menu with bilingual promo and buy buttons
    return sendDemoMenuWithBuyButtons(ctx);
});

// REMOVED: Implicit template check that blocked the start menu
// The template check is now moved to specific actions (create_video, etc.)

bot.action('template_help', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.replyWithMarkdown(
        '📝 *Template Requirements*\n\n' +
        '*Video Template*:\n' +
        '- MP4 format\n' +
        '- Max 15MB\n' +
        '- 5-30 seconds\n' +
        '- Clear, consistent face throughout\n\n' +
        '*Photo Template*:\n' +
        '- JPEG or PNG\n' +
        '- Max 10MB\n' +
        '- Well-lit, front-facing face\n\n' +
        'Start with /upload_template'
    );
});

// ─── UNIFIED video handler ────────────────────────────────────────────────────
bot.on('video', async (ctx) => {
    if (!ctx.session) return;

    const video = ctx.message.video;
    const fileId = video.file_id;
    const fileSize = video.file_size;

    try {
        // Template upload flow
        if (ctx.session.mode === 'template_upload' && ctx.session.step === 'awaiting_video') {
            if (fileSize > 15 * 1024 * 1024) {
                return ctx.reply('Video too large. Maximum size is 15MB.');
            }
            if (video.mime_type !== 'video/mp4') {
                return ctx.reply('Only MP4 videos are supported as templates.');
            }
            const url = await getFileLink(ctx, fileId);
            ctx.session.templateVideo = { url, size: fileSize, duration: video.duration };
            ctx.session.step = 'awaiting_photo';
            await ctx.replyWithMarkdown(
                '✅ Video template received! Now please send your **template photo** (JPEG/PNG, max 10MB, clear front-facing face):',
                Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'cancel_template_upload')]])
            );
            return;
        }

        // Demo flow - awaiting base video
        if (ctx.session.mode === 'demo' && ctx.session.step === 'awaiting_base_video') {
            if (video.duration > ctx.session.duration) {
                return ctx.reply(`❌ Video too long. Maximum duration is ${ctx.session.duration} seconds.`);
            }
            const url = await getFileLink(ctx, fileId);
            ctx.session.base_url = url;
            ctx.session.step = 'awaiting_face';
            await ctx.reply('✅ Video received. Now please send a clear photo of the face you want to use:');
            return;
        }

        // Create video flow - awaiting base video
        if (ctx.session.mode === 'create_video' && ctx.session.step === 'awaiting_base_video') {
            if (video.duration > ctx.session.duration) {
                return ctx.reply(`❌ Video too long. Maximum duration is ${ctx.session.duration} seconds.`);
            }
            const url = await getFileLink(ctx, video.file_id);
            ctx.session.base_url = url;
            ctx.session.step = 'awaiting_face';
            await ctx.reply('✅ Video received. Now please send a clear photo of the face you want to use:');
            return;
        }

    } catch (e) {
        ctx.reply(`❌ Error processing video: ${e.message}`);
        ctx.session = null;
    }
});

// ─── UNIFIED photo handler ────────────────────────────────────────────────────
bot.on('photo', async (ctx) => {
    if (!ctx.session) return;

    const userId = String(ctx.from.id);
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    const fileSize = photo.file_size;

    try {
        // Template upload flow
        if (ctx.session.mode === 'template_upload' && ctx.session.step === 'awaiting_photo') {
            if (fileSize > 10 * 1024 * 1024) {
                return ctx.reply('Photo too large. Maximum size is 10MB.');
            }
            const url = await getFileLink(ctx, fileId);
            db.prepare(
                'INSERT OR REPLACE INTO user_templates (user_id, template_video_url, template_photo_url, video_size, photo_size, video_duration, last_used) VALUES (?, ?, ?, ?, ?, ?, datetime("now"))'
            ).run(
                ctx.session.userId,
                ctx.session.templateVideo.url,
                url,
                ctx.session.templateVideo.size,
                fileSize,
                ctx.session.templateVideo.duration
            );
            ctx.session = null;
            await ctx.replyWithMarkdown(
                '✅ Template upload complete!\n\nYou can now use face-swap commands with your uploaded template.',
                Markup.inlineKeyboard([[Markup.button.callback('🎬 Create Video', 'demo_new')]])
            );
            return;
        }

        // Demo flow - awaiting face photo
        if (ctx.session.mode === 'demo' && ctx.session.step === 'awaiting_face') {
            await ctx.reply('🔍 Verifying photo...');
            const { url } = await validatePhoto(ctx, fileId, fileSize);
            const faceUrl = await uploadFromUrl(url, 'image');
            const baseUrl = ctx.session.base_url;
            const price = ctx.session.price || 0;
            
            // Use unified credit service for atomic transactions
            if (!spendCredits({ telegramUserId: userId, amount: price })) {
                const u = getUser(userId);
                return ctx.reply(`❌ Not enough points. You need ${price}, but have ${u.points || 0}.`);
            }
            
            addTransaction(userId, -price, 'demo_start');
            await ctx.reply('Processing your demo… this usually takes up to 120 seconds.');
            try {
                const requestId = await startFaceSwap(faceUrl, baseUrl);
                const code = `DEMO-USER`;
                createJob(requestId, userId, String(ctx.chat.id), 'demo', { service: 'faceswap', price_points: price, code });
            } catch (e) {
                // Refund on error
                grantCredits({ telegramUserId: userId, amount: price });
                addTransaction(userId, price, 'refund_api_error');
                ctx.reply(`❌ Error starting demo: ${e.message}. Points refunded.`);
            }
            ctx.session = null;
            return;
        }

        // Create video flow - awaiting face photo
        if (ctx.session.mode === 'create_video' && ctx.session.step === 'awaiting_face') {
            const sortedPhotos = ctx.message.photo.sort((a, b) => b.file_size - a.file_size);
            const { url } = await getFileLink(ctx, sortedPhotos[0].file_id);
            ctx.session.face_url = url;
            await handleVideoCreation(ctx);
            return;
        }

    } catch (e) {
        ctx.reply(`❌ ${e.message}`);
        ctx.session = null;
    }
});

// Template check helper function
const checkUserHasTemplates = (userId) => {
    const template = db.prepare(
        'SELECT id FROM user_templates WHERE user_id = ? LIMIT 1'
    ).get(userId);
    return !!template;
};

const getTemplateMissingMessage = () => {
    return {
        text: '❌ You need to upload templates first!\n\nUse /upload_template to upload your video and photo templates.',
        markup: Markup.inlineKeyboard([
            [Markup.button.callback('📤 Upload Templates', 'upload_template')]
        ])
    };
};

async function sendDemoMenu(ctx) {
    const userId = ctx.from ? String(ctx.from.id) : String(ctx.chat.id);
    const user = getUser(userId);
    const credits = getCredits({ telegramUserId: userId });

    if (ctx.session) ctx.session.step = null;

    if (ctx.chat && (ctx.chat.type === 'private' || ctx.chat.type === 'channel' || ctx.chat.type === 'supergroup')) {
        const p = demoCfg.packs;
        const msg = `🎭 *AI Face Swap Bot*
_Swap your face into any video in seconds!_

*💰 Credit Packs:*
🎯 Try It – ${p.micro.points} pts (~1 video) – *$0.99*
⭐ Starter – ${p.starter.points} pts (~${p.starter.approx5sDemos} videos) – $4.99
🔥 Plus – ${p.plus.points} pts (~${p.plus.approx5sDemos} videos) – $8.99
💎 Pro – ${p.pro.points} pts (~${p.pro.approx5sDemos} videos) – $14.99

*How it works:*
1️⃣ Get credits (free welcome bonus available!)
2️⃣ Send your video template (MP4 format)
3️⃣ Send face photo
4️⃣ Get your AI face-swapped video!`;
        await ctx.replyWithMarkdown(msg);
    }

    const miniAppUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp` : 'https://telegramalam.onrender.com/miniapp/';

    let creditMsg = '';
    let buttons = [
        [Markup.button.webApp('🎨✨ OPEN FULL STUDIO APP ✨🎨', miniAppUrl)],
        [Markup.button.callback('🎬 Create Video', 'demo_new')],
        [Markup.button.callback('🎁 Daily Free Credits', 'claim_daily')],
        [Markup.button.callback('💳 Buy Credits', 'buy_points_menu')],
        [Markup.button.callback('❓ Help', 'help')]
    ];

    if (credits > 0) {
        creditMsg = `\n\n💰 *Your Balance:* ${credits} credits (~${Math.floor(credits / 60)} videos)`;
        if (credits < 60) {
            creditMsg += `\n⚠️ _Not enough for a video - top up below!_`;
        }
    } else if (user.points > 0) {
        creditMsg = `\n\n💰 *Your Points:* ${user.points} (~${Math.floor(user.points / 60)} videos)`;
    } else {
        creditMsg = `\n\n🎁 *New User Bonus:* Get 69 FREE credits - enough for your first video!`;
    }

    await ctx.replyWithMarkdown(
        `👋 Welcome! You have ${user.points} points (~${Math.floor(user.points / 60)} videos).${creditMsg}`,
        Markup.inlineKeyboard(buttons)
    );
}

bot.command('help', async (ctx) => {
    await ctx.replyWithMarkdown(
        '🆘 *Help Center / Ayuda*\n\n' +
        '*How to create a Face Swap:*\n' +
        '1️⃣ Upload a Photo (Your Face)\n' +
        '2️⃣ Upload a Video (5-15 seconds)\n' +
        '3️⃣ Wait for Magic!\n\n' +
        '*Cómo crear un Face Swap:*\n' +
        '1️⃣ Sube una Foto (Tu Rostro)\n' +
        '2️⃣ Sube un Video (5-15 segundos)\n' +
        '3️⃣ ¡Espera la Magia!\n\n' +
        '*Requirements / Requisitos:*\n' +
        '- Video: MP4, max 15MB\n' +
        '- Photo: JPEG/PNG, max 10MB'
    );
});

async function sendDemoMenuWithBuyButtons(ctx) {
    const userId = ctx.from ? String(ctx.from.id) : String(ctx.chat.id);
    const Markup = require('telegraf').Markup;

    if (ctx.session) ctx.session.step = null;

    // Use unified bilingual promo message
    const msg = getBilingualPromoMessage();
    
    // Use direct purchase buttons for better conversion in DM
    const buttons = getDirectPurchaseButtons(Markup);

    await ctx.replyWithMarkdown(msg, buttons);
}

async function sendBuyPointsMenu(ctx) {
    const userId = String(ctx.from.id);
    const Markup = require('telegraf').Markup;
    
    // Use direct purchase buttons
    const buttons = getDirectPurchaseButtons(Markup);
    
    await ctx.replyWithMarkdown(
        `💰 *Get More Credits / Obtener Créditos*\n\n` +
        `Choose a pack below to top up your balance.\n` +
        `_Elige un paquete abajo para recargar._\n\n` +
        `✨ *Best Value:* Pro Pack (25% off)\n` +
        `✨ *Mejor Valor:* Paquete Pro (25% desc.)`,
        buttons
    );
}

bot.command('daily', async (ctx) => {
    const userId = String(ctx.from.id);
    const result = claimDailyCredits({ telegramUserId: userId });

    if (result.granted) {
        let msg = `🎁 *Daily Credits Claimed / Créditos Diarios Reclamados!*\n\n+${result.amount} credits added / créditos añadidos`;
        if (result.streak > 1) {
            msg += `\n🔥 *${result.streak}-day streak!* (+${result.streakBonus || 0} bonus)`;
        }
        msg += `\n\n_Come back tomorrow for more! / ¡Vuelve mañana por más!_`;
        await ctx.replyWithMarkdown(msg);
    } else {
        const hours = result.hoursLeft || 24;
        await ctx.reply(`⏰ Already claimed today! / ¡Ya reclamaste hoy!\n\nCome back in ${hours} hours.\n_Vuelve en ${hours} horas._\n\n🔥 Streak: ${result.streak || 0} days/días`);
    }
});

bot.command('image_to_video', async (ctx) => {
    const userId = String(ctx.from.id);

    if (!checkUserHasTemplates(userId)) {
        return ctx.replyWithMarkdown(
            '❌ You need to upload templates first!\n\nUse /upload_template to upload your video and photo templates.',
            Markup.inlineKeyboard([
                [Markup.button.callback('📤 Upload Templates', 'upload_template')]
            ])
        );
    }

    ctx.session = {
        mode: 'image_to_video',
        step: 'awaiting_image',
        base_url: ''
    };

    await ctx.reply('🖼️ Please send the image you want to animate:');
});

bot.command('flashsale', async (ctx) => {
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const userId = String(ctx.from.id);

    if (adminIds.length === 0 || !adminIds.includes(userId)) {
        logger.warn('Unauthorized flashsale attempt', { userId });
        return; // Silent reject - don't reveal admin commands exist
    }

    try {
        const { sendFlashSale } = require('./services/promoScheduler');
        await sendFlashSale(bot, 30, 2);
        await ctx.reply('✅ Flash sale sent to channel and all previous buyers!');
    } catch (e) {
        logger.error('Flash sale trigger failed', { error: e.message });
        await ctx.reply(`❌ Error: ${e.message}`);
    }
});

bot.command('reengage', async (ctx) => {
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const userId = String(ctx.from.id);

    if (adminIds.length === 0 || !adminIds.includes(userId)) {
        logger.warn('Unauthorized reengage attempt', { userId });
        return;
    }

    try {
        const { sendReEngagementMessages } = require('./services/promoScheduler');
        await ctx.reply('⏳ Sending re-engagement messages...');
        await sendReEngagementMessages(bot);
        await ctx.reply('✅ Re-engagement messages sent!');
    } catch (e) {
        logger.error('Re-engagement trigger failed', { error: e.message });
        await ctx.reply(`❌ Error: ${e.message}`);
    }
});

bot.command('stats', async (ctx) => {
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const userId = String(ctx.from.id);

    if (adminIds.length === 0 || !adminIds.includes(userId)) {
        logger.warn('Unauthorized stats attempt', { userId });
        return;
    }

    try {
        const totalVideos = getTotalVideosCreated();
        const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count || 0;
        const totalRevenue = db.prepare('SELECT SUM(amount_cents) as total FROM purchases').get()?.total || 0;
        const buyers = db.prepare('SELECT COUNT(DISTINCT telegram_user_id) as count FROM purchases').get()?.count || 0;
        const todayStart = new Date().setHours(0, 0, 0, 0);
        const todayUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE created_at > ?').get(todayStart)?.count || 0;
        const todayRevenue = db.prepare('SELECT SUM(amount_cents) as total FROM purchases WHERE created_at > ?').get(todayStart)?.total || 0;
        const conversionRate = totalUsers > 0 ? ((buyers / totalUsers) * 100).toFixed(2) : 0;

        await ctx.reply(`📊 *BOT STATS*

👥 *Users:* ${totalUsers.toLocaleString()}
📹 *Videos Created:* ${totalVideos.toLocaleString()}
💰 *Total Revenue:* $${(totalRevenue / 100).toFixed(2)}
🛒 *Paying Users:* ${buyers}
📈 *Conversion Rate:* ${conversionRate}%

*TODAY:*
👤 New Users: ${todayUsers}
💵 Revenue: $${((todayRevenue || 0) / 100).toFixed(2)}`, { parse_mode: 'Markdown' });
    } catch (e) {
        logger.error('Stats command failed', { error: e.message });
        await ctx.reply(`❌ Error: ${e.message}`);
    }
});

bot.command('broadcast', async (ctx) => {
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const userId = String(ctx.from.id);

    if (adminIds.length === 0 || !adminIds.includes(userId)) {
        logger.warn('Unauthorized broadcast attempt', { userId });
        return;
    }

    const rawMessage = ctx.message.text.replace('/broadcast', '').trim();
    const message = sanitizeInput(rawMessage, 2000);
    if (!message) {
        return ctx.reply('Usage: /broadcast Your message here');
    }

    try {
        const users = db.prepare('SELECT id FROM users').all();
        let sent = 0;
        let failed = 0;

        await ctx.reply(`⏳ Broadcasting to ${users.length} users...`);

        for (const user of users) {
            try {
                await bot.telegram.sendMessage(user.id, message, { parse_mode: 'Markdown' });
                sent++;
                await new Promise(r => setTimeout(r, 100));
            } catch (e) {
                failed++;
            }
        }

        await ctx.reply(`✅ Broadcast complete!\nSent: ${sent}\nFailed: ${failed}`);
    } catch (e) {
        logger.error('Broadcast failed', { error: e.message });
        await ctx.reply(`❌ Error: ${e.message}`);
    }
});

bot.command('chatid', async (ctx) => {
    try {
        await ctx.reply(String(ctx.chat && ctx.chat.id));
    } catch (e) {
        logger.error('chatid command failed', { error: e.message });
    }
});

bot.command('studio', async (ctx) => {
    try {
        const webAppUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp` : 'https://telegramalam.onrender.com/miniapp/';
        await ctx.reply(
            '✨ *Ai Face-Swap Studio*\n\nTap below to open the full studio:',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [[{ text: '🚀 Open Studio', web_app: { url: webAppUrl } }]],
                    resize_keyboard: true
                }
            }
        );
    } catch (e) {
        logger.error('studio command failed', { error: e.message });
        const fallbackUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp` : 'https://telegramalam.onrender.com/miniapp/';
        await ctx.reply(
            '✨ *Ai Face-Swap Studio*\n\nOpen the app here:\n' + fallbackUrl,
            { parse_mode: 'Markdown' }
        );
    }
});

bot.action('open_studio', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const webAppUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp` : 'https://telegramalam.onrender.com/miniapp/';
        await ctx.reply(
            '✨ *Ai Face-Swap Studio*\n\nTap the button to open:',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [[{ text: '🚀 Open Ai Face-Swap Studio', web_app: { url: webAppUrl } }]],
                    resize_keyboard: true
                }
            }
        );
    } catch (e) {
        logger.error('open_studio action failed', { error: e.message });
        const fallbackUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp` : 'https://telegramalam.onrender.com/miniapp/';
        await ctx.reply(`Open Studio: ${fallbackUrl}`);
    }
});

let cachedBotUsername = null;
async function getBotUsername() {
    if (cachedBotUsername) return cachedBotUsername;
    const me = await bot.telegram.getMe();
    cachedBotUsername = me && me.username ? me.username : null;
    return cachedBotUsername;
}

bot.on('channel_post', async (ctx) => {
    const text = ctx.channelPost?.text;
    if (text && text.trim() === '/start') {
        try {
            logger.info('channel_post: /start detected', { chatId: ctx.chat.id });
            const username = await getBotUsername();
            if (!username) return;
            const url = `https://t.me/${username}?start=promo`;

            await ctx.reply(
                '👋 Please use this bot in private messages to access all features.',
                {
                    reply_markup: {
                        inline_keyboard: [[{ text: 'Open Bot', url }]]
                    }
                }
            );
        } catch (error) {
            logger.error('channel_post handler failed', { error: error.message });
        }
    }
});

bot.action('demo_new', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);

        // Go straight into the faceswap flow - ask for video first
        ctx.session = {
            mode: 'demo',
            step: 'awaiting_base_video',
            duration: 5,
            price: demoCfg.demoPrices['5'] || 60
        };

        const credits = getCredits({ telegramUserId: userId });
        const price = ctx.session.price;

        if (credits < price) {
            ctx.session = null;
            return ctx.replyWithMarkdown(
                `You need at least *${price} credits* to create a video.\nYou currently have *${credits} credits*.`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('Get Free Credits', 'get_free_credits')],
                    [Markup.button.callback('Buy Credits', 'buy_points_menu')]
                ])
            );
        }

        await ctx.replyWithMarkdown(
            `*Create Face Swap Video / Crear Video Face Swap*\n\n` +
            `Step 1: Send your video (max 5 seconds, MP4)\n` +
            `_Paso 1: Envía tu video (max 5 segundos, MP4)_\n\n` +
            `Step 2: Send the face photo\n` +
            `_Paso 2: Envía la foto del rostro_\n\n` +
            `Cost: ${price} credits | Your balance: ${credits} credits\n` +
            `_Costo: ${price} créditos | Tu saldo: ${credits} créditos_\n\n` +
            `Send your video now: / Envía tu video ahora:`,
            Markup.inlineKeyboard([
                [Markup.button.callback('10s video (90 credits)', 'demo_len_10')],
                [Markup.button.callback('15s video (125 credits)', 'demo_len_15')]
            ])
        );
    } catch (e) {
        logger.error('demo_new action failed', { error: e.message, userId: ctx.from.id });
        ctx.reply('Something went wrong. Please try /start again.');
    }
});

bot.action('demo_len_10', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        const price = demoCfg.demoPrices['10'] || 90;
        const credits = getCredits({ telegramUserId: userId });

        if (credits < price) {
            return ctx.replyWithMarkdown(
                `You need *${price} credits* for a 10s video. You have *${credits}*.\n` +
                `_Necesitas *${price} créditos* para un video de 10s. Tienes *${credits}*._`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('Get Free Credits / Créditos Gratis', 'get_free_credits')],
                    [Markup.button.callback('Buy Credits / Comprar Créditos', 'buy_points_menu')]
                ])
            );
        }

        ctx.session = {
            mode: 'demo',
            step: 'awaiting_base_video',
            duration: 10,
            price
        };
        await ctx.reply(`Send your 10-second video now (MP4, max 10s):\n_Envía tu video de 10 segundos ahora (MP4, max 10s):_`);
    } catch (e) {
        logger.error('demo_len_10 action failed', { error: e.message });
    }
});

bot.action('demo_len_15', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        const price = demoCfg.demoPrices['15'] || 125;
        const credits = getCredits({ telegramUserId: userId });

        if (credits < price) {
            return ctx.replyWithMarkdown(
                `You need *${price} credits* for a 15s video. You have *${credits}*.\n` +
                `_Necesitas *${price} créditos* para un video de 15s. Tienes *${credits}*._`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('Get Free Credits / Créditos Gratis', 'get_free_credits')],
                    [Markup.button.callback('Buy Credits / Comprar Créditos', 'buy_points_menu')]
                ])
            );
        }

        ctx.session = {
            mode: 'demo',
            step: 'awaiting_base_video',
            duration: 15,
            price
        };
        await ctx.reply(`Send your 15-second video now (MP4, max 15s):\n_Envía tu video de 15 segundos ahora (MP4, max 15s):_`);
    } catch (e) {
        logger.error('demo_len_15 action failed', { error: e.message });
    }
});

bot.command('view_templates', async (ctx) => {
    const userId = String(ctx.from.id);
    const templates = db.prepare(
        'SELECT * FROM user_templates WHERE user_id = ? ORDER BY last_used DESC'
    ).all(userId);

    if (!templates || templates.length === 0) {
        return ctx.replyWithMarkdown(
            '❌ No templates found. Use /upload_template to upload your first template pair.\n' +
            '_❌ No se encontraron plantillas. Usa /upload_template para subir tu primera plantilla._'
        );
    }

    const templateList = templates.map((t, i) => {
        return `${i + 1}. Video: ${Math.round(t.video_size / 1024 / 1024)}MB, ${t.video_duration}s | Photo: ${Math.round(t.photo_size / 1024)}KB`;
    }).join('\n');

    await ctx.replyWithMarkdown(
        `📂 *Your Templates / Tus Plantillas*\n\n${templateList}\n\n` +
        `Use /delete_template [number] to remove a template.\n` +
        `_Usa /delete_template [numero] para eliminar una plantilla._`
    );
});

bot.command('delete_template', async (ctx) => {
    const userId = String(ctx.from.id);
    const templateNumber = Number(ctx.message.text.split(' ')[1]);

    if (isNaN(templateNumber) || templateNumber < 1) {
        return ctx.reply(
            'Please specify a valid template number. Use /view_templates to see your templates.\n' +
            '_Por favor especifica un número de plantilla válido. Usa /view_templates para ver tus plantillas._'
        );
    }

    const templates = db.prepare(
        'SELECT id FROM user_templates WHERE user_id = ? ORDER BY last_used DESC'
    ).all(userId);

    if (!templates || templateNumber > templates.length) {
        return ctx.reply(
            'Invalid template number. Use /view_templates to see your templates.\n' +
            '_Número de plantilla inválido. Usa /view_templates para ver tus plantillas._'
        );
    }

    const templateId = templates[templateNumber - 1].id;
    db.prepare('DELETE FROM user_templates WHERE id = ?').run(templateId);

    await ctx.reply(`✅ Template #${templateNumber} deleted successfully. / Plantilla #${templateNumber} eliminada exitosamente.`);
});

bot.action('create_5s', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        const price = demoCfg.demoPrices['5'] || 60;
        const credits = getCredits({ telegramUserId: userId });

        if (credits < price) {
            return ctx.replyWithMarkdown(
                `You need *${price} credits* for a 5s video. You have *${credits}*.\n` +
                `_Necesitas *${price} créditos* para un video de 5s. Tienes *${credits}*._`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('Get Free Credits / Créditos Gratis', 'get_free_credits')],
                    [Markup.button.callback('Buy Credits / Comprar Créditos', 'buy_points_menu')]
                ])
            );
        }

        ctx.session = {
            mode: 'demo',
            step: 'awaiting_base_video',
            duration: 5,
            price
        };
        await ctx.reply('Send your 5-second video now (MP4, max 5s):\n_Envía tu video de 5 segundos ahora (MP4, max 5s):_');
    } catch (e) {
        logger.error('create_5s action failed', { error: e.message });
    }
});

bot.action('create_10s', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        const price = demoCfg.demoPrices['10'] || 90;
        const credits = getCredits({ telegramUserId: userId });

        if (credits < price) {
            return ctx.replyWithMarkdown(
                `You need *${price} credits* for a 10s video. You have *${credits}*.\n` +
                `_Necesitas *${price} créditos* para un video de 10s. Tienes *${credits}*._`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('Get Free Credits / Créditos Gratis', 'get_free_credits')],
                    [Markup.button.callback('Buy Credits / Comprar Créditos', 'buy_points_menu')]
                ])
            );
        }

        ctx.session = {
            mode: 'demo',
            step: 'awaiting_base_video',
            duration: 10,
            price
        };
        await ctx.reply('Send your 10-second video now (MP4, max 10s):\n_Envía tu video de 10 segundos ahora (MP4, max 10s):_');
    } catch (e) {
        logger.error('create_10s action failed', { error: e.message });
    }
});

bot.action('create_20s', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        const price = demoCfg.demoPrices['20'] || 150;
        const credits = getCredits({ telegramUserId: userId });

        if (credits < price) {
            return ctx.replyWithMarkdown(
                `You need *${price} credits* for a 20s video. You have *${credits}*.\n` +
                `_Necesitas *${price} créditos* para un video de 20s. Tienes *${credits}*._`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('Get Free Credits / Créditos Gratis', 'get_free_credits')],
                    [Markup.button.callback('Buy Credits / Comprar Créditos', 'buy_points_menu')]
                ])
            );
        }

        ctx.session = {
            mode: 'demo',
            step: 'awaiting_base_video',
            duration: 20,
            price
        };
        await ctx.reply('Send your 20-second video now (MP4, max 20s):\n_Envía tu video de 20 segundos ahora (MP4, max 20s):_');
    } catch (e) {
        logger.error('create_20s action failed', { error: e.message });
    }
});

// Video creation handler - called after receiving both video and photo
async function handleVideoCreation(ctx) {
    try {
        const { base_url, face_url, duration } = ctx.session;
        const userId = String(ctx.from.id);

        const template = db.prepare(
            'SELECT template_video_url, template_photo_url FROM user_templates WHERE user_id = ? ORDER BY last_used DESC LIMIT 1'
        ).get(userId);

        if (!template) {
            return ctx.reply(
                '❌ Templates not found. Please upload templates first.\n' +
                '_❌ Plantillas no encontradas. Por favor sube plantillas primero._'
            );
        }

        await ctx.reply(
            '⏳ Creating your video... This may take a few minutes.\n' +
            '_⏳ Creando tu video... Esto puede tomar unos minutos._'
        );

        const taskId = await startImage2Video({
            base_video_url: base_url,
            face_image_url: face_url,
            template_video_url: template.template_video_url,
            template_photo_url: template.template_photo_url,
            duration: duration
        });

        db.prepare(
            'INSERT INTO user_tasks (user_id, task_id, type, status, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(userId, taskId, 'video_creation', 'processing', Date.now());

        pollTaskStatus(ctx, taskId);
        ctx.session = null;
    } catch (e) {
        logger.error('Video creation failed', { error: e.message });
        ctx.reply(
            '❌ Failed to create video. Please try again later.\n' +
            '_❌ Falló la creación del video. Por favor intenta más tarde._'
        );
    }
}

// Poll task status until completion
async function pollTaskStatus(ctx, taskId) {
    try {
        const status = await checkImage2VideoStatus(taskId);

        if (status.status === 'completed') {
            await ctx.replyWithVideo(status.result_url, {
                caption: '✨ Here is your video! / ¡Aquí está tu video!\n\nCreate another? / ¿Crear otro? 👉 /start'
            });
            db.prepare(
                'UPDATE user_tasks SET status = ?, completed_at = ? WHERE task_id = ?'
            ).run('completed', Date.now(), taskId);
        } else if (status.status === 'failed') {
            await ctx.reply(
                `❌ Video creation failed: ${status.error || 'Unknown error'}\n` +
                `_❌ Creación de video fallida: ${status.error || 'Error desconocido'}_`
            );
            db.prepare(
                'UPDATE user_tasks SET status = ?, error = ? WHERE task_id = ?'
            ).run('failed', status.error, taskId);
        } else {
            setTimeout(() => pollTaskStatus(ctx, taskId), 15000);
        }
    } catch (e) {
        logger.error('Task status check failed', { error: e.message });
    }
}

// Stripe checkout helper function
async function createStripeCheckoutSession({ userId, packType, currency }) {
    try {
        // Validate inputs
        if (!userId || !isValidTelegramId(userId)) {
            throw new Error('Invalid user ID');
        }
        const validPackTypes = ['micro', 'starter', 'plus', 'pro'];
        if (!validPackTypes.includes(packType)) {
            throw new Error('Invalid pack type');
        }

        const pack = demoCfg.packs[packType];
        if (!pack) throw new Error('Invalid pack type');

        // Use MXN as settlement currency - Adaptive Pricing converts to customer's local currency
        const sessionCurrency = 'mxn';

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            adaptive_pricing: { enabled: true },
            line_items: [{
                price_data: {
                    currency: sessionCurrency,
                    product_data: { name: `${pack.label} - ${pack.points} credits` },
                    unit_amount: pack.price_cents
                },
                quantity: 1
            }],
            success_url: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp?success=true` : 'https://telegramalam.onrender.com/miniapp/?success=true',
            cancel_url: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp?cancel=true` : 'https://telegramalam.onrender.com/miniapp/?cancel=true',
            client_reference_id: String(userId),
            metadata: {
                userId: String(userId),
                pack_type: packType,
                points: String(pack.points),
                credits: String(pack.points),
                source: 'telegram_bot'
            }
        });

        logger.info('Stripe checkout session created', { userId, packType, sessionId: session.id });
        return session;
    } catch (e) {
        logger.error('Stripe session creation failed', { error: e.message, userId, packType });
        throw e;
    }
}

bot.action('buy_pack_micro', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        if (!checkRateLimit(userId, 'payment')) {
            return ctx.reply('Too many payment attempts. Please wait a minute.');
        }
        const session = await createStripeCheckoutSession({
            userId,
            packType: 'micro',
            currency: 'usd'
        });
        await ctx.reply('Redirecting to payment...', {
            reply_markup: {
                inline_keyboard: [[{ text: '💳 Pay Now', url: session.url }]]
            }
        });
    } catch (e) {
        logger.error('Micro pack checkout failed', { error: e.message });
        await ctx.reply('Payment processing error. Please try again later.');
    }
});

bot.action('buy_pack_starter', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        if (!checkRateLimit(userId, 'payment')) {
            return ctx.reply('Too many payment attempts. Please wait a minute.');
        }
        const session = await createStripeCheckoutSession({
            userId,
            packType: 'starter',
            currency: 'usd'
        });
        await ctx.reply('Redirecting to payment...', {
            reply_markup: {
                inline_keyboard: [[{ text: '💳 Pay Now', url: session.url }]]
            }
        });
    } catch (e) {
        logger.error('Starter pack checkout failed', { error: e.message });
        await ctx.reply('Payment processing error. Please try again later.');
    }
});

bot.action('buy_pack_plus', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        if (!checkRateLimit(userId, 'payment')) {
            return ctx.reply('Too many payment attempts. Please wait a minute.');
        }
        const session = await createStripeCheckoutSession({
            userId,
            packType: 'plus',
            currency: 'usd'
        });
        await ctx.reply('Redirecting to payment...', {
            reply_markup: {
                inline_keyboard: [[{ text: '💳 Pay Now', url: session.url }]]
            }
        });
    } catch (e) {
        logger.error('Plus pack checkout failed', { error: e.message });
        await ctx.reply('Payment processing error. Please try again later.');
    }
});

bot.action('buy_pack_pro', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        if (!checkRateLimit(userId, 'payment')) {
            return ctx.reply('Too many payment attempts. Please wait a minute.');
        }
        const session = await createStripeCheckoutSession({
            userId,
            packType: 'pro',
            currency: 'usd'
        });
        await ctx.reply('Redirecting to payment...', {
            reply_markup: {
                inline_keyboard: [[{ text: '💳 Pay Now', url: session.url }]]
            }
        });
    } catch (e) {
        logger.error('Pro pack checkout failed', { error: e.message });
        await ctx.reply('Payment processing error. Please try again later.');
    }
});

// Graceful Stop
// ─── MISSING ACTION HANDLERS (FIXED) ────────────────────────────────────────

bot.action('buy_points_menu', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await sendBuyPointsMenu(ctx);
    } catch (e) {
        logger.error('buy_points_menu action failed', { error: e.message });
        await ctx.reply('❌ Error loading buy menu. Please try /start and tap Buy Credits.');
    }
});

bot.action('get_free_credits', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        if (!isValidTelegramId(ctx.from.id)) return;
        if (!checkRateLimit(userId, 'payment')) {
            return ctx.reply('Too many attempts. Please wait a minute.');
        }
        logger.info('get_free_credits action triggered', { userId });

        // Check if already claimed
        const hasWelcomeCredits = db.prepare('SELECT 1 FROM user_credits WHERE telegram_user_id = ? AND welcome_granted = 1').get(userId);
        if (hasWelcomeCredits) {
            return ctx.replyWithMarkdown(
                `*Offer Already Claimed*\n\n` +
                `You've already received your 69 free welcome credits!\n` +
                `Check your balance with /credits or /start`
            );
        }

        // Require Stripe card verification
        const setupSession = await stripe.checkout.sessions.create({
            mode: 'setup',
            adaptive_pricing: { enabled: true },
            success_url: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp?welcome=true` : 'https://telegramalam.onrender.com/miniapp/?welcome=true',
            cancel_url: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp?cancel=true` : 'https://telegramalam.onrender.com/miniapp/?cancel=true',
            client_reference_id: String(userId),
            metadata: {
                userId: String(userId),
                type: 'welcome_credits',
                credits: '69',
                source: 'telegram_bot'
            }
        });

        logger.info('Free credits setup session created via button', { userId, sessionId: setupSession.id });

        return ctx.replyWithMarkdown(
            `*Get 69 FREE Credits / Obtén 69 Créditos GRATIS*\n\n` +
            `Verify your card to claim your welcome bonus.\n` +
            `_Verifica tu tarjeta para reclamar tu bono._\n\n` +
            `No charge — just a quick verification.\n` +
            `_Sin cargo — solo una verificación rápida._\n\n` +
            `Credits are added instantly after verification.`,
            Markup.inlineKeyboard([
                [Markup.button.url('Verify Card & Get Credits / Verificar Tarjeta', setupSession.url)]
            ])
        );
    } catch (e) {
        logger.error('get_free_credits action failed', { error: e.message });
        await ctx.reply('Error processing request. Please try again.');
    }
});

bot.action('claim_daily', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        const result = claimDailyCredits({ telegramUserId: userId });

        if (result.granted) {
            let msg = `🎁 *Daily Credits Claimed / Créditos Diarios Reclamados!*\n\n+${result.amount} credits added / créditos añadidos`;
            if (result.streak > 1) {
                msg += `\n🔥 *${result.streak}-day streak!* (+${result.streakBonus || 0} bonus)`;
            }
            msg += `\n\n_Come back tomorrow for more! / ¡Vuelve mañana por más!_`;
            await ctx.replyWithMarkdown(msg);
        } else {
            const hours = result.hoursLeft || 24;
            await ctx.reply(`⏰ Already claimed today! / ¡Ya reclamaste hoy!\n\nCome back in ${hours} hours.\n_Vuelve en ${hours} horas._\n\n🔥 Streak: ${result.streak || 0} days/días`);
        }
    } catch (e) {
        logger.error('claim_daily action failed', { error: e.message });
        await ctx.reply('❌ Error claiming daily credits. Please try /daily command.');
    }
});

bot.action('change_language', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        const currentLang = getUserLanguage(userId);

        await ctx.replyWithMarkdown(
            '🌐 *Choose your language / Elige tu idioma:*',
            Markup.inlineKeyboard([
                [Markup.button.callback('🇺🇸 English' + (currentLang === 'en' ? ' ✅' : ''), 'set_lang_en')],
                [Markup.button.callback('🇪🇸 Español' + (currentLang === 'es' ? ' ✅' : ''), 'set_lang_es')]
            ])
        );
    } catch (e) {
        logger.error('change_language action failed', { error: e.message });
    }
});

bot.action('set_lang_en', async (ctx) => {
    try {
        await ctx.answerCbQuery('Language set to English ✅');
        const userId = String(ctx.from.id);
        setUserLanguage(userId, 'en');
        await ctx.replyWithMarkdown('✅ Language changed to English');
        await sendDemoMenuWithBuyButtons(ctx);
    } catch (e) {
        logger.error('set_lang_en action failed', { error: e.message });
    }
});

bot.action('set_lang_es', async (ctx) => {
    try {
        await ctx.answerCbQuery('Idioma cambiado a Español ✅');
        const userId = String(ctx.from.id);
        setUserLanguage(userId, 'es');
        await ctx.replyWithMarkdown('✅ Idioma cambiado a Español');
        await sendDemoMenuWithBuyButtons(ctx);
    } catch (e) {
        logger.error('set_lang_es action failed', { error: e.message });
    }
});

bot.action('upload_template', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        ctx.session = {
            mode: 'template_upload',
            step: 'awaiting_video',
            userId: userId
        };
        await ctx.replyWithMarkdown(
            `📹 *Template Upload*\n\nPlease send your **template video** (MP4 format, max 15MB, up to 30 seconds):`,
            Markup.inlineKeyboard([
                [Markup.button.callback('❌ Cancel', 'cancel_template_upload')],
                [Markup.button.callback('ℹ️ Help', 'upload_help')]
            ])
        );
    } catch (e) {
        logger.error('upload_template action failed', { error: e.message });
        await ctx.reply('❌ Error starting template upload. Please try /upload_template command.');
    }
});

bot.action('upload_help', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.replyWithMarkdown(
            `📝 *Template Upload Guide*\n\n` +
            `To create face-swap videos, you need to upload:\n` +
            `1. A *video template* (MP4 format, max 15MB, 5-30 seconds)\n` +
            `2. A *photo template* (JPEG/PNG, max 10MB, clear front-facing face)\n\n` +
            `*Requirements:*\n` +
            `- Video must show a consistent face throughout\n` +
            `- Photo must be well-lit and high quality\n` +
            `- Both files must meet size requirements\n\n` +
            `Start with /upload_template or tap the button below:`,
            Markup.inlineKeyboard([
                [Markup.button.callback('📤 Start Template Upload', 'upload_template')]
            ])
        );
    } catch (e) {
        logger.error('upload_help action failed', { error: e.message });
    }
});

bot.action('view_templates', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        const templates = db.prepare(
            'SELECT * FROM user_templates WHERE user_id = ? ORDER BY last_used DESC'
        ).all(userId);

        if (!templates || templates.length === 0) {
            return ctx.replyWithMarkdown(
                '❌ No templates found. Use /upload_template to upload your first template pair.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('📤 Upload Templates', 'upload_template')]
                ])
            );
        }

        const templateList = templates.map((t, i) => {
            return `${i + 1}. Video: ${Math.round(t.video_size / 1024 / 1024)}MB, ${t.video_duration}s | Photo: ${Math.round(t.photo_size / 1024)}KB`;
        }).join('\n');

        await ctx.replyWithMarkdown(
            `📂 *Your Templates*\n\n${templateList}\n\nUse /delete_template [number] to remove a template.`
        );
    } catch (e) {
        logger.error('view_templates action failed', { error: e.message });
        await ctx.reply('❌ Error loading templates. Please try /view_templates command.');
    }
});

bot.action('help', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.replyWithMarkdown(
            '🆘 *Help Center*\n\n' +
            '*How to use:*\n' +
            '1. /upload_template - Add your video and photo\n' +
            '2. Send /create to make videos\n\n' +
            '*Commands:*\n' +
            '• /start - Main menu\n' +
            '• /daily - Claim free daily credits\n' +
            '• /credits - Check your balance\n' +
            '• /studio - Open full AI studio\n' +
            '• /help - This help message\n\n' +
            '*Requirements:*\n' +
            '- Your own high-quality templates\n' +
            '- Video: MP4, max 15MB\n' +
            '- Photo: JPEG/PNG, max 10MB'
        );
    } catch (e) {
        logger.error('help action failed', { error: e.message });
    }
});

// Add /credits command for checking balance
bot.command('credits', async (ctx) => {
    const userId = String(ctx.from.id);
    const user = getUser(userId);
    const credits = getCredits({ telegramUserId: userId });
    const balance = credits > 0 ? credits : user.points;
    const videos = Math.floor(balance / 60);

    await ctx.replyWithMarkdown(
        `💰 *Your Balance*\n\n` +
        `Credits: *${balance}*\n` +
        `Enough for: *~${videos} videos*\n\n` +
        `Need more?`,
        Markup.inlineKeyboard([
            [Markup.button.callback('🎁 Claim Daily Free Credits', 'claim_daily')],
            [Markup.button.callback('💳 Buy Credits', 'buy_points_menu')]
        ])
    );
});

// ─── END MISSING ACTION HANDLERS ────────────────────────────────────────────

// Graceful Stop
let stopped = false;
async function safeStop(signal) {
    if (stopped) return;
    stopped = true;
    console.log(`[Shutdown] safeStop called (${signal})`);
    try {
        if (bot && typeof bot.stop === 'function') {
            await bot.stop(signal);
            console.log('[Shutdown] Bot stopped successfully.');
        } else {
            console.log('[Shutdown] Bot instance not active or already stopped.');
        }
    } catch (err) {
        if (err.message && err.message.includes('Bot is not running')) {
            console.warn('[Shutdown] Bot was already not running.');
        } else {
            console.error('[Shutdown] safeStop encountered an error:', err.message);
        }
    }
}

process.once('SIGINT', () => safeStop('SIGINT'));
process.once('SIGTERM', () => safeStop('SIGTERM'));

module.exports = { bot };
