const { Telegraf, Markup } = require('telegraf');
const path = require('path');
const fs = require('fs');
const { BOT_TOKEN, PRICING, DIRS, PUBLIC_ORIGIN } = require('../config');
const { loadData, saveData, getOrCreateUser } = require('../services/dataService');
const { downloadTo, runFaceswap, runFaceswapImage, createVideo } = require('./faceswap');

const bot = new Telegraf(BOT_TOKEN);

// State tracking for multi-step flows
const pending = {};

// Global Error Handler
bot.catch((err, ctx) => {
    console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
    ctx.reply('An unexpected error occurred. Please try again later.').catch(() => { });
});

// Helpers
function channelKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('Image Face Swap', 'imageswap'), Markup.button.callback('Video Face Swap', 'faceswap')],
        [Markup.button.callback('Buy Points', 'buy'), Markup.button.callback('Prices', 'pricing')],
        [Markup.button.callback('Help', 'help'), Markup.button.callback('Promote', 'promote')],
        [Markup.button.callback('Menu', 'menu'), Markup.button.callback('Refresh', 'refresh')]
    ]);
}

async function toast(ctx, text, alert = false) {
    if (!text) return;
    if (ctx.callbackQuery) {
        try { await ctx.answerCbQuery(text, { show_alert: alert }); } catch (_) { }
    } else {
        try { await ctx.reply(text); } catch (_) { }
    }
}

// Commands
bot.on('message', (ctx) => {
    console.log('[Bot] Message received:', ctx.message.text || 'non-text');
});
bot.start(async ctx => {
    console.log('[Bot] Start command received from', ctx.from.id);
    const payload = ctx.startPayload || '';
    const userId = String(ctx.from.id);
    const u = getOrCreateUser(userId, {
        username: ctx.from.username || '',
        first_name: ctx.from.first_name || '',
        last_name: ctx.from.last_name || ''
    });

    if (payload.startsWith('ref_')) {
        const ref = payload.substring(4);
        const data = loadData();
        if (ref && ref !== userId && data.users[ref]) {
            // Basic referral logic
            data.users[ref].invite_count = (data.users[ref].invite_count || 0) + 1;
            // Bonus points could go here
            saveData(data);
        }
    }

    if (payload === 'faceswap') {
        pending[userId] = { mode: 'faceswap', swap: null, target: null };
        return ctx.reply('Video Face Swap: Send a swap photo first, then a target video trimmed to the length you want. Cost: 3 points per second.');
    }
    if (payload === 'imageswap') {
        pending[userId] = { mode: 'imageswap', swap: null, target: null };
        return ctx.reply('Image Face Swap: Send a swap photo first, then a target photo. Cost: 9 points.');
    }

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Image Face Swap', 'imageswap'), Markup.button.callback('Video Face Swap', 'faceswap')],
        [Markup.button.callback('Buy Points', 'buy'), Markup.button.callback('Prices', 'pricing')],
        [Markup.button.callback('Help', 'help'), Markup.button.callback('Promote', 'promote')],
        [Markup.button.callback('Checkin (Daily)', 'checkin')]
    ]);

    await ctx.reply(`Welcome back, ${u.first_name}! You have ${u.points || 0} points.`, kb);
});

bot.command('menu', async ctx => {
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Image Face Swap', 'imageswap'), Markup.button.callback('Video Face Swap', 'faceswap')],
        [Markup.button.callback('Buy Points', 'buy'), Markup.button.callback('Prices', 'pricing')],
        [Markup.button.callback('Help', 'help'), Markup.button.callback('Promote', 'promote')]
    ]);
    await ctx.reply('Main Menu:', kb);
});

bot.command('pricing', async ctx => {
    const lines = PRICING.map(t => `${t.points} points / $${t.usd}`);
    await ctx.reply(`Prices:\n${lines.join('\n')}`);
});

bot.command('help', async ctx => {
    await ctx.reply('Commands:\n/menu - Main menu\n/faceswap - Video swap\n/imageswap - Image swap\n/pricing - Check prices\n/promote - Earn points');
});

// Actions
bot.action('menu', ctx => ctx.reply('Select an option:', Markup.inlineKeyboard([
    [Markup.button.callback('Image Face Swap', 'imageswap'), Markup.button.callback('Video Face Swap', 'faceswap')],
    [Markup.button.callback('Buy Points', 'buy')]
])));

bot.action('pricing', async ctx => {
    await ctx.answerCbQuery();
    const lines = PRICING.map(t => `${t.points} points / $${t.usd}`);
    await ctx.reply(`Prices:\n${lines.join('\n')}`);
});

bot.action('help', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply('To use Face Swap: \n1. Choose Image or Video mode.\n2. Send the source photo (the face you want).\n3. Send the target photo or video.');
});

bot.action('faceswap', async ctx => {
    await ctx.answerCbQuery();
    const uid = String(ctx.from.id);
    pending[uid] = { mode: 'faceswap', swap: null, target: null };
    await ctx.reply('Video Face Swap mode selected.\n1. Send the PHOTO of the face you want to swap IN.\n(Send "cancel" to stop)');
});

bot.action('imageswap', async ctx => {
    await ctx.answerCbQuery();
    const uid = String(ctx.from.id);
    pending[uid] = { mode: 'imageswap', swap: null, target: null };
    await ctx.reply('Image Face Swap mode selected.\n1. Send the PHOTO of the face you want to swap IN.\n(Send "cancel" to stop)');
});

bot.action('buy', async ctx => {
    await ctx.answerCbQuery();
    const buttons = PRICING.map(p => [Markup.button.callback(`${p.points} pts - $${p.usd}`, `buy:${p.id}`)]);
    await ctx.reply('Select a package:', Markup.inlineKeyboard(buttons));
});

bot.action(/buy:(.+)/, async ctx => {
    const tierId = ctx.match[1];
    const tier = PRICING.find(t => t.id === tierId);
    if (!tier) return ctx.answerCbQuery('Invalid tier');

    // We need to generate a stripe session here, but for simplicity we'll point them to a web link
    // In a real refactor, we might want to move Stripe logic to a service.
    // For now, let's construct the link if the user has an ID.
    const userId = ctx.from.id;
    if (PUBLIC_ORIGIN) {
        const url = `${PUBLIC_ORIGIN}/create-checkout-session?userId=${userId}&tierId=${tierId}`;
        await ctx.reply(`Click here to pay $${tier.usd} for ${tier.points} points:`, Markup.inlineKeyboard([
            [Markup.button.url('Pay Now', url)]
        ]));
    } else {
        await ctx.reply('Payment system not configured (Public Origin missing).');
    }
});

// Photo/Video handling (The core interaction)
bot.on('photo', async ctx => {
    try {
        console.log('[Bot] Photo received from', ctx.from.id);
        const uid = String(ctx.from.id);
        const p = pending[uid];
        if (!p) return; // Ignore random photos if not in a flow

        const photos = ctx.message.photo;
        const fileId = photos[photos.length - 1].file_id;
        const link = await ctx.telegram.getFileLink(fileId);
        const dest = path.join(DIRS.uploads, `photo_${uid}_${Date.now()}.jpg`);
        await downloadTo(String(link), dest);

        if (p.mode === 'faceswap' || p.mode === 'imageswap') {
            if (!p.swap) {
                p.swap = dest;
                await ctx.reply(p.mode === 'faceswap' ? 'Great! Now send the TARGET VIDEO.' : 'Great! Now send the TARGET PHOTO.');
            } else {
                // This case is only for imageswap where target is a photo
                if (p.mode === 'imageswap') {
                    p.target = dest;
                    await ctx.reply('Processing Image Face Swap...');
                    const u = getOrCreateUser(uid);
                    const r = await runFaceswapImage(u, p.swap, p.target, String(ctx.chat.id), bot);
                    delete pending[uid];
                    if (r.error) {
                        await ctx.reply(`Failed: ${r.error}`);
                    } else {
                        await ctx.reply(`Started! Points remaining: ${r.points}`);
                    }
                } else {
                    // User sent a photo but we expected a video for video swap
                    await ctx.reply('Please send a VIDEO for the target, or start over.');
                }
            }
        } else if (p.mode === 'createvideo') {
            // ... (Logic for createvideo if needed, omitting for brevity/focus on spam fix)
        }
    } catch (e) {
        console.error('Photo handler error:', e);
        ctx.reply('Sorry, I had trouble processing that photo.').catch(() => { });
    }
});

bot.on('video', async ctx => {
    try {
        const uid = String(ctx.from.id);
        const p = pending[uid];
        if (!p) return;

        if (p.mode === 'faceswap') {
            if (!p.swap) {
                await ctx.reply('Please send the swap PHOTO first.');
                return;
            }
            const fileId = ctx.message.video.file_id;
            const link = await ctx.telegram.getFileLink(fileId);
            const dest = path.join(DIRS.uploads, `video_${uid}_${Date.now()}.mp4`);
            await downloadTo(String(link), dest);

            p.target = dest;
            await ctx.reply('Processing Video Face Swap...');
            const u = getOrCreateUser(uid);
            const r = await runFaceswap(u, p.swap, p.target, String(ctx.chat.id), bot);
            delete pending[uid];

            if (r.error) {
                await ctx.reply(`Failed: ${r.error}`);
            } else {
                await ctx.reply(`Started! Points remaining: ${r.points}`);
            }
        }
    } catch (e) {
        console.error('Video handler error:', e);
        ctx.reply('Sorry, I had trouble processing that video.').catch(() => { });
    }
});

// Channel post handlers for channel interactions
bot.on('channel_post', async ctx => {
    try {
        const message = ctx.channelPost;
        if (message.photo) {
            // Handle photo in channel
            const uid = String(ctx.from.id); // User who posted
            const p = pending[uid];
            if (!p) return; // Ignore if not in flow

            const photos = message.photo;
            const fileId = photos[photos.length - 1].file_id;
            const link = await ctx.telegram.getFileLink(fileId);
            const dest = path.join(DIRS.uploads, `photo_${uid}_${Date.now()}.jpg`);
            await downloadTo(String(link), dest);

            if (p.mode === 'faceswap' || p.mode === 'imageswap') {
                if (!p.swap) {
                    p.swap = dest;
                    // Reply in channel
                    await ctx.reply(p.mode === 'faceswap' ? 'Great! Now send the TARGET VIDEO.' : 'Great! Now send the TARGET PHOTO.');
                } else {
                    if (p.mode === 'imageswap') {
                        p.target = dest;
                        await ctx.reply('Processing Image Face Swap...');
                        const u = getOrCreateUser(uid);
                        const r = await runFaceswapImage(u, p.swap, p.target, String(ctx.chat.id), bot);
                        delete pending[uid];
                        if (r.error) {
                            await ctx.reply(`Failed: ${r.error}`);
                        } else {
                            await ctx.reply(`Started! Points remaining: ${r.points}`);
                        }
                    } else {
                        await ctx.reply('Please send a VIDEO for the target, or start over.');
                    }
                }
            }
        } else if (message.video) {
            // Handle video in channel
            const uid = String(ctx.from.id);
            const p = pending[uid];
            if (!p) return;

            if (p.mode === 'faceswap') {
                if (!p.swap) {
                    await ctx.reply('Please send the swap PHOTO first.');
                    return;
                }
                const fileId = message.video.file_id;
                const link = await ctx.telegram.getFileLink(fileId);
                const dest = path.join(DIRS.uploads, `video_${uid}_${Date.now()}.mp4`);
                await downloadTo(String(link), dest);

                p.target = dest;
                await ctx.reply('Processing Video Face Swap...');
                const u = getOrCreateUser(uid);
                const r = await runFaceswap(u, p.swap, p.target, String(ctx.chat.id), bot);
                delete pending[uid];

                if (r.error) {
                    await ctx.reply(`Failed: ${r.error}`);
                } else {
                    await ctx.reply(`Started! Points remaining: ${r.points}`);
                }
            }
        }
    } catch (e) {
        console.error('Channel post handler error:', e);
        // Can't reply in channel without permission, perhaps send private message
        try {
            await ctx.telegram.sendMessage(ctx.from.id, 'Sorry, I had trouble processing that.');
        } catch (_) { }
    }
});


// Initialization wrapper
function initBot() {
    // Ensure upload dirs exist
    if (!fs.existsSync(DIRS.uploads)) fs.mkdirSync(DIRS.uploads, { recursive: true });
    if (!fs.existsSync(DIRS.outputs)) fs.mkdirSync(DIRS.outputs, { recursive: true });

    // Launch bot - Telegraf will handle webhook vs polling based on how it's configured
    // In webhook mode (when setWebhook is called), bot.launch() is still needed to initialize handlers
    // The actual webhook endpoint is registered in server.js via bot.webhookCallback()
    if (!process.env.PUBLIC_ORIGIN && !process.env.PUBLIC_URL && !process.env.RENDER_EXTERNAL_URL) {
        // No public URL means we're running locally - use polling
        console.log('[Bot] No PUBLIC_ORIGIN detected, using polling mode');
        bot.launch().then(() => console.log('✅ Bot launched in POLLING mode')).catch(console.error);
    } else {
        // Public URL exists - webhook mode will be set up by server.js
        // But we still need to "launch" the bot to initialize it
        console.log('[Bot] PUBLIC_ORIGIN detected, bot will use WEBHOOK mode (configured in server.js)');
    }

    return bot;
}

module.exports = { bot, initBot };
