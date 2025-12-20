const { Telegraf, Markup, session } = require('telegraf');
const path = require('path');
const os = require('os');
const { getUser, updateUserPoints, createJob, addTransaction, updateJobStatus } = require('./database');
const { startFaceSwap } = require('./services/magicService');
const queueService = require('./services/queueService');
const { downloadTo, downloadBuffer, cleanupFile } = require('./utils/fileUtils');
const { detectFaces } = require('./services/faceService');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const bot = new Telegraf(process.env.BOT_TOKEN);
const UPLOADS_DIR = path.join(os.tmpdir(), 'telegram_uploads');
const fs = require('fs');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Middleware
bot.use(session());

// Helpers
const getFileLink = async (ctx, fileId) => {
    const link = await ctx.telegram.getFileLink(fileId);
    return link.href;
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

bot.on('photo', async (ctx) => {
    if (!ctx.session || !ctx.session.step) return;

    const userId = String(ctx.from.id);
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    const fileSize = photo.file_size;

    if (ctx.session.step === 'awaiting_swap_photo') {
        try {
            await ctx.reply('🔍 Verifying photo...');
            const { url } = await validatePhoto(ctx, fileId, fileSize);
            ctx.session.swapUrl = url;
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
            await handleSwapRequest(ctx, userId, ctx.session.swapUrl, url, 'image');
            ctx.session = null;
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
        await handleSwapRequest(ctx, userId, ctx.session.swapUrl, url, 'video');
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

    await ctx.reply('⏳ Processing... This may take a minute.');

    try {
        const requestId = await startFaceSwap(swapUrl, targetUrl, type === 'video');
        createJob(requestId, userId, String(ctx.chat.id), type);
        // Queue service will pick it up automatically next poll
    } catch (e) {
        // Refund on immediate error
        updateUserPoints(userId, cost);
        addTransaction(userId, cost, 'refund_api_error');
        ctx.reply(`❌ Error starting job: ${e.message}. Points refunded.`);
    }
}

// Graceful Stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;
