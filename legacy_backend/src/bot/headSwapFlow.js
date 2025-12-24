const fs = require('fs');
const path = require('path');
const { Markup } = require('telegraf');
const { downloadTo } = require('./faceswap');
const {
    validateHeadImage,
    validateTargetMedia,
    startHeadSwapTask,
    checkHeadSwapStatus
} = require('../services/headSwapService');
const { loadData, saveData } = require('../services/dataService');
const { DIRS, HEAD_SWAP_COST, PUBLIC_ORIGIN } = require('../config');

// Requirements text
const REQS_TEXT = `*Head Swap Requirements:*
• *Head Image:* Clear frontal photo. No masks, sunglasses, or hands covering face.
• *Target:* Similar angle/pose/expression.
• Head should be ≤ 50% of the frame.
• Max 15s for video.
• Cost: ${HEAD_SWAP_COST} credits.`;

async function initHeadSwap(ctx, pending) {
    const uid = String(ctx.from.id);
    pending[uid] = {
        mode: 'headswap',
        step: 'awaiting_head',
        headPath: null
    };

    await ctx.replyWithMarkdown(
        `*Head Swap Mode Activated* 🎭\n\n${REQS_TEXT}\n\n👇 *Please upload the HEAD image (frontal face).*`,
        Markup.inlineKeyboard([
            Markup.button.callback('Cancel', 'cancel')
        ])
    );
}

async function handleHeadImage(ctx, pendingState) {
    const uid = String(ctx.from.id);

    // Get highest res photo
    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id;
    const link = await ctx.telegram.getFileLink(fileId);

    const fileName = `head_${uid}_${Date.now()}.jpg`;
    const dest = path.join(DIRS.uploads, fileName);

    await ctx.reply('Analyzing head image...');

    try {
        await downloadTo(String(link), dest);

        // Validate
        const val = await validateHeadImage(dest);
        if (!val.valid) {
            fs.unlinkSync(dest); // Cleanup
            return ctx.reply(`❌ Invalid head image: ${val.reason}\nPlease try again.`);
        }

        pendingState[uid].headPath = dest;
        pendingState[uid].step = 'awaiting_target';

        await ctx.reply(
            '✅ Head image accepted.\n\n👇 *Now upload the TARGET image or video (max 15s).*',
            Markup.inlineKeyboard([Markup.button.callback('Cancel', 'cancel')])
        );

    } catch (e) {
        console.error('Head upload error:', e);
        ctx.reply('Failed to process image. Please try again.');
    }
}

async function handleTargetMedia(ctx, pendingState, bot) {
    const uid = String(ctx.from.id);
    const p = pendingState[uid];

    if (!p.headPath) {
        return ctx.reply('Internal state error. Please /headswap again.');
    }

    let fileId, isVideo = false;
    let fileExt = '.jpg';

    if (ctx.message.photo) {
        fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (ctx.message.video) {
        fileId = ctx.message.video.file_id;
        isVideo = true;
        fileExt = '.mp4'; // simplistic
    } else {
        return ctx.reply('Please send a photo or video.');
    }

    const link = await ctx.telegram.getFileLink(fileId);
    const fileName = `target_${uid}_${Date.now()}${fileExt}`;
    const dest = path.join(DIRS.uploads, fileName);

    await ctx.reply('Validating & Checking credits...');

    try {
        await downloadTo(String(link), dest);

        // Validation
        const val = await validateTargetMedia(dest);
        if (!val.valid) {
            fs.unlinkSync(dest);
            return ctx.reply(`❌ Invalid target media: ${val.reason}\nPlease try again.`);
        }

        // Credit Check
        const data = loadData();
        const user = data.users[uid];

        // Ensure user exists (should exist if they are interacting)
        if (!user) {
            return ctx.reply('User profile not found. Type /start.');
        }

        if ((user.points || 0) < HEAD_SWAP_COST) {
            fs.unlinkSync(dest); // Cleanup target
            // Cleanup head too? Maybe keep it? Let's keep state for a bit?
            // Prompt says: "If a user tries /headswap with insufficient credits... duplicate logic... send Not enough credits message plus deep-link/button".
            // Actually, the prompt says "Before running a head swap, check...".
            // We can allow them to top up and then continue?
            // For now, fail fast.
            const kb = Markup.inlineKeyboard([
                Markup.button.callback('Add Credits', 'buy')
            ]);
            return ctx.reply(`⚠️ *Not enough credits.*\nRequired: ${HEAD_SWAP_COST}\nYou have: ${user.points || 0}`, { parse_mode: 'Markdown', ...kb });
        }

        // Configuration Check
        if (!PUBLIC_ORIGIN) {
            return ctx.reply('System Configuration Error: PUBLIC_ORIGIN missing.');
        }

        // Deduct
        user.points -= HEAD_SWAP_COST;
        saveData(data);

        // Log Transaction (Simple append to transaction log if it existed, existing code uses transactions table in Postgres or simple purchase log?)
        // faceswap.js doesn't explicitly log transactions to a DB table other than saving points.
        // User prompt says: "types including HEAD_SWAP".
        // I will log to console as requested in logging section.
        console.log(`[HeadSwap] Started for ${uid}. cost=${HEAD_SWAP_COST}, remaining=${user.points}`);

        await ctx.reply(`🚀 Processing Head Swap... (Credits used: ${HEAD_SWAP_COST})\nThis may take a minute.`);

        // Prepare URLs
        const headUrl = `${PUBLIC_ORIGIN}/uploads/${path.basename(p.headPath)}`;
        const targetUrl = `${PUBLIC_ORIGIN}/uploads/${path.basename(dest)}`;

        // Call API
        try {
            const task = await startHeadSwapTask(headUrl, targetUrl, `hs_${uid}_${Date.now()}`);

            // Start Polling
            pollResult(task.taskId, ctx, bot, uid, HEAD_SWAP_COST);

            // Clear state
            delete pendingState[uid];

        } catch (apiErr) {
            console.error('Head Swap API failed:', apiErr);
            // Refund
            user.points += HEAD_SWAP_COST;
            saveData(data);
            ctx.reply('❌ Service error. Credits refunded. Please try again later.');
        }

    } catch (e) {
        console.error('Target upload error:', e);
        ctx.reply('Failed to process target media.');
    }
}

function pollResult(taskId, ctx, bot, uid, cost) {
    let attempts = 0;
    const maxAttempts = 60; // 3 minutes approx
    const interval = 3000;

    const check = async () => {
        attempts++;
        try {
            const status = await checkHeadSwapStatus(taskId);
            console.log(`[HeadSwap] Poll ${taskId}: ${status.status}`);

            if (status.status === 'completed' || status.status === 'succeeded') {
                const resultUrl = status.resultUrl;
                if (!resultUrl) throw new Error('No result URL');

                // Download result
                const ext = path.extname(resultUrl) || '.mp4'; // assume mp4 if unknown for safety? or check url
                const resFilename = `hs_result_${uid}_${Date.now()}${ext}`;
                const resPath = path.join(DIRS.outputs, resFilename);

                await downloadTo(resultUrl, resPath);

                const caption = `Head Swap Complete ✨\n${cost} credits used.`;

                // Send
                try {
                    if (ext === '.mp4' || ext === '.mov') {
                        await ctx.replyWithVideo({ source: fs.createReadStream(resPath) }, { caption });
                    } else {
                        await ctx.replyWithPhoto({ source: fs.createReadStream(resPath) }, { caption });
                    }
                } catch (sendErr) {
                    // Fallback url
                    await ctx.reply(`Result ready: ${resultUrl}\n(Upload failed)`);
                }

            } else if (status.status === 'failed' || status.status === 'error') {
                ctx.reply(`❌ Head Swap failed: ${status.error || 'Unknown error'}`);
                // Should we refund on failure?
                // Prompt doesn't explicitly say, but good UX.
                // "Failure cases... friendly error messages"
                // I will NOT refund automatically unless confirmed, to avoid abuse loops, but usually credits are for successful generations.
                // Faceswap.js doesn't seem to refund.
                // I'll stick to no refund for now unless it was a definitive server error before start.
                // Actually, if the API fails *after* starting, we usually burned credits. A2E might charge.
            } else {
                if (attempts < maxAttempts) {
                    setTimeout(check, interval);
                } else {
                    ctx.reply('⏱️ Processing timed out. The result might appear later.');
                }
            }
        } catch (e) {
            console.error('Poll error', e);
            // keep polling?
            if (attempts < maxAttempts) setTimeout(check, interval);
        }
    };

    setTimeout(check, interval);
}

module.exports = {
    initHeadSwap,
    handleHeadImage,
    handleTargetMedia
};
