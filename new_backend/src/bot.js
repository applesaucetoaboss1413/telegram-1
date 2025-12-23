console.log('🔥 INIT DEMO BOT');

const { Telegraf, Markup, session } = require('telegraf');
const path = require('path');
const os = require('os');
const { getUser, updateUserPoints, createJob, addTransaction, updateJobStatus } = require('./database');
const { startFaceSwap, startFaceSwapPreview, startImage2Video } = require('./services/magicService');
const queueService = require('./services/queueService');
const { downloadTo, downloadBuffer, cleanupFile } = require('./utils/fileUtils');
const { detectFaces } = require('./services/faceService');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const winston = require('winston');
const { uploadFromUrl } = require('./services/cloudinaryService');
const runImage2VideoFlow = require('../dist/ts/image2videoHandler.js').runImage2VideoFlow;
const demoCfg = require('./services/a2eConfig');
const CHANNEL_ID = process.env.CHANNEL_ID;

console.log('🔥 INIT DEMO BOT');

const bot = new Telegraf(process.env.BOT_TOKEN);
console.log('🔥 BOT CREATED');
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
        if (e.message.includes('No human face detected')) throw e;
        console.error('Face detection internal error:', e);
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
        console.error('Failed to send result:', e);
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
        console.error('Failed to send failure notification:', e);
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
bot.command('start', async (ctx) => {
    console.log('🔥 /start HANDLER (DEMO MENU)');
    const user = getUser(String(ctx.from.id));
    ctx.session = { step: null };
    if (ctx.chat && ctx.chat.type === 'private') {
        const p = demoCfg.packs;
        const msg = `🎭 *Face Swap Demo*
Turn any clip into a face swap demo in seconds.

*Packs*
• ${p.starter.label} – ${p.starter.points} pts (~${p.starter.approxDemos} demos) – ${p.starter.priceDisplay}
• ${p.plus.label} – ${p.plus.points} pts (~${p.plus.approxDemos} demos) – ${p.plus.priceDisplay}
• ${p.pro.label} – ${p.pro.points} pts (~${p.pro.approxDemos} demos) – ${p.pro.priceDisplay}

*Steps*
1. Buy points
2. Create new demo
3. Pick length & base video
4. Upload face`;
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
    const approx10s = Math.floor(user.points / demoCfg.demoPrices['10']);
    await ctx.reply(
        `👋 Welcome! You have ${user.points} points (~${approx10s} 10s demos).`,
        Markup.inlineKeyboard([
            [Markup.button.callback('Create new demo', 'demo_new')],
            [Markup.button.callback('My demos', 'demo_list')],
            [Markup.button.callback('Buy points', 'buy_points_menu')],
            [Markup.button.callback('Help', 'help')]
        ])
    );
});

bot.command('promo', async (ctx) => {
    try {
        const adminId = process.env.ADMIN_USER_ID ? String(process.env.ADMIN_USER_ID) : null;
        const caller = String(ctx.from && ctx.from.id);
        if (adminId && caller !== adminId) {
            return ctx.reply('Forbidden');
        }
        if (!CHANNEL_ID) return ctx.reply('CHANNEL_ID missing');
        const me = await bot.telegram.getMe();
        const username = me && me.username ? me.username : '';
        const cta = username ? `https://t.me/${username}?start=demo` : '';
        const intro = `Run 5s/10s/15s Face Swap demos.\nTop up points, pick a template, upload your face, get results.\nStart: ${cta}`;
        const introMsg = await bot.telegram.sendMessage(CHANNEL_ID, intro);
        try { await bot.telegram.pinChatMessage(CHANNEL_ID, introMsg.message_id); } catch (_) {}
        const t5 = demoCfg.templates['5'];
        const t10 = demoCfg.templates['10'];
        const t15 = demoCfg.templates['15'];
        if (t5) await bot.telegram.sendVideo(CHANNEL_ID, t5, { caption: '5s Demo' });
        if (t10) await bot.telegram.sendVideo(CHANNEL_ID, t10, { caption: '10s Demo' });
        if (t15) await bot.telegram.sendVideo(CHANNEL_ID, t15, { caption: '15s Demo' });
        await ctx.reply('Promo posted');
    } catch (e) {
        await ctx.reply(`Error: ${e.message}`);
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

bot.action('buy_points_menu', (ctx) => {
    ctx.answerCbQuery();
    const p10 = demoCfg.demoPrices['10'];
    const approx = (pts) => Math.max(1, Math.floor(pts / p10));
    const s = demoCfg.packs.starter.points;
    const pl = demoCfg.packs.plus.points;
    const pr = demoCfg.packs.pro.points;
    const text = `Choose a credit pack:\nStarter – ${s} pts (~${approx(s)} demos)\nPlus – ${pl} pts (~${approx(pl)} demos)\nPro – ${pr} pts (~${approx(pr)} demos)`;
    ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback(`${demoCfg.packs.starter.label} – ${s} pts`, 'buy_pack_starter')],
        [Markup.button.callback(`${demoCfg.packs.plus.label} – ${pl} pts`, 'buy_pack_plus')],
        [Markup.button.callback(`${demoCfg.packs.pro.label} – ${pr} pts`, 'buy_pack_pro')],
    ]));
});

async function startCheckout(ctx, pack) {
    try {
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
            success_url: process.env.STRIPE_SUCCESS_URL || 'https://t.me/YOUR_BOT?start=success',
            cancel_url: process.env.STRIPE_CANCEL_URL || 'https://t.me/YOUR_BOT?start=cancel',
            client_reference_id: String(ctx.from.id),
        });
        ctx.reply(`Proceed to payment: ${session.url}`);
    } catch (e) {
        ctx.reply('❌ Payment system error. Please try again later.');
    }
}

bot.action('buy_pack_starter', (ctx) => startCheckout(ctx, demoCfg.packs.starter));
bot.action('buy_pack_plus', (ctx) => startCheckout(ctx, demoCfg.packs.plus));
bot.action('buy_pack_pro', (ctx) => startCheckout(ctx, demoCfg.packs.pro));

bot.action('help', (ctx) => {
    ctx.reply('Create short demo videos. Buy points, choose length, select base video, send one clear face photo, and receive your demo. Keep uploads within the chosen time limit.');
});

bot.action('demo_list', (ctx) => {
    ctx.reply('No stored demos yet.');
});

bot.action('demo_new', (ctx) => {
    const uid = String(ctx.from.id);
    const u = getUser(uid);
    ctx.session = { mode: 'demo', step: 'choose_length' };
    ctx.reply(
        'Choose demo length:',
        Markup.inlineKeyboard([
            [Markup.button.callback(`5 seconds – ${demoCfg.demoPrices['5']} points`, 'demo_len_5')],
            [Markup.button.callback(`10 seconds – ${demoCfg.demoPrices['10']} points`, 'demo_len_10')],
            [Markup.button.callback(`15 seconds – ${demoCfg.demoPrices['15']} points`, 'demo_len_15')],
        ])
    );
});

bot.action('demo_len_5', (ctx) => { ctx.session = { mode: 'demo', step: 'choose_base', duration: 5, price: demoCfg.demoPrices['5'] }; ctx.reply('Choose base video:', Markup.inlineKeyboard([[Markup.button.callback('Use example demo', 'demo_base_template')],[Markup.button.callback('Use my own video', 'demo_base_user')]])); });
bot.action('demo_len_10', (ctx) => { ctx.session = { mode: 'demo', step: 'choose_base', duration: 10, price: demoCfg.demoPrices['10'] }; ctx.reply('Choose base video:', Markup.inlineKeyboard([[Markup.button.callback('Use example demo', 'demo_base_template')],[Markup.button.callback('Use my own video', 'demo_base_user')]])); });
bot.action('demo_len_15', (ctx) => { ctx.session = { mode: 'demo', step: 'choose_base', duration: 15, price: demoCfg.demoPrices['15'] }; ctx.reply('Choose base video:', Markup.inlineKeyboard([[Markup.button.callback('Use example demo', 'demo_base_template')],[Markup.button.callback('Use my own video', 'demo_base_user')]])); });

bot.action('demo_base_template', async (ctx) => {
    ctx.answerCbQuery();
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
});

bot.action('demo_base_user', (ctx) => {
    ctx.answerCbQuery();
    const d = ctx.session && ctx.session.duration;
    ctx.session.step = 'awaiting_base_video';
    ctx.reply(`Send a video that is ${d} seconds or less.`);
});

bot.action('demo_tmpl_5', (ctx) => {
    const url = demoCfg.templates['5'];
    if (!url) return ctx.reply('Template not configured: DEMO_EXAMPLE_05_URL missing');
    ctx.session.base_url = url;
    ctx.session.step = 'awaiting_face';
    ctx.reply('Now send one clear photo of the face you want to use.');
});
bot.action('demo_tmpl_10', (ctx) => {
    const url = demoCfg.templates['10'];
    if (!url) return ctx.reply('Template not configured: DEMO_EXAMPLE_10_URL missing');
    ctx.session.base_url = url;
    ctx.session.step = 'awaiting_face';
    ctx.reply('Now send one clear photo of the face you want to use.');
});
bot.action('demo_tmpl_15', (ctx) => {
    const url = demoCfg.templates['15'];
    if (!url) return ctx.reply('Template not configured: DEMO_EXAMPLE_15_URL missing');
    ctx.session.base_url = url;
    ctx.session.step = 'awaiting_face';
    ctx.reply('Now send one clear photo of the face you want to use.');
});
bot.action('mode_video', (ctx) => {
    ctx.session = { mode: 'video', step: 'awaiting_swap_photo' };
    ctx.reply('Step 1: Send the **Source Face** photo (the face you want to use).');
});

bot.action('mode_image', (ctx) => {
    ctx.session = { mode: 'image', step: 'awaiting_swap_photo' };
    ctx.reply('Step 1: Send the **Source Face** photo (the face you want to use).');
});

bot.action('mode_faceswap_preview', (ctx) => {
    ctx.session = { mode: 'faceswap_preview', step: 'awaiting_swap_photo' };
    ctx.reply('Step 1: Send the **Source Face** photo (the face you want to use).');
});

bot.action('mode_image2video', (ctx) => {
    ctx.session = { mode: 'image2video', step: 'awaiting_photo' };
    ctx.reply('Step 1: Send the image to animate.');
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
    console.log('info: safeStop called with', signal);
    try {
        await bot.stop(signal);
    } catch (err) {
        console.error('ERROR: safeStop failed:', err.message);
    }
}

process.once('SIGINT', () => safeStop('SIGINT'));
process.once('SIGTERM', () => safeStop('SIGTERM'));

module.exports = bot;
