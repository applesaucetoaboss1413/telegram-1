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

// Helpers
const getFileLink = async (ctx, fileId) => {
    const link = await ctx.telegram.getFileLink(fileId);
    return link.href;
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

// Listeners for Queue - WITH POST-VIDEO UPSELL
queueService.on('job_complete', async ({ job, output }) => {
    try {
        if (job.chat_id) {
            await bot.telegram.sendMessage(job.chat_id, '✅ Your video is ready!');
            if (job.type === 'video' || output.endsWith('.mp4')) {
                await bot.telegram.sendVideo(job.chat_id, output);
            } else {
                await bot.telegram.sendPhoto(job.chat_id, output);
            }
            
            // Track successful completion
            trackEvent(job.user_id, 'video_completed', { type: job.type });
            
            // POST-VIDEO UPSELL - This is key for conversions!
            const userId = job.user_id;
            const credits = getCredits({ telegramUserId: userId });
            const totalVideos = getTotalVideosCreated();
            
            setTimeout(async () => {
                try {
                    let upsellMsg;
                    if (credits < 60) {
                        // Low credits - strong upsell
                        const firstPurchase = isFirstPurchase({ telegramUserId: userId });
                        if (firstPurchase) {
                            upsellMsg = `🎉 *Love your video?*

You're almost out of credits (${credits} left).

🎁 *FIRST-TIME OFFER:* Get 80 credits for just *$0.99* - enough for another video!

Or grab a pack for more savings:
• Starter: 400 credits = ~6 videos for $4.99
• Plus: 800 credits = ~13 videos for $8.99 ⭐

📊 *${totalVideos.toLocaleString()}+ videos created by our community!*`;
                        } else {
                            upsellMsg = `⚡ *Need more credits?*

You have ${credits} credits left.

Quick top-up options:
• 80 credits ($0.99) = 1 more video
• 400 credits ($4.99) = ~6 videos
• 800 credits ($8.99) = ~13 videos`;
                        }
                        
                        await bot.telegram.sendMessage(job.chat_id, upsellMsg, {
                            parse_mode: 'Markdown',
                            reply_markup: Markup.inlineKeyboard([
                                [Markup.button.callback('🎯 $0.99 - Try Again', 'buy_pack_micro')],
                                [Markup.button.callback('⭐ $4.99 - Starter Pack', 'buy_pack_starter')],
                                [Markup.button.callback('🔥 $8.99 - Best Value', 'buy_pack_plus')]
                            ]).reply_markup
                        });
                    } else {
                        // Has credits - gentle reminder
                        await bot.telegram.sendMessage(job.chat_id, 
                            `💰 You have *${credits} credits* left (~${Math.floor(credits/60)} more videos)\n\n🎬 Ready to create another? Tap /start`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                } catch (e) {
                    logger.error('Upsell message failed', { error: e.message });
                }
            }, 3000); // 3 second delay after video
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

// Photo handler for demo mode
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
                return ctx.reply(`❌ Not enough points. You need ${price}, but have ${u.points}.\n\nTap the button below to get more:`, 
                    Markup.inlineKeyboard([
                        [Markup.button.callback('🎯 $0.99 - Quick Top-up', 'buy_pack_micro')],
                        [Markup.button.callback('⭐ $4.99 - Starter Pack', 'buy_pack_starter')]
                    ])
                );
            }
            
            updateUserPoints(userId, -price);
            addTransaction(userId, -price, 'demo_start');
            trackEvent(userId, 'demo_started', { duration: ctx.session.duration, price });

            await ctx.reply('⏳ Processing your video… this usually takes 60-120 seconds. Sit tight!');
            
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

// ============ MAIN MENU - OPTIMIZED FOR CONVERSIONS ============

async function sendDemoMenu(ctx) {
    const userId = ctx.from ? String(ctx.from.id) : String(ctx.chat.id);
    const user = getUser(userId);
    const credits = getCredits({ telegramUserId: userId });
    const totalVideos = getTotalVideosCreated();
    
    // Track menu view
    trackEvent(userId, 'menu_viewed', {});

    if (ctx.session) ctx.session.step = null;

    if (ctx.chat && (ctx.chat.type === 'private' || ctx.chat.type === 'channel' || ctx.chat.type === 'supergroup')) {
        const p = demoCfg.packs;
        const msg = `🎭 *AI Face Swap Bot*
_Swap your face into any video in seconds_

📊 *${totalVideos.toLocaleString()}+ videos created!*

*How it works:*
1️⃣ Get credits (free welcome bonus!)
2️⃣ Choose video length (5s, 10s, or 15s)
3️⃣ Send your video + face photo
4️⃣ Get your AI face-swapped video!

*Pricing:*
• 5 seconds – 60 credits (~$0.75)
• 10 seconds – 90 credits (~$1.12)  
• 15 seconds – 125 credits (~$1.56)`;
        await ctx.replyWithMarkdown(msg);

        // Send blurred template examples with action buttons
        const t5 = demoCfg.templates['5'];
        const t10 = demoCfg.templates['10'];
        const t15 = demoCfg.templates['15'];

        const c5 = demoCfg.demoCosts['5'];
        const c10 = demoCfg.demoCosts['10'];
        const c15 = demoCfg.demoCosts['15'];

        const blurUrl = (url) => {
            if (!url || !url.includes('cloudinary.com')) return url;
            return url.replace('/upload/', '/upload/e_blur:800/');
        };

        const cap5 = `5s Example – ${c5.points} credits`;
        const cap10 = `10s Example – ${c10.points} credits`;
        const cap15 = `15s Example – ${c15.points} credits`;

        const btn5 = Markup.inlineKeyboard([[Markup.button.callback('▶️ Create 5s Video', 'demo_len_5')]]);
        const btn10 = Markup.inlineKeyboard([[Markup.button.callback('▶️ Create 10s Video', 'demo_len_10')]]);
        const btn15 = Markup.inlineKeyboard([[Markup.button.callback('▶️ Create 15s Video', 'demo_len_15')]]);

        if (t5) { try { await bot.telegram.sendVideo(ctx.chat.id, blurUrl(t5), { caption: cap5, reply_markup: btn5.reply_markup }); } catch (_) { } }
        if (t10) { try { await bot.telegram.sendVideo(ctx.chat.id, blurUrl(t10), { caption: cap10, reply_markup: btn10.reply_markup }); } catch (_) { } }
        if (t15) { try { await bot.telegram.sendVideo(ctx.chat.id, blurUrl(t15), { caption: cap15, reply_markup: btn15.reply_markup }); } catch (_) { } }
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
        creditMsg = `\n\n💰 *Your Balance:* ${credits} credits (~${Math.floor(credits/60)} videos)`;
        if (credits < 60) {
            creditMsg += `\n⚠️ _Not enough for a video - top up below!_`;
        }
    } else if (user.points > 0) {
        creditMsg = `\n\n💰 *Your Points:* ${user.points} (~${approx5s} videos)`;
    } else {
        creditMsg = `\n\n🎁 *New User Bonus:* Get 69 FREE credits - enough for your first video!`;
        buttons.unshift([Markup.button.callback('🎁 Claim 69 Free Credits', 'get_free_credits')]);
    }

    await ctx.replyWithMarkdown(
        `👋 Welcome back!${creditMsg}`,
        Markup.inlineKeyboard(buttons)
    );
}

// ============ COMMANDS ============

bot.command('start', async (ctx) => {
    const payload = ctx.startPayload;
    const userId = String(ctx.from.id);

    logger.info('start_command', { userId, payload: payload || 'none' });
    trackEvent(userId, 'bot_started', { payload: payload || 'direct' });

    if (payload === 'get_credits') {
        const existingCredits = getCredits({ telegramUserId: userId });
        
        if (existingCredits > 0) {
            await ctx.reply(`You already have ${existingCredits} credits! Use them to create amazing face swap videos.\n\nTap "Create Video" below to get started.`);
            await sendDemoMenu(ctx);
            return;
        }
        
        await startWelcomeCreditsCheckout(ctx);
        return;
    }

    if (payload === 'credits_success') {
        const credits = getCredits({ telegramUserId: userId });
        trackEvent(userId, 'welcome_credits_success', { credits });
        if (credits > 0) {
            await ctx.reply(`🎉 *Welcome!* Your ${credits} credits are ready!\n\nYour first 5-second face swap costs 60 credits. Let's create something awesome!`, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply(`⏳ Processing your credits... They should appear in a moment!\n\nUse /start to check your balance.`);
        }
        await sendDemoMenu(ctx);
        return;
    }

    if (payload === 'credits_cancel') {
        trackEvent(userId, 'welcome_credits_cancelled', {});
        await ctx.reply(`No worries! You can get your 69 welcome credits anytime by tapping the button below.`);
        await sendDemoMenu(ctx);
        return;
    }

    if (payload === 'buy_points') {
        return sendBuyPointsMenu(ctx);
    }

    await sendDemoMenu(ctx);
});

// Daily credits command
bot.command('daily', async (ctx) => {
    const userId = String(ctx.from.id);
    const result = claimDailyCredits({ telegramUserId: userId });
    
    if (result.granted) {
        let msg = `🎁 *Daily Credits Claimed!*\n\n+${result.amount} credits added to your account`;
        if (result.streak > 1) {
            msg += `\n🔥 *${result.streak}-day streak!* (+${result.streakBonus} bonus credits)`;
        }
        msg += `\n\n_Come back tomorrow for more!_`;
        await ctx.replyWithMarkdown(msg);
        trackEvent(userId, 'daily_claimed', { amount: result.amount, streak: result.streak });
    } else {
        const hours = result.hoursLeft || 24;
        await ctx.reply(`⏰ You've already claimed today's credits!\n\nCome back in ${hours} hours for your next ${10 + Math.min((result.streak || 0) * 2, 20)} credits.\n\n🔥 Current streak: ${result.streak || 0} days`);
    }
});

// ============ BUY POINTS MENU - OPTIMIZED ============

async function sendBuyPointsMenu(ctx) {
    const userId = String(ctx.from.id);
    const firstPurchase = isFirstPurchase({ telegramUserId: userId });
    
    trackEvent(userId, 'buy_menu_viewed', { firstPurchase });
    
    let header = '💳 *Choose a credit pack:*\n\n';
    
    if (firstPurchase) {
        header = '🎁 *FIRST-TIME BUYER SPECIAL!*\n\nTry us out for just $0.99:\n\n';
    }
    
    const p = demoCfg.packs;
    const text = `${header}` +
        `🎯 *Try It* - ${p.micro.points} credits = 1 video\n   └ *$${(p.micro.price_cents/100).toFixed(2)}* ${firstPurchase ? '← Start Here!' : ''}\n\n` +
        `⭐ *Starter* - ${p.starter.points} credits = ~${p.starter.approx5sDemos} videos\n   └ *$${(p.starter.price_cents/100).toFixed(2)}*\n\n` +
        `🔥 *Plus* - ${p.plus.points} credits = ~${p.plus.approx5sDemos} videos\n   └ *$${(p.plus.price_cents/100).toFixed(2)}* (Best Value!)\n\n` +
        `💎 *Pro* - ${p.pro.points} credits = ~${p.pro.approx5sDemos} videos\n   └ *$${(p.pro.price_cents/100).toFixed(2)}* (25% savings!)`;
    
    return ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
        [Markup.button.callback(`🎯 $0.99 - ${p.micro.points} credits`, 'buy_pack_micro')],
        [Markup.button.callback(`⭐ $4.99 - ${p.starter.points} credits`, 'buy_pack_starter')],
        [Markup.button.callback(`🔥 $8.99 - ${p.plus.points} credits`, 'buy_pack_plus')],
        [Markup.button.callback(`💎 $14.99 - ${p.pro.points} credits`, 'buy_pack_pro')],
    ]));
}

// ============ ACTION HANDLERS ============

bot.action('claim_daily', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        const result = claimDailyCredits({ telegramUserId: userId });
        
        if (result.granted) {
            let msg = `🎁 *Daily Credits Claimed!*\n\n+${result.amount} credits`;
            if (result.streak > 1) {
                msg += ` (🔥 ${result.streak}-day streak bonus!)`;
            }
            await ctx.replyWithMarkdown(msg);
            trackEvent(userId, 'daily_claimed', { amount: result.amount, streak: result.streak });
        } else {
            await ctx.reply(`⏰ Come back in ${result.hoursLeft || 24} hours!\n\n🔥 Streak: ${result.streak || 0} days`);
        }
    } catch (e) {
        logger.error('claim_daily failed', { error: e.message });
    }
});

bot.action('get_free_credits', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const userId = String(ctx.from.id);
        logger.info('get_free_credits callback', { userId });
        trackEvent(userId, 'free_credits_clicked', {});
        
        const existingCredits = getCredits({ telegramUserId: userId });
        if (existingCredits > 0) {
            await ctx.reply(`You already have ${existingCredits} credits! Tap "Create Video" to use them.`);
            await sendDemoMenu(ctx);
            return;
        }
        
        await startWelcomeCreditsCheckout(ctx);
    } catch (e) {
        logger.error('get_free_credits action failed', { error: e.message });
        ctx.reply('❌ Error processing request. Please try again.');
    }
});

bot.action('buy_points_menu', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await sendBuyPointsMenu(ctx);
    } catch (e) {
        logger.error('buy_points_menu action failed', { error: e.message });
    }
});

// Checkout functions
let cachedBotUsername = null;
async function getBotUsername() {
    if (cachedBotUsername) return cachedBotUsername;
    const me = await bot.telegram.getMe();
    cachedBotUsername = me && me.username ? me.username : null;
    return cachedBotUsername;
}

// Currency conversion helpers
const https = require('https');
// IMPORTANT: Mexican Stripe accounts can ONLY process MXN
// Do not add other currencies - they will be rejected by Stripe
const SUPPORTED_CURRENCIES = ['mxn']; // Only MXN for Mexican Stripe accounts
const CURRENCY_SYMBOLS = { mxn: 'MX$' };
const SAFE_RATES = { MXN: 18.0 }; // Updated MXN rate

async function fetchUsdRate(toCurrency) {
    return new Promise((resolve) => {
        try {
            const symbol = String(toCurrency || '').toUpperCase();
            if (symbol === 'USD') return resolve(1);
            
            const req = https.request({ 
                hostname: 'api.exchangerate-api.com', 
                path: '/v4/latest/USD', 
                method: 'GET',
                timeout: 4000 
            }, res => {
                let buf = ''; 
                res.on('data', c => buf += c); 
                res.on('end', () => {
                    try { 
                        const j = JSON.parse(buf); 
                        const rate = j && j.rates && j.rates[symbol]; 
                        if (typeof rate === 'number') resolve(rate);
                        else resolve(SAFE_RATES[symbol] || 1);
                    } catch (_) { 
                        resolve(SAFE_RATES[symbol] || 1); 
                    }
                });
            });
            req.on('error', () => resolve(SAFE_RATES[symbol] || 1));
            req.on('timeout', () => { req.destroy(); resolve(SAFE_RATES[symbol] || 1); });
            req.end();
        } catch (_) { 
            resolve(SAFE_RATES[toCurrency.toUpperCase()] || 1); 
        }
    });
}

function toMinorUnits(usdAmount, currency, rate) {
    let val = Number(usdAmount) * Number(rate || 1);
    if (currency.toLowerCase() !== 'usd') {
        val = val * 1.03; // 3% spread for FX safety
    }
    return Math.round(val * 100);
}

// Currency selection handlers - Auto-redirect to MXN payment (Mexican Stripe account)
bot.action(/buy_pack_(.+)_selectcurrency/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const packKey = ctx.match[1];
        const pack = demoCfg.packs[packKey];
        if (!pack) return ctx.reply('Invalid pack');
        
        // Mexican Stripe accounts can only process MXN - redirect directly to payment
        const currency = 'mxn';
        const userId = String(ctx.from.id);
        const username = await getBotUsername();
        const botUrl = username ? `https://t.me/${username}` : 'https://t.me/FaceSwapVideoAiBot';
        
        // Get exchange rate and convert to MXN
        const rate = await fetchUsdRate(currency);
        const amountInCurrency = toMinorUnits(pack.price_cents / 100, currency, rate);
        const displayAmount = (amountInCurrency / 100).toFixed(2);
        const symbol = CURRENCY_SYMBOLS[currency] || currency.toUpperCase();
        
        trackEvent(userId, 'checkout_started', { pack: packKey, currency, amount: amountInCurrency });

        const session = await stripe.checkout.sessions.create({
            line_items: [{
                price_data: {
                    currency: currency,
                    product_data: { name: pack.label },
                    unit_amount: amountInCurrency,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: process.env.STRIPE_SUCCESS_URL || `${botUrl}?start=success`,
            cancel_url: process.env.STRIPE_CANCEL_URL || `${botUrl}?start=cancel`,
            client_reference_id: userId,
            metadata: {
                points: String(pack.points),
                pack_type: packKey,
                currency: currency,
                usd_equivalent: String(pack.price_cents)
            }
        });
        
        await ctx.reply(
            `💳 *${pack.label}*\n\n${pack.points} credits for *${symbol}${displayAmount}*\n\nTap below to complete your purchase:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '💳 Pagar Ahora / Pay Now', url: session.url }]],
                },
            }
        );
    } catch (e) {
        logger.error('Payment checkout failed', { error: e.message, userId: ctx.from?.id });
        ctx.reply('❌ Error en el sistema de pago. Por favor intenta de nuevo. / Payment system error. Please try again.');
    }
});

bot.action('cancel_payment', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.deleteMessage().catch(() => {});
        await ctx.reply('Payment cancelled.');
    } catch (e) {
        logger.error('Cancel payment failed', { error: e.message });
    }
});

bot.action(/pay:(\w+):(.+)/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const currency = ctx.match[1].toLowerCase();
        const packKey = ctx.match[2];
        const pack = demoCfg.packs[packKey];
        
        if (!pack) return ctx.reply('Invalid pack');
        if (!SUPPORTED_CURRENCIES.includes(currency)) return ctx.reply('Unsupported currency');
        
        const username = await getBotUsername();
        const botUrl = username ? `https://t.me/${username}` : 'https://t.me/FaceSwapVideoAiBot';
        const userId = String(ctx.from.id);
        
        // Get exchange rate and convert
        const rate = await fetchUsdRate(currency);
        const amountInCurrency = toMinorUnits(pack.price_cents / 100, currency, rate);
        const displayAmount = (amountInCurrency / 100).toFixed(2);
        const symbol = CURRENCY_SYMBOLS[currency] || currency.toUpperCase();
        
        trackEvent(userId, 'checkout_started', { pack: packKey, currency, amount: amountInCurrency });

        const session = await stripe.checkout.sessions.create({
            line_items: [{
                price_data: {
                    currency: currency,
                    product_data: { name: pack.label },
                    unit_amount: amountInCurrency,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: process.env.STRIPE_SUCCESS_URL || `${botUrl}?start=success`,
            cancel_url: process.env.STRIPE_CANCEL_URL || `${botUrl}?start=cancel`,
            client_reference_id: userId,
            metadata: {
                points: String(pack.points),
                pack_type: packKey,
                currency: currency,
                usd_equivalent: String(pack.price_cents)
            }
        });
        
        await ctx.reply(
            `💳 *${pack.label}*\n\n${pack.points} credits for *${symbol}${displayAmount}*\n\nTap below to complete your purchase:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '💳 Pay Now', url: session.url }]],
                },
            }
        );
    } catch (e) {
        logger.error('Payment checkout failed', { error: e.message, userId: ctx.from?.id });
        ctx.reply('❌ Payment system error. Please try again later.');
    }
});

async function startCheckout(ctx, pack, packKey) {
    // Redirect to currency selection instead of direct checkout
    try {
        await ctx.answerCbQuery();
        const usdPrice = (pack.price_cents / 100).toFixed(2);
        
        await ctx.reply(
            `💰 *${pack.label}*\n${pack.points} credits for $${usdPrice} USD\n\n🌍 *Select your currency:*`,
            {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('🇺🇸 USD', `pay:usd:${packKey}`), Markup.button.callback('🇲🇽 MXN', `pay:mxn:${packKey}`)],
                    [Markup.button.callback('🇪🇺 EUR', `pay:eur:${packKey}`), Markup.button.callback('🇬🇧 GBP', `pay:gbp:${packKey}`)],
                    [Markup.button.callback('🇨🇦 CAD', `pay:cad:${packKey}`)],
                    [Markup.button.callback('❌ Cancel', 'cancel_payment')]
                ]).reply_markup
            }
        );
    } catch (e) {
        logger.error('startCheckout failed', { error: e.message, pack: pack.label, userId: ctx.from.id });
        ctx.reply('❌ Payment system error. Please try again later.');
    }
}

async function startWelcomeCreditsCheckout(ctx) {
    try {
        logger.info('startWelcomeCreditsCheckout called', { userId: ctx.from.id });
        const username = await getBotUsername();
        const botUrl = username ? `https://t.me/${username}` : 'https://t.me/ImMoreThanJustSomeBot';

        const session = await stripe.checkout.sessions.create({
            mode: 'setup',
            success_url: `${botUrl}?start=credits_success`,
            cancel_url: `${botUrl}?start=credits_cancel`,
            client_reference_id: String(ctx.from.id),
            metadata: {
                credits: '69',
                type: 'welcome_credits',
                telegram_user_id: String(ctx.from.id)
            }
        });
        
        logger.info('Stripe setup session created', { sessionId: session.id, url: session.url });
        await ctx.reply(
            `🎁 *Get 69 FREE Credits!*\n\nVerify your card to unlock your welcome bonus.\n\n✅ You will NOT be charged\n✅ 69 credits = 1 free video + 9 extra\n✅ One-time welcome bonus\n\n_We verify cards to prevent abuse_`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🎁 Verify & Get 69 Free Credits', url: session.url }]],
                },
            }
        );
    } catch (e) {
        logger.error('startWelcomeCreditsCheckout failed', { error: e.message, stack: e.stack, userId: ctx.from.id });
        ctx.reply('❌ Registration system error. Please try again later.');
    }
}

// Pack purchase handlers
bot.action('buy_pack_micro', async (ctx) => {
    await ctx.answerCbQuery();
    await startCheckout(ctx, demoCfg.packs.micro, 'micro');
});
bot.action('buy_pack_starter', async (ctx) => {
    await ctx.answerCbQuery();
    await startCheckout(ctx, demoCfg.packs.starter, 'starter');
});
bot.action('buy_pack_plus', async (ctx) => {
    await ctx.answerCbQuery();
    await startCheckout(ctx, demoCfg.packs.plus, 'plus');
});
bot.action('buy_pack_pro', async (ctx) => {
    await ctx.answerCbQuery();
    await startCheckout(ctx, demoCfg.packs.pro, 'pro');
});

bot.action('help', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.reply(
`❓ *How to use Face Swap Bot:*

1️⃣ *Get Credits* - New users get 69 free credits
2️⃣ *Create Video* - Choose video length (5s/10s/15s)
3️⃣ *Upload* - Send your video, then your face photo
4️⃣ *Wait* - Processing takes 60-120 seconds
5️⃣ *Enjoy* - Download your face-swapped video!

*Tips:*
• Use clear, front-facing photos
• Keep videos under the time limit
• Claim daily free credits!

*Commands:*
/start - Main menu
/daily - Claim daily credits

*Support:* Contact @YourSupportHandle`, { parse_mode: 'Markdown' });
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
        trackEvent(uid, 'demo_new_clicked', {});
        ctx.session = { mode: 'demo', step: 'choose_length' };
        await ctx.reply(
            '📏 Choose video length:',
            Markup.inlineKeyboard([
                [Markup.button.callback(`5 seconds – ${demoCfg.demoPrices['5']} credits`, 'demo_len_5')],
                [Markup.button.callback(`10 seconds – ${demoCfg.demoPrices['10']} credits`, 'demo_len_10')],
                [Markup.button.callback(`15 seconds – ${demoCfg.demoPrices['15']} credits`, 'demo_len_15')],
            ])
        );
    } catch (e) {
        logger.error('demo_new action failed', { error: e.message, userId: ctx.from.id });
    }
});

bot.action('demo_len_5', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        ctx.session = { mode: 'demo', step: 'awaiting_base_video', duration: 5, price: demoCfg.demoPrices['5'] };
        await ctx.reply(`📹 Send your video (5 seconds or less).\n\n⚠️ Make sure it's already trimmed to 5 seconds!`);
    } catch (e) {
        logger.error('demo_len_5 action failed', { error: e.message });
    }
});

bot.action('demo_len_10', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        ctx.session = { mode: 'demo', step: 'awaiting_base_video', duration: 10, price: demoCfg.demoPrices['10'] };
        await ctx.reply(`📹 Send your video (10 seconds or less).\n\n⚠️ Make sure it's already trimmed to 10 seconds!`);
    } catch (e) {
        logger.error('demo_len_10 action failed', { error: e.message });
    }
});

bot.action('demo_len_15', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        ctx.session = { mode: 'demo', step: 'awaiting_base_video', duration: 15, price: demoCfg.demoPrices['15'] };
        await ctx.reply(`📹 Send your video (15 seconds or less).\n\n⚠️ Make sure it's already trimmed to 15 seconds!`);
    } catch (e) {
        logger.error('demo_len_15 action failed', { error: e.message });
    }
});

// Video handler
bot.on('video', async (ctx) => {
    if (!ctx.session || !ctx.session.step) return;

    const userId = String(ctx.from.id);
    const fileId = ctx.message.video.file_id;

    if (ctx.session.mode === 'demo' && ctx.session.step === 'awaiting_base_video') {
        const duration = ctx.message.video.duration || 0;
        const max = ctx.session.duration || 0;
        if (duration > max) {
            return ctx.reply(`❌ Video too long! This demo is ${max} seconds max.\n\nYour video is ${duration} seconds. Please trim it and try again.`);
        }
        const url = await getFileLink(ctx, fileId);
        const uploaded = await uploadFromUrl(url, 'video');
        ctx.session.base_url = uploaded;
        ctx.session.step = 'awaiting_face';
        ctx.reply('✅ Video received!\n\n📸 Now send a clear photo of the face you want to use.');
    }
});

// Channel post handler
bot.on('channel_post', async (ctx) => {
    const text = ctx.channelPost?.text;
    if (text && text.trim() === '/start') {
        try {
            logger.info('channel_post: /start detected', { chatId: ctx.chat.id });
            await sendDemoMenu(ctx);
        } catch (error) {
            logger.error('channel_post handler failed', { error: error.message });
        }
    }
});

// Promo command
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
