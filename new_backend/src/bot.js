const { Telegraf, Markup, session } = require('telegraf');
const path = require('path');
const os = require('os');
const { getUser, updateUserPoints, createJob, addTransaction, updateJobStatus } = require('./database');
const { startFaceSwap } = require('./services/magicService');
const queueService = require('./services/queueService');
const { downloadTo, cleanupFile } = require('./utils/fileUtils');

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
            [Markup.button.callback('🖼️ Image Face Swap (9 pts)', 'mode_image')]
        ])
    );
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
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    if (ctx.session.step === 'awaiting_swap_photo') {
        const url = await getFileLink(ctx, fileId);
        ctx.session.swapUrl = url;
        ctx.session.step = 'awaiting_target';
        
        const type = ctx.session.mode === 'video' ? 'VIDEO' : 'PHOTO';
        ctx.reply(`✅ Source received. Now send the **Target ${type}** (the one to replace).`);
        return;
    }

    if (ctx.session.step === 'awaiting_target' && ctx.session.mode === 'image') {
        const url = await getFileLink(ctx, fileId);
        await handleSwapRequest(ctx, userId, ctx.session.swapUrl, url, 'image');
        ctx.session = null;
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
