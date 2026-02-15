const { Telegraf, Markup, session } = require('telegraf');
const path = require('path');
const os = require('os');
const { getUser, updateUserPoints, createJob, addTransaction, updateJobStatus, db, trackEvent, setUserLanguage, getUserLanguage } = require('./database');
const { spendCredits, getCredits, claimDailyCredits, isFirstPurchase, getTotalVideosCreated, grantWelcomeCredits } = require('./services/creditsService');
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
const BUILD_ID = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || null;

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const UPLOADS_DIR = path.join(os.tmpdir(), 'telegram_uploads');
const fs = require('fs');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Middleware
bot.use(session({
    property: 'session',
    getSessionKey: (ctx) => ctx.from && ctx.chat && `${ctx.from.id}:${ctx.chat.id}`
}));
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});
bot.use(async (ctx, next) => {
    try {
        const t = ctx.updateType;
        const uid = ctx.from && ctx.from.id;
        logger.info('update', { type: t, user: uid });
    } catch (_) { }
    return next();
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
            updateUserPoints(job.user_id, refund);
            addTransaction(job.user_id, refund, 'refund_failed_job');
            await bot.telegram.sendMessage(job.chat_id, `💰 ${refund} points have been refunded.`);
        }
    } catch (e) {
        logger.error('Failed to send failure notification:', e);
    }
});

bot.command('upload_template', async (ctx) => {
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
    const payload = ctx.message?.text?.split(' ')[1];

    if (payload) {
        logger.info('Deep link triggered', { userId, payload });
        switch (payload) {
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
                const stripeCustomer = db.prepare('SELECT stripe_customer_id FROM user_credits WHERE telegram_user_id = ? AND stripe_customer_id IS NOT NULL').get(userId);
                const hasWelcomeCredits = db.prepare('SELECT 1 FROM user_credits WHERE telegram_user_id = ? AND welcome_granted = 1').get(userId);
                if (!hasWelcomeCredits) {
                    logger.info('User eligible for 69 free credits', { userId });
                    // Ensure user_credits record exists
                    const existing = db.prepare('SELECT 1 FROM user_credits WHERE telegram_user_id = ?').get(userId);
                    if (!existing) {
                        db.prepare('INSERT INTO user_credits (telegram_user_id, credits, welcome_granted, created_at, updated_at) VALUES (?, 69, 1, ?, ?)').run(userId, Date.now(), Date.now());
                    } else {
                        db.prepare('UPDATE user_credits SET credits = credits + 69, welcome_granted = 1, updated_at = ? WHERE telegram_user_id = ?').run(Date.now(), userId);
                    }
                    // Also update points in users table for consistency
                    db.prepare('UPDATE users SET points = points + 69 WHERE id = ?').run(userId);
                    
                    logger.info('69 free credits granted', { userId });
                    const credits = db.prepare('SELECT SUM(credits) as total FROM user_credits WHERE telegram_user_id = ?').get(userId).total;
                    return ctx.replyWithMarkdown(
                        `🎉 *69 Free Credits Granted!*`\n\n` +
                        `💰 *New Balance:* ${credits} credits\n` +
                        `🎬 Enough for ~${Math.floor(credits / 60)} face swap videos!\n\n` +
                        `Use /start create to begin`
                    );
                } else if (hasWelcomeCredits) {
                    return ctx.replyWithMarkdown(
                        `🎁 *Offer Already Claimed*\n\n` +
                        `You've already received your 69 free welcome credits!\n` +
                        `Check your balance with /credits`
                    );
                } else {
                    return ctx.replyWithMarkdown(
                        `🎁 *Eligibility Required*\n\n` +
                        `The 69 free credits offer is for new Stripe subscribers only.\n` +
                        `[Connect your Stripe account](${process.env.STRIPE_CONNECT_URL || 'https://stripe.com/connect'}) to qualify`
                    );
                }
            case 'buy_points':
                return sendBuyPointsMenu(ctx);
            case 'create':
                return ctx.replyWithMarkdown(
                    '🎬 *Create Video*\n\nChoose video duration:',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('5 Second Video', 'create_5s')],
                        [Markup.button.callback('10 Second Video', 'create_10s')],
                        [Markup.button.callback('20 Second Video', 'create_20s')],
                        [Markup.button.callback('✨ Go to Studio for More Options', 'open_studio')]
                    ])
                );
        }
    }

    // Initialize session if it doesn't exist
    if (!ctx.session) ctx.session = {};

    const hasTemplates = db.prepare(
        'SELECT 1 FROM user_templates WHERE user_id = ? LIMIT 1'
    ).get(userId);

    if (!hasTemplates) {
        await ctx.replyWithMarkdown(
            '👋 *Welcome!*\n\n' +
            'To use this bot, you *must* upload your own templates:\n\n' +
            '1. Video template (MP4, max 15MB)\n' +
            '2. Photo template (JPEG/PNG, max 10MB)\n\n' +
            'Start with /upload_template or tap below:',
            Markup.inlineKeyboard([
                [Markup.button.callback('📤 Upload Templates', 'upload_template')],
                [Markup.button.callback('ℹ️ Learn More', 'template_help')]
            ])
        );
        return;
    }

    await ctx.replyWithMarkdown(
        '🎭 *Face Swap Bot*\n\n' +
        'You have templates uploaded!\n\n' +
        'Options:',
        Markup.inlineKeyboard([
            [Markup.button.callback('🎬 Create Video', 'demo_new')],
            [Markup.button.callback('🔄 Update Templates', 'upload_template')],
            [Markup.button.callback('📂 View Templates', 'view_templates')]
        ])
    );
});

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
            const u = getUser(userId);
            if (u.points < price) {
                return ctx.reply(`❌ Not enough points. You need ${price}, but have ${u.points}.`);
            }
            updateUserPoints(userId, -price);
            addTransaction(userId, -price, 'demo_start');
            await ctx.reply('Processing your demo… this usually takes up to 120 seconds.');
            try {
                const requestId = await startFaceSwap(faceUrl, baseUrl);
                const code = `DEMO-USER`;
                createJob(requestId, userId, String(ctx.chat.id), 'demo', { service: 'faceswap', price_points: price, code });
            } catch (e) {
                updateUserPoints(userId, price);
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
        '🆘 *Help Center*\n\n' +
        '*How to use:*\n' +
        '1. /upload_template - Add your video and photo\n' +
        '2. Send /create to make videos\n\n' +
        '*Requirements:*\n' +
        '- Your own high-quality templates\n' +
        '- Video: MP4, max 15MB\n' +
        '- Photo: JPEG/PNG, max 10MB'
    );
});

async function sendDemoMenuWithBuyButtons(ctx) {
    const userId = ctx.from ? String(ctx.from.id) : String(ctx.chat.id);
    const user = getUser(userId);
    const credits = getCredits({ telegramUserId: userId });
    const totalVideos = getTotalVideosCreated();
    const lang = getUserLanguage(userId);
    const p = demoCfg.packs;

    if (ctx.session) ctx.session.step = null;

    const msg = `${t(lang, 'title')}
${t(lang, 'subtitle')}

${t(lang, 'videosCreated', { count: totalVideos.toLocaleString() })}

${t(lang, 'creditPacksTitle')}

${t(lang, 'tryIt')}
${t(lang, 'starter')}
${t(lang, 'plus')}
${t(lang, 'pro')}

${t(lang, 'freeCreditsTitle')}

${t(lang, 'welcomeCredits')}
${t(lang, 'dailyCredits')}

${t(lang, 'videoPricingTitle')}

${t(lang, 'videoPricing')}

${t(lang, 'yourBalance', { credits: credits > 0 ? credits : user.points })}`;

    let buttons = [
        [Markup.button.callback('🌐 English / Español', 'change_language')],
        [Markup.button.callback(t(lang, 'btnGetFreeCredits'), 'get_free_credits')],
        [Markup.button.callback(t(lang, 'btnBuyMicro'), 'buy_pack_micro')],
        [Markup.button.callback(t(lang, 'btnBuyStarter'), 'buy_pack_starter')],
        [Markup.button.callback(t(lang, 'btnBuyPlus'), 'buy_pack_plus')],
        [Markup.button.callback(t(lang, 'btnCreateVideo'), 'demo_new')],
        [Markup.button.callback(t(lang, 'btnClaimDaily'), 'claim_daily')]
    ];

    await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));

    setTimeout(async () => {
        try {
            const promoText = `
🎨✨ *AI FACE-SWAP STUDIO* ✨🎨

🔥 *ALL YOUR AI TOOLS IN ONE APP* 🔥

━━━━━━━━━━━━━━━━━━━━━━
🎭 Face Swap Videos
🗣️ Talking Avatars  
📸 Image to Video
✨ 4K Enhancement
🖼️ Background Removal
━━━━━━━━━━━━━━━━━━━━━━

⚡ *FAST • EASY • PROFESSIONAL* ⚡

👇 *TAP TO OPEN FULL STUDIO* 👇`;

            const studioUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp` : 'https://telegramalam.onrender.com/miniapp/';
            await ctx.replyWithMarkdown(promoText,
                Markup.inlineKeyboard([
                    [Markup.button.webApp('🚀 OPEN FULL STUDIO APP 🚀', studioUrl)]
                ])
            );
        } catch (e) {
            logger.error('Failed to send studio promo', { error: e.message });
        }
    }, 1500);
}

async function sendBuyPointsMenu(ctx) {
    const userId = String(ctx.from.id);
    const firstPurchase = isFirstPurchase({ telegramUserId: userId });
    const p = demoCfg.packs;
    const approx5s = (pts) => Math.max(1, Math.floor(pts / demoCfg.demoPrices['5']));

    const rate = await fetchUsdRate('mxn');
    const microMxn = ((p.micro.price_cents / 100) * rate).toFixed(2);
    const starterMxn = ((p.starter.price_cents / 100) * rate).toFixed(2);
    const plusMxn = ((p.plus.price_cents / 100) * rate).toFixed(2);
    const proMxn = ((p.pro.price_cents / 100) * rate).toFixed(2);

    let header = '💳 *Elige tu paquete de créditos:*\n\n';
    if (firstPurchase) {
        header = `🎁 *¡OFERTA ESPECIAL!*\n\nComienza con solo MX$${microMxn}:\n\n`;
    }

    const text = `${header}` +
        `🎯 *Try It* - ${p.micro.points} credits (~${approx5s(p.micro.points)} videos)\n   └ *MX$${microMxn}*\n\n` +
        `⭐ *Starter* - ${p.starter.points} credits (~${approx5s(p.starter.points)} videos)\n   └ *MX$${starterMxn}*\n\n` +
        `🔥 *Plus* - ${p.plus.points} credits (~${approx5s(p.plus.points)} videos)\n   └ *MX$${plusMxn}* (¡Mejor valor!)\n\n` +
        `💎 *Pro* - ${p.pro.points} credits (~${approx5s(p.pro.points)} videos)\n   └ *MX$${proMxn}*`;

    return ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
        [Markup.button.callback(`🎯 MX$${microMxn} - ${p.micro.points} credits`, 'buy_pack_micro')],
        [Markup.button.callback(`⭐ MX$${starterMxn} - ${p.starter.points} credits`, 'buy_pack_starter')],
        [Markup.button.callback(`🔥 MX$${plusMxn} - ${p.plus.points} credits`, 'buy_pack_plus')],
        [Markup.button.callback(`💎 MX$${proMxn} - ${p.pro.points} credits`, 'buy_pack_pro')],
    ]));
}

bot.command('daily', async (ctx) => {
    const userId = String(ctx.from.id);
    const result = claimDailyCredits({ telegramUserId: userId });

    if (result.granted) {
        let msg = `🎁 *Daily Credits Claimed!*\n\n+${result.amount} credits added`;
        if (result.streak > 1) {
            msg += `\n🔥 *${result.streak}-day streak!* (+${result.streakBonus || 0} bonus)`;
        }
        msg += `\n\n_Come back tomorrow for more!_`;
        await ctx.replyWithMarkdown(msg);
    } else {
        const hours = result.hoursLeft || 24;
        await ctx.reply(`⏰ Already claimed today!\n\nCome back in ${hours} hours.\n🔥 Streak: ${result.streak || 0} days`);
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
    const adminIds = (process.env.ADMIN_IDS || '1087968824,8063916626').split(',').map(s => s.trim());
    const userId = String(ctx.from.id);

    if (!adminIds.includes(userId)) {
        return ctx.reply('❌ Admin only command.');
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
    const adminIds = (process.env.ADMIN_IDS || '1087968824,8063916626').split(',').map(s => s.trim());
    const userId = String(ctx.from.id);

    if (!adminIds.includes(userId)) {
        return ctx.reply('❌ Admin only command.');
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
    const adminIds = (process.env.ADMIN_IDS || '1087968824,8063916626').split(',').map(s => s.trim());
    const userId = String(ctx.from.id);

    if (!adminIds.includes(userId)) {
        return ctx.reply('❌ Admin only command.');
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
    const adminIds = (process.env.ADMIN_IDS || '1087968824,8063916626').split(',').map(s => s.trim());
    const userId = String(ctx.from.id);

    if (!adminIds.includes(userId)) {
        return ctx.reply('❌ Admin only command.');
    }

    const message = ctx.message.text.replace('/broadcast', '').trim();
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

        const template = db.prepare(
            'SELECT template_video_url, template_photo_url FROM user_templates WHERE user_id = ? ORDER BY last_used DESC LIMIT 1'
        ).get(userId);

        if (!template) {
            return ctx.replyWithMarkdown(
                '❌ You need to upload templates first!\n\nUse /upload_template to upload your video and photo templates.',
                Markup.inlineKeyboard([
                    [Markup.button.callback('📤 Upload Templates', 'upload_template')]
                ])
            );
        }

        ctx.session = {
            mode: 'demo',
            step: 'awaiting_base_video',
            duration: 5,
            price: 60
        };
        await ctx.reply(`📹 Send your own 5-second video.\n\n⚠️ Make sure it's already trimmed to 5 seconds!`);
    } catch (e) {
        logger.error('demo_new action failed', { error: e.message, userId: ctx.from.id });
    }
});

bot.action('demo_len_10', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        ctx.session = {
            mode: 'demo',
            step: 'awaiting_base_video',
            duration: 10,
            price: 90
        };
        await ctx.reply(`📹 Send your own 10-second video.\n\n⚠️ Make sure it's already trimmed to 10 seconds!`);
    } catch (e) {
        logger.error('demo_len_10 action failed', { error: e.message });
    }
});

bot.action('demo_len_15', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        ctx.session = {
            mode: 'demo',
            step: 'awaiting_base_video',
            duration: 15,
            price: 125
        };
        await ctx.reply(`📹 Send your own 15-second video.\n\n⚠️ Make sure it's already trimmed to 15 seconds!`);
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
            '❌ No templates found. Use /upload_template to upload your first template pair.'
        );
    }

    const templateList = templates.map((t, i) => {
        return `${i + 1}. Video: ${Math.round(t.video_size / 1024 / 1024)}MB, ${t.video_duration}s | Photo: ${Math.round(t.photo_size / 1024)}KB`;
    }).join('\n');

    await ctx.replyWithMarkdown(
        `📂 *Your Templates*\n\n${templateList}\n\nUse /delete_template [number] to remove a template.`
    );
});

bot.command('delete_template', async (ctx) => {
    const userId = String(ctx.from.id);
    const templateNumber = Number(ctx.message.text.split(' ')[1]);

    if (isNaN(templateNumber) || templateNumber < 1) {
        return ctx.reply('Please specify a valid template number. Use /view_templates to see your templates.');
    }

    const templates = db.prepare(
        'SELECT id FROM user_templates WHERE user_id = ? ORDER BY last_used DESC'
    ).all(userId);

    if (!templates || templateNumber > templates.length) {
        return ctx.reply('Invalid template number. Use /view_templates to see your templates.');
    }

    const templateId = templates[templateNumber - 1].id;
    db.prepare('DELETE FROM user_templates WHERE id = ?').run(templateId);

    await ctx.reply(`✅ Template #${templateNumber} deleted successfully.`);
});

bot.action('create_5s', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);

        if (!checkUserHasTemplates(userId)) {
            const { text, markup } = getTemplateMissingMessage();
            return ctx.replyWithMarkdown(text, markup);
        }

        ctx.session = {
            mode: 'create_video',
            step: 'awaiting_base_video',
            duration: 5,
            price: 60
        };
        await ctx.reply(`📹 Please send a 5-second video to face swap:`);
    } catch (e) {
        logger.error('create_5s action failed', { error: e.message });
    }
});

bot.action('create_10s', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);

        if (!checkUserHasTemplates(userId)) {
            const { text, markup } = getTemplateMissingMessage();
            return ctx.replyWithMarkdown(text, markup);
        }

        ctx.session = {
            mode: 'create_video',
            step: 'awaiting_base_video',
            duration: 10,
            price: 90
        };
        await ctx.reply(`📹 Please send a 10-second video to face swap:`);
    } catch (e) {
        logger.error('create_10s action failed', { error: e.message });
    }
});

bot.action('create_20s', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);

        if (!checkUserHasTemplates(userId)) {
            const { text, markup } = getTemplateMissingMessage();
            return ctx.replyWithMarkdown(text, markup);
        }

        ctx.session = {
            mode: 'create_video',
            step: 'awaiting_base_video',
            duration: 20,
            price: 120
        };
        await ctx.reply(`📹 Please send a 20-second video to face swap:`);
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
            return ctx.reply('❌ Templates not found. Please upload templates first.');
        }

        await ctx.reply('⏳ Creating your video... This may take a few minutes.');

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
        ctx.reply('❌ Failed to create video. Please try again later.');
    }
}

// Poll task status until completion
async function pollTaskStatus(ctx, taskId) {
    try {
        const status = await checkImage2VideoStatus(taskId);

        if (status.status === 'completed') {
            await ctx.replyWithVideo(status.result_url);
            db.prepare(
                'UPDATE user_tasks SET status = ?, completed_at = ? WHERE task_id = ?'
            ).run('completed', Date.now(), taskId);
        } else if (status.status === 'failed') {
            await ctx.reply(`❌ Video creation failed: ${status.error || 'Unknown error'}`);
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
        const pack = demoCfg.packs[packType];
        if (!pack) throw new Error('Invalid pack type');

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency,
                    product_data: { name: `${pack.label} - ${pack.points} credits` },
                    unit_amount: pack.price_cents
                },
                quantity: 1
            }],
            success_url: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp?success=true` : 'https://telegramalam.onrender.com/miniapp/?success=true',
            cancel_url: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp?cancel=true` : 'https://telegramalam.onrender.com/miniapp/?cancel=true',
            client_reference_id: userId,
            metadata: {
                userId: String(userId), // Ensure userId is in metadata
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
        const session = await createStripeCheckoutSession({
            userId: String(ctx.from.id),
            packType: 'micro',
            currency: 'mxn' // Use MXN as requested
        });
        await ctx.reply('Redirecting to payment...', {
            reply_markup: {
                inline_keyboard: [[{ text: '💳 Pay Now', url: session.url }]]
            }
        });
    } catch (e) {
        logger.error('Micro pack checkout failed', { error: e.message });
        await ctx.reply('❌ Payment processing error. Please try again later.');
    }
});

bot.action('buy_pack_starter', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const session = await createStripeCheckoutSession({
            userId: String(ctx.from.id),
            packType: 'starter',
            currency: 'mxn' // Use MXN as requested
        });
        await ctx.reply('Redirecting to payment...', {
            reply_markup: {
                inline_keyboard: [[{ text: '💳 Pay Now', url: session.url }]]
            }
        });
    } catch (e) {
        logger.error('Starter pack checkout failed', { error: e.message });
        await ctx.reply('❌ Payment processing error. Please try again later.');
    }
});

bot.action('buy_pack_plus', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const session = await createStripeCheckoutSession({
            userId: String(ctx.from.id),
            packType: 'plus',
            currency: 'mxn' // Use MXN as requested
        });
        await ctx.reply('Redirecting to payment...', {
            reply_markup: {
                inline_keyboard: [[{ text: '💳 Pay Now', url: session.url }]]
            }
        });
    } catch (e) {
        logger.error('Plus pack checkout failed', { error: e.message });
        await ctx.reply('❌ Payment processing error. Please try again later.');
    }
});

bot.action('buy_pack_pro', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const session = await createStripeCheckoutSession({
            userId: String(ctx.from.id),
            packType: 'pro',
            currency: 'mxn' // Use MXN as requested
        });
        await ctx.reply('Redirecting to payment...', {
            reply_markup: {
                inline_keyboard: [[{ text: '💳 Pay Now', url: session.url }]]
            }
        });
    } catch (e) {
        logger.error('Pro pack checkout failed', { error: e.message });
        await ctx.reply('❌ Payment processing error. Please try again later.');
    }
});

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
