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

const bot = new Telegraf(process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN);
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
            // Refund
            const cost = job.type === 'video' ? 15 : 9;
            updateUserPoints(job.user_id, cost);
            addTransaction(job.user_id, cost, 'refund_failed_job');
            await bot.telegram.sendMessage(job.chat_id, `💰 ${cost} points have been refunded.`);
        }
    } catch (e) {
        console.error('Failed to send failure notification:', e);
    }
});

// Bot Logic
bot.command('start', (ctx) => {
    const user = getUser(String(ctx.from.id));
    ctx.session = { step: null }; // Reset session
    ctx.reply(
        `👋 Welcome! You have **${user.points}** points.\n\nChoose a mode to start:`,
        Markup.inlineKeyboard([
            [Markup.button.callback('🎬 Video Face Swap (15 pts)', 'mode_video')],
            [Markup.button.callback('🖼️ Image Face Swap (9 pts)', 'mode_image')],
            [Markup.button.callback('⚡ FaceSwap Preview', 'mode_faceswap_preview')],
            [Markup.button.callback('🎥 Image‑to‑Video', 'mode_image2video')],
            [Markup.button.callback('💰 Buy 100 Points ($5.00)', 'buy_points')]
        ])
    );
});

bot.action('buy_points', async (ctx) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: '100 FaceSwap Points',
                    },
                    unit_amount: 500, // $5.00
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: process.env.STRIPE_SUCCESS_URL || 'https://t.me/YOUR_BOT?start=success',
            cancel_url: process.env.STRIPE_CANCEL_URL || 'https://t.me/YOUR_BOT?start=cancel',
            client_reference_id: String(ctx.from.id),
        });
        
        ctx.reply(`Click here to pay: ${session.url}`);
    } catch (e) {
        console.error('Stripe error:', e);
        ctx.reply('❌ Payment system error. Please try again later.');
    }
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
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;
