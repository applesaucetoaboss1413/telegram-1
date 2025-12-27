const { Telegraf, Markup, session } = require('telegraf');
const path = require('path');
const os = require('os');
const { getUser, updateUserPoints, createJob, addTransaction, updateJobStatus, db, trackEvent } = require('./database');
const { spendCredits, getCredits, claimDailyCredits, isFirstPurchase, getTotalVideosCreated } = require('./services/creditsService');
const { startFaceSwap, startFaceSwapPreview, startImage2Video } = require('./services/magicService');
const queueService = require('./services/queueService');
const { downloadTo, downloadBuffer, cleanupFile } = require('./utils/fileUtils');
const { detectFaces } = require('./services/faceService');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const winston = require('winston');
const { uploadFromUrl } = require('./services/cloudinaryService');
const runImage2VideoFlow = require('../dist/ts/image2videoHandler.js').runImage2VideoFlow;
const demoCfg = require('./services/a2eConfig');
const BUILD_ID = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || null;

const bot = new Telegraf(process.env.BOT_TOKEN);
const UPLOADS_DIR = path.join(os.tmpdir(), 'telegram_uploads');
const fs = require('fs');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Middleware
bot.use(session());
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
    } catch (_) {}
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
    // MagicAPI requires valid extension. If Telegram URL lacks it (rare), or has query params, ensure it's clean.
    // Usually Telegram URLs are like: https://api.telegram.org/file/bot<token>/.../file.jpg
    // We can append a dummy query param if needed, but it's better to trust Telegram unless proven otherwise.
    // However, we can check if it ends with a known image extension.
    return url;
};

const validatePhoto = async (ctx, fileId, fileSize) => {
    // 1. Check Size (10MB = 10 * 1024 * 1024 bytes)
    if (fileSize > 10 * 1024 * 1024) {
        throw new Error('Image too large. Maximum size is 10MB.');
    }

    // 2. Download buffer for validation
    const url = await getFileLink(ctx, fileId);
    let buffer;
    try {
        buffer = await downloadBuffer(url);
    } catch (e) {
        throw new Error('Failed to download image for validation.');
    }

    // 3. Face Detection
    try {
        const faces = await detectFaces(buffer);
        if (faces.length === 0) {
            throw new Error('No human face detected. Please ensure the face is clearly visible (90% confidence).');
        }
    } catch (e) {
        logger.error('Face detection internal error:', e);
        // If detection fails technically, maybe allow it but warn? Or fail safe?
        // User requested "Implement proper photo reception...".
        // Let's fail if we can't detect faces, as that's the point of the bot.
        throw new Error('Could not verify face in image. Please try another photo.');
    }

    // 4. Ensure URL has extension for MagicAPI
    // If url doesn't end with .jpg/.png/.jpeg, we might need to rely on the fact that Telegram sends Content-Type.
    // But MagicAPI validates the URL string itself.
    // If it's missing, we can append a dummy one if the URL allows it, or just pass it.
    // Telegram file links usually have extensions. If not, we might be in trouble.
    // Let's check:
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
       // Warn or try to fix? Telegram usually provides extensions.
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

bot.on('photo', async (ctx) => {
    if (!ctx.session || !ctx.session.step) return;
    const userId = String(ctx.from.id);
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    const fileSize = photo.file_size;
    if (ctx.session && ctx.session.mode === 'demo' && ctx.session.step === 'awaiting_face') {
        try {
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
                const code = `DEMO-${String(ctx.session.duration).padStart(2, '0')}-${ctx.session.base_url === demoCfg.templates[String(ctx.session.duration)] ? 'TEMPLATE' : 'USER'}`;
                createJob(requestId, userId, String(ctx.chat.id), 'demo', { service: 'faceswap', price_points: price, duration_seconds: ctx.session.duration, code });
            } catch (e) {
                updateUserPoints(userId, price);
                addTransaction(userId, price, 'refund_api_error');
                ctx.reply(`❌ Error starting demo: ${e.message}. Points refunded.`);
            }
            ctx.session = null;
        } catch (e) {
            ctx.reply(`❌ ${e.message}`);
        }
    }
});

// Bot Logic
/**
 * Sends the main demo menu and introduction to the user.
 * Works for both private chats and channel posts.
 * Note: Bot must be channel admin with 'Can post messages' permission to reply in channels.
 */
async function sendDemoMenu(ctx) {
    const userId = ctx.from ? String(ctx.from.id) : String(ctx.chat.id);
    const user = getUser(userId);
    const credits = getCredits({ telegramUserId: userId });
    const totalVideos = getTotalVideosCreated();
    
    if (ctx.session) ctx.session.step = null;

    if (ctx.chat && (ctx.chat.type === 'private' || ctx.chat.type === 'channel' || ctx.chat.type === 'supergroup')) {
        const p = demoCfg.packs;
        const msg = `🎭 *AI Face Swap Bot*
_Swap your face into any video in seconds!_

📊 *${totalVideos.toLocaleString()}+ videos created*

*💰 Credit Packs:*
🎯 Try It – ${p.micro.points} pts (~1 video) – *$0.99*
⭐ Starter – ${p.starter.points} pts (~${p.starter.approx5sDemos} videos) – $4.99
🔥 Plus – ${p.plus.points} pts (~${p.plus.approx5sDemos} videos) – $8.99
💎 Pro – ${p.pro.points} pts (~${p.pro.approx5sDemos} videos) – $14.99

*How it works:*
1️⃣ Get credits (free welcome bonus available!)
2️⃣ Choose video length (5s, 10s, or 15s)
3️⃣ Send video + face photo
4️⃣ Get your AI face-swapped video!`;
        await ctx.replyWithMarkdown(msg);

        // Automatically send template examples
        const t5 = demoCfg.templates['5'];
        const t10 = demoCfg.templates['10'];
        const t15 = demoCfg.templates['15'];

        const c5 = demoCfg.demoCosts['5'];
        const c10 = demoCfg.demoCosts['10'];
        const c15 = demoCfg.demoCosts['15'];

        const cap5 = `5s demo – Fastest preview. Costs ${c5.points} pts (~$${c5.usd}). Good for quick tests.`;
        const cap10 = `10s demo – Standard length. Costs ${c10.points} pts (~$${c10.usd}). Best balance.`;
        const cap15 = `15s demo – Maximum detail. Costs ${c15.points} pts (~$${c15.usd}). For pro results.`;

        if (t5) { try { await bot.telegram.sendVideo(ctx.chat.id, t5, { caption: cap5 }); } catch (_) { } }
        if (t10) { try { await bot.telegram.sendVideo(ctx.chat.id, t10, { caption: cap10 }); } catch (_) { } }
        if (t15) { try { await bot.telegram.sendVideo(ctx.chat.id, t15, { caption: cap15 }); } catch (_) { } }
    }
    
    const approx5s = Math.floor(user.points / demoCfg.demoPrices['5']);
    
    // Credit messaging - OPTIMIZED FOR CONVERSIONS
    let creditMsg = '';
    let buttons = [
        [Markup.button.callback('🎬 Create Video', 'demo_new')],
        [Markup.button.callback('🎁 Daily Free Credits', 'claim_daily')],
        [Markup.button.callback('💳 Buy Credits', 'buy_points_menu')],
        [Markup.button.callback('❓ Help', 'help')]
    ];

    if (credits > 0) {
        creditMsg = `\n\n💰 *Credits:* You have ${credits} credits. A 5-second video costs 60 credits. New users get 69 welcome credits, so your first video is covered and you’ll have some left over.`;
    } else {
        creditMsg = `\n\n🎁 *Welcome Offer:* New users get 69 free credits when they connect Stripe (enough for your first 5-second video).`;
        // Telegram deep link for 69 credits offer
        buttons.unshift([Markup.button.url('🎁 Get 69 Free Credits', 'https://t.me/ImMoreThanJustSomeBot?start=get_credits')]);
    }

    await ctx.replyWithMarkdown(
        `👋 Welcome! You have ${user.points} points (~${approx10s} 10s demos).${creditMsg}`,
        Markup.inlineKeyboard(buttons)
    );
}

bot.command('start', async (ctx) => {
    const payload = ctx.startPayload;
    const userId = String(ctx.from.id);
    
    if (payload === 'get_69_credits') {
        const credits = getCredits({ telegramUserId: userId });
        const userCreditsRecord = db.prepare('SELECT * FROM user_credits WHERE telegram_user_id = ?').get(userId);
        
        if (userCreditsRecord && userCreditsRecord.stripe_customer_id) {
            // Already Stripe-linked, try to grant welcome credits if not already done
            const granted = grantWelcomeCredits({ 
                telegramUserId: userId, 
                stripeCustomerId: userCreditsRecord.stripe_customer_id 
            });
            
            if (granted) {
                await ctx.replyWithMarkdown(`🎉 *Success!* You've been granted 69 welcome credits (enough for your first 5-second video).`);
            } else if (credits > 0) {
                await ctx.replyWithMarkdown(`💰 You already have ${credits} credits. Start creating your first demo!`);
            } else {
                await ctx.replyWithMarkdown(`👋 Welcome back! You've already used your welcome credits.`);
            }
        } else {
            // Not Stripe-linked
            await ctx.replyWithMarkdown(
                `🎁 *Claim Your 69 Free Credits*\n\nConnect Stripe to claim your 69 free credits (enough for your first 5-second video).`,
                Markup.inlineKeyboard([
                    // Telegram deep link for 69 credits offer
                    [Markup.button.url('🎁 Connect Stripe (69 free credits)', 'https://t.me/ImMoreThanJustSomeBot?start=get_credits')]
                ])
            );
            return; // Don't show regular menu yet to keep focus on the offer
        }
    }

    if (payload === 'buy_points') {
        return sendBuyPointsMenu(ctx);
    }
    
    await sendDemoMenu(ctx);
});

async function sendBuyPointsMenu(ctx) {
    const userId = String(ctx.from.id);
    const firstPurchase = isFirstPurchase({ telegramUserId: userId });
    const p = demoCfg.packs;
    const approx5s = (pts) => Math.max(1, Math.floor(pts / demoCfg.demoPrices['5']));
    
    let header = '💳 *Choose a credit pack:*\n\n';
    if (firstPurchase) {
        header = '🎁 *FIRST-TIME BUYER SPECIAL!*\n\nStart with just $0.99:\n\n';
    }
    
    const text = `${header}` +
        `🎯 *Try It* - ${p.micro.points} credits (~${approx5s(p.micro.points)} videos)\n   └ *$${(p.micro.price_cents/100).toFixed(2)}*\n\n` +
        `⭐ *Starter* - ${p.starter.points} credits (~${approx5s(p.starter.points)} videos)\n   └ *$${(p.starter.price_cents/100).toFixed(2)}*\n\n` +
        `🔥 *Plus* - ${p.plus.points} credits (~${approx5s(p.plus.points)} videos)\n   └ *$${(p.plus.price_cents/100).toFixed(2)}* (Best Value!)\n\n` +
        `💎 *Pro* - ${p.pro.points} credits (~${approx5s(p.pro.points)} videos)\n   └ *$${(p.pro.price_cents/100).toFixed(2)}*`;
    
    return ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
        [Markup.button.callback(`🎯 $0.99 - ${p.micro.points} credits`, 'buy_pack_micro')],
        [Markup.button.callback(`⭐ $4.99 - ${p.starter.points} credits`, 'buy_pack_starter')],
        [Markup.button.callback(`🔥 $8.99 - ${p.plus.points} credits`, 'buy_pack_plus')],
        [Markup.button.callback(`💎 $14.99 - ${p.pro.points} credits`, 'buy_pack_pro')],
    ]));
}

// Daily credits command
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



bot.command('promo', async (ctx) => {
    try {
        const { postPromoBatch } = require('./services/promoScheduler');
        await postPromoBatch(bot);
        await ctx.reply('✅ Batch promo post manually triggered.');
    } catch (e) {
        logger.error('Manual promo trigger failed', { error: e.message });
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

let cachedBotUsername = null;
async function getBotUsername() {
    if (cachedBotUsername) return cachedBotUsername;
    const me = await bot.telegram.getMe();
    cachedBotUsername = me && me.username ? me.username : null;
    return cachedBotUsername;
}

/**
 * Dual handling approach for /start command:
 * 1. DM handler (bot.command('start')): Standard entry point for private chats.
 * 2. Channel handler (bot.on('channel_post')): Allows the bot to respond to /start in the promo channel.
 * 
 * Bot Permissions Required for Channel Handling:
 * - Must be an Administrator in @FaceSwapVideoAi.
 * - Must have 'Can post messages' permission.
 * - 'Can edit messages' is recommended for pinning.
 * 
 * Deep Link Format: https://t.me/<YourBotUsername>?start=promo
 */
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



bot.action('buy_points', async (ctx) => {
    ctx.answerCbQuery();
    ctx.reply(
        'Choose a credit pack:',
        Markup.inlineKeyboard([
            [Markup.button.callback(`${demoCfg.packs.starter.label} – ${demoCfg.packs.starter.points} pts`, 'buy_pack_starter')],
            [Markup.button.callback(`${demoCfg.packs.plus.label} – ${demoCfg.packs.plus.points} pts`, 'buy_pack_plus')],
            [Markup.button.callback(`${demoCfg.packs.pro.label} – ${demoCfg.packs.pro.points} pts`, 'buy_pack_pro')],
        ])
    );
});

bot.action('buy_points_menu', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const p10 = demoCfg.demoPrices['10'];
        const approx = (pts) => Math.max(1, Math.floor(pts / p10));
        const s = demoCfg.packs.starter.points;
        const pl = demoCfg.packs.plus.points;
        const pr = demoCfg.packs.pro.points;
        const text = `Choose a credit pack:\nStarter – ${s} pts (~${approx(s)} demos)\nPlus – ${pl} pts (~${approx(pl)} demos)\nPro – ${pr} pts (~${approx(pr)} demos)`;
        await ctx.reply(text, Markup.inlineKeyboard([
            [Markup.button.callback(`${demoCfg.packs.starter.label} – ${s} pts`, 'buy_pack_starter')],
            [Markup.button.callback(`${demoCfg.packs.plus.label} – ${pl} pts`, 'buy_pack_plus')],
            [Markup.button.callback(`${demoCfg.packs.pro.label} – ${pr} pts`, 'buy_pack_pro')],
        ]));
    } catch (e) {
        logger.error('buy_points_menu action failed', { error: e.message });
    }
});

async function startCheckout(ctx, pack) {
    try {
        const username = await getBotUsername();
        const botUrl = username ? `https://t.me/${username}` : 'https://t.me/FaceSwapVideoAiBot';
        
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: pack.label },
                    unit_amount: pack.price_cents,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: process.env.STRIPE_SUCCESS_URL || `${botUrl}?start=success`,
            cancel_url: process.env.STRIPE_CANCEL_URL || `${botUrl}?start=cancel`,
            client_reference_id: String(ctx.from.id),
            metadata: {
                points: String(pack.points)
            }
        });
        await ctx.reply(
            `You selected *${pack.label}*.\n\nTap the button below to complete your payment.`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '💳 Proceed to payment', url: session.url }]],
                },
            }
        );
    } catch (e) {
        logger.error('startCheckout failed', { error: e.message, pack: pack.label, userId: ctx.from.id });
        ctx.reply('❌ Payment system error. Please try again later.');
    }
}

bot.action('buy_pack_micro', async (ctx) => {
    await ctx.answerCbQuery();
    await startCheckout(ctx, demoCfg.packs.micro);
});
bot.action('buy_pack_starter', async (ctx) => {
    await ctx.answerCbQuery();
    await startCheckout(ctx, demoCfg.packs.starter);
});
bot.action('buy_pack_plus', async (ctx) => {
    await ctx.answerCbQuery();
    await startCheckout(ctx, demoCfg.packs.plus);
});
bot.action('buy_pack_pro', async (ctx) => {
    await ctx.answerCbQuery();
    await startCheckout(ctx, demoCfg.packs.pro);
});

bot.action('help', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.reply('Create short demo videos. Buy points, choose length, select base video, send one clear face photo, and receive your demo. Keep uploads within the chosen time limit.');
    } catch (e) {
        logger.error('help action failed', { error: e.message });
    }
});

bot.action('demo_list', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.reply('No stored demos yet.');
    } catch (e) {
        logger.error('demo_list action failed', { error: e.message });
    }
});

bot.action('demo_new', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const uid = String(ctx.from.id);
        const u = getUser(uid);
        ctx.session = { mode: 'demo', step: 'choose_length' };
        await ctx.reply(
            'Choose demo length:',
            Markup.inlineKeyboard([
                [Markup.button.callback(`5 seconds – ${demoCfg.demoPrices['5']} points`, 'demo_len_5')],
                [Markup.button.callback(`10 seconds – ${demoCfg.demoPrices['10']} points`, 'demo_len_10')],
                [Markup.button.callback(`15 seconds – ${demoCfg.demoPrices['15']} points`, 'demo_len_15')],
            ])
        );
    } catch (e) {
        logger.error('demo_new action failed', { error: e.message, userId: ctx.from.id });
    }
});

bot.action('demo_len_5', async (ctx) => { 
    try {
        await ctx.answerCbQuery(); 
        ctx.session = { mode: 'demo', step: 'choose_base', duration: 5, price: demoCfg.demoPrices['5'] }; 
        await ctx.reply('Choose base video:', Markup.inlineKeyboard([[Markup.button.callback('Use example demo', 'demo_base_template')],[Markup.button.callback('Use my own video', 'demo_base_user')]])); 
    } catch (e) {
        logger.error('demo_len_5 action failed', { error: e.message });
    }
});
bot.action('demo_len_10', async (ctx) => { 
    try {
        await ctx.answerCbQuery(); 
        ctx.session = { mode: 'demo', step: 'choose_base', duration: 10, price: demoCfg.demoPrices['10'] }; 
        await ctx.reply('Choose base video:', Markup.inlineKeyboard([[Markup.button.callback('Use example demo', 'demo_base_template')],[Markup.button.callback('Use my own video', 'demo_base_user')]])); 
    } catch (e) {
        logger.error('demo_len_10 action failed', { error: e.message });
    }
});
bot.action('demo_len_15', async (ctx) => { 
    try {
        await ctx.answerCbQuery(); 
        ctx.session = { mode: 'demo', step: 'choose_base', duration: 15, price: demoCfg.demoPrices['15'] }; 
        await ctx.reply('Choose base video:', Markup.inlineKeyboard([[Markup.button.callback('Use example demo', 'demo_base_template')],[Markup.button.callback('Use my own video', 'demo_base_user')]])); 
    } catch (e) {
        logger.error('demo_len_15 action failed', { error: e.message });
    }
});

bot.action('demo_base_template', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const t5 = demoCfg.templates['5'];
        const t10 = demoCfg.templates['10'];
        const t15 = demoCfg.templates['15'];

        const c5 = demoCfg.demoCosts['5'];
        const c10 = demoCfg.demoCosts['10'];
        const c15 = demoCfg.demoCosts['15'];

        const cap5 = `5s demo – Fastest preview. Costs ${c5.points} pts (~$${c5.usd}). Good for quick tests.`;
        const cap10 = `10s demo – Standard length. Costs ${c10.points} pts (~$${c10.usd}). Best balance.`;
        const cap15 = `15s demo – Maximum detail. Costs ${c15.points} pts (~$${c15.usd}). For pro results.`;

        if (t5) { try { await bot.telegram.sendVideo(ctx.chat.id, t5, { caption: cap5 }); } catch (_) { await ctx.reply(`5s Demo: ${t5}\n${cap5}`); } }
        if (t10) { try { await bot.telegram.sendVideo(ctx.chat.id, t10, { caption: cap10 }); } catch (_) { await ctx.reply(`10s Demo: ${t10}\n${cap10}`); } }
        if (t15) { try { await bot.telegram.sendVideo(ctx.chat.id, t15, { caption: cap15 }); } catch (_) { await ctx.reply(`15s Demo: ${t15}\n${cap15}`); } }
        const kb = Markup.inlineKeyboard([
            [Markup.button.callback('Use 5s template demo', 'demo_tmpl_5')],
            [Markup.button.callback('Use 10s template demo', 'demo_tmpl_10')],
            [Markup.button.callback('Use 15s template demo', 'demo_tmpl_15')],
        ]);
        await ctx.reply('Pick a template to use:', kb);
    } catch (e) {
        logger.error('demo_base_template action failed', { error: e.message });
    }
});

bot.action('demo_base_user', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const d = ctx.session && ctx.session.duration;
        ctx.session.step = 'awaiting_base_video';
        await ctx.reply(`Send a video that is ${d} seconds or less.`);
    } catch (e) {
        logger.error('demo_base_user action failed', { error: e.message });
    }
});

bot.action('demo_tmpl_5', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const url = demoCfg.templates['5'];
        if (!url) return ctx.reply('Template not configured: DEMO_EXAMPLE_05_URL missing');
        
        ctx.session.mode = 'demo';
        ctx.session.duration = 5;
        ctx.session.price = demoCfg.demoPrices['5'];
        ctx.session.base_url = url;
        ctx.session.step = 'awaiting_face';
        
        logger.info('demo_tmpl_5_selected', { url });
        await ctx.reply('Now send one clear photo of the face you want to use.');
    } catch (e) {
        logger.error('demo_tmpl_5 action failed', { error: e.message });
    }
});
bot.action('demo_tmpl_10', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const url = demoCfg.templates['10'];
        if (!url) return ctx.reply('Template not configured: DEMO_EXAMPLE_10_URL missing');
        
        ctx.session.mode = 'demo';
        ctx.session.duration = 10;
        ctx.session.price = demoCfg.demoPrices['10'];
        ctx.session.base_url = url;
        ctx.session.step = 'awaiting_face';
        
        logger.info('demo_tmpl_10_selected', { url });
        await ctx.reply('Now send one clear photo of the face you want to use.');
    } catch (e) {
        logger.error('demo_tmpl_10 action failed', { error: e.message });
    }
});
bot.action('demo_tmpl_15', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const url = demoCfg.templates['15'];
        if (!url) return ctx.reply('Template not configured: DEMO_EXAMPLE_15_URL missing');
        
        ctx.session.mode = 'demo';
        ctx.session.duration = 15;
        ctx.session.price = demoCfg.demoPrices['15'];
        ctx.session.base_url = url;
        ctx.session.step = 'awaiting_face';
        
        logger.info('demo_tmpl_15_selected', { url });
        await ctx.reply('Now send one clear photo of the face you want to use.');
    } catch (e) {
        logger.error('demo_tmpl_15 action failed', { error: e.message });
    }
});
bot.action('mode_video', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        ctx.session = { mode: 'video', step: 'awaiting_swap_photo' };
        await ctx.reply('Step 1: Send the **Source Face** photo (the face you want to use).');
    } catch (e) {
        logger.error('mode_video action failed', { error: e.message });
    }
});

bot.action('mode_image', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        ctx.session = { mode: 'image', step: 'awaiting_swap_photo' };
        await ctx.reply('Step 1: Send the **Source Face** photo (the face you want to use).');
    } catch (e) {
        logger.error('mode_image action failed', { error: e.message });
    }
});

bot.action('mode_faceswap_preview', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        ctx.session = { mode: 'faceswap_preview', step: 'awaiting_swap_photo' };
        await ctx.reply('Step 1: Send the **Source Face** photo (the face you want to use).');
    } catch (e) {
        logger.error('mode_faceswap_preview action failed', { error: e.message });
    }
});

bot.action('mode_image2video', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        ctx.session = { mode: 'image2video', step: 'awaiting_photo' };
        await ctx.reply('Step 1: Send the image to animate.');
    } catch (e) {
        logger.error('mode_image2video action failed', { error: e.message });
    }
});

bot.on('photo', async (ctx) => {
    if (!ctx.session || ctx.session.step) return;

    const userId = String(ctx.from.id);
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    const fileSize = photo.file_size;
    try { logger.info('photo_meta', { user: userId, fileId, fileSize }); } catch (_) {}

    if (ctx.session.step === 'awaiting_swap_photo') {
        try {
            await ctx.reply('🔍 Verifying photo...');
            const { url } = await validatePhoto(ctx, fileId, fileSize);
            const uploaded = await uploadFromUrl(url, 'image');
            ctx.session.swapUrl = uploaded;
            ctx.session.step = 'awaiting_target';
            
            const type = ctx.session.mode === 'video' ? 'VIDEO' : 'PHOTO';
            ctx.reply(`✅ Source received. Now send the **Target ${type}** (the one to replace).`);
        } catch (e) {
            ctx.reply(`❌ ${e.message}`);
        }
        return;
    }

    if (ctx.session.step === 'awaiting_target' && ctx.session.mode === 'image') {
        try {
            await ctx.reply('🔍 Verifying target photo...');
            const { url } = await validatePhoto(ctx, fileId, fileSize);
            const uploaded = await uploadFromUrl(url, 'image');
            await handleSwapRequest(ctx, userId, ctx.session.swapUrl, uploaded, 'image');
            ctx.session = null;
        } catch (e) {
            ctx.reply(`❌ ${e.message}`);
        }
    }

    if (ctx.session.step === 'awaiting_photo' && ctx.session.mode === 'image2video') {
        try {
            await ctx.reply('🔍 Verifying image...');
            const { url } = await validatePhoto(ctx, fileId, fileSize);
            const uploaded = await uploadFromUrl(url, 'image');
            ctx.session.imageUrl = uploaded;
            ctx.session.step = 'awaiting_prompt';
            ctx.reply('✅ Image received. Now send the prompt to guide the video.');
        } catch (e) {
            ctx.reply(`❌ ${e.message}`);
        }
    }
});

bot.on('video', async (ctx) => {
    if (!ctx.session || !ctx.session.step) return;

    const userId = String(ctx.from.id);
    const fileId = ctx.message.video.file_id;

    if (ctx.session.step === 'awaiting_target' && ctx.session.mode === 'video') {
        const url = await getFileLink(ctx, fileId);
        const uploaded = await uploadFromUrl(url, 'video');
        await handleSwapRequest(ctx, userId, ctx.session.swapUrl, uploaded, 'video');
        ctx.session = null;
    }

    if (ctx.session.step === 'awaiting_target' && ctx.session.mode === 'faceswap_preview') {
        const url = await getFileLink(ctx, fileId);
        const uploaded = await uploadFromUrl(url, 'video');
        await handlePreviewRequest(ctx, userId, ctx.session.swapUrl, uploaded);
        ctx.session = null;
    }
    if (ctx.session.mode === 'demo' && ctx.session.step === 'awaiting_base_video') {
        const duration = ctx.message.video.duration || 0;
        const max = ctx.session.duration || 0;
        if (duration > max) {
            return ctx.reply(`This demo is limited to ${max} seconds. Please crop your video to ${max} seconds or less and send it again.`);
        }
        const url = await getFileLink(ctx, fileId);
        const uploaded = await uploadFromUrl(url, 'video');
        ctx.session.base_url = uploaded;
        ctx.session.step = 'awaiting_face';
        ctx.reply('Now send one clear photo of the face you want to use.');
    }
});

async function handleSwapRequest(ctx, userId, swapUrl, targetUrl, type) {
    const user = getUser(userId);
    
    // Check credits for video jobs
    if (type === 'video') {
        const credits = getCredits({ telegramUserId: userId });
        const creditCost = 60;

        if (credits < creditCost) {
            return ctx.reply(`❌ You are out of credits for video face-swaps. 

Each 5-second video costs ${creditCost} credits. Your current balance is ${credits} credits.

Please buy a credit pack to continue!`, 
            Markup.inlineKeyboard([
                // Telegram deep link for 69 credits offer
                [Markup.button.url('Buy Credits', 'https://t.me/ImMoreThanJustSomeBot?start=get_credits')]
            ]));
        }

        // Spend credits atomically
        const success = spendCredits({ telegramUserId: userId, amount: creditCost });
        if (!success) {
            return ctx.reply('❌ Transaction failed. Please try again or contact support.');
        }
    }

    const cost = type === 'video' ? 15 : 9;

    if (user.points < cost) {
        return ctx.reply(`❌ Not enough points. You need ${cost}, but have ${user.points}.`);
    }

    // Deduct points
    updateUserPoints(userId, -cost);
    addTransaction(userId, -cost, 'faceswap_start');

    await ctx.reply('⏳ Processing... We’re checking your video. This can take up to 120 seconds…');

    try {
        const requestId = await startFaceSwap(swapUrl, targetUrl);
        createJob(requestId, userId, String(ctx.chat.id), type);
        // Queue service will pick it up automatically next poll
    } catch (e) {
        // Refund on immediate error
        if (type === 'video') {
            // Refund credits for video jobs
            const tId = String(userId);
            const now = Date.now();
            db.prepare('UPDATE user_credits SET credits = credits + 60, updated_at = ? WHERE telegram_user_id = ?').run(now, tId);
            logger.info('Credits refunded due to error', { telegramUserId: userId, amount: 60 });
        }
        updateUserPoints(userId, cost);
        addTransaction(userId, cost, 'refund_api_error');
        ctx.reply(`❌ Error starting job: ${e.message}. Points refunded.`);
    }
}

async function handlePreviewRequest(ctx, userId, swapUrl, targetUrl) {
    const user = getUser(userId);
    const cost = 9;
    if (user.points < cost) {
        return ctx.reply(`❌ Not enough points. You need ${cost}, but have ${user.points}.`);
    }
    updateUserPoints(userId, -cost);
    addTransaction(userId, -cost, 'faceswap_preview_start');
    await ctx.reply('⏳ Processing preview...');
    try {
        const requestId = await startFaceSwapPreview(swapUrl, targetUrl);
        createJob(requestId, userId, String(ctx.chat.id), 'preview', { service: 'faceswap_preview' });
    } catch (e) {
        updateUserPoints(userId, cost);
        addTransaction(userId, cost, 'refund_api_error');
        ctx.reply(`❌ Error starting preview: ${e.message}. Points refunded.`);
    }
}

bot.on('text', async (ctx) => {
    if (!ctx.session || ctx.session.mode !== 'image2video' || ctx.session.step !== 'awaiting_prompt') return;
    const userId = String(ctx.from.id);
    const prompt = ctx.message.text || '';
    const user = getUser(userId);
    const cost = 15;
    if (user.points < cost) {
        return ctx.reply(`❌ Not enough points. You need ${cost}, but have ${user.points}.`);
    }
    updateUserPoints(userId, -cost);
    addTransaction(userId, -cost, 'image2video_start');
    await ctx.reply('⏳ Processing... We’re checking your video. This can take up to 120 seconds…');
    try {
        const url = await runImage2VideoFlow(ctx.session.imageUrl, prompt, (m) => {
            try { if (m) ctx.reply(m); } catch (_) {}
        }, 120000);
        await ctx.reply('✅ Video Ready!');
        await ctx.reply(url);
        ctx.session = null;
    } catch (e) {
        updateUserPoints(userId, cost);
        addTransaction(userId, cost, 'refund_api_error');
        const msg = e.message && /unexpected.*provider/i.test(e.message)
            ? '❌ The video provider returned an unexpected error. Your request did not complete; please try again in a few minutes.'
            : `❌ ${e.message}. Points refunded.`;
        ctx.reply(msg);
        ctx.session = null;
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
        // Log as warning if it's already stopped, otherwise error
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
