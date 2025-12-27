const { PROMO_IMAGES } = require('../config/promoImages');
const demoCfg = require('./a2eConfig');
const { getTotalVideosCreated } = require('./creditsService');

// Add blur effect to Cloudinary URLs for NSFW content
const blurUrl = (url) => {
    if (!url || !url.includes('cloudinary.com')) return url;
    return url.replace('/upload/', '/upload/e_blur:800/');
};

// Main promotional message with all key info
function getPromoMessage() {
    const p = demoCfg.packs;
    const totalVideos = getTotalVideosCreated();
    
    return `🎭 *AI Face Swap Bot*
_Swap your face into any video in seconds!_

📊 *${totalVideos.toLocaleString()}+ videos created by our community!*

━━━━━━━━━━━━━━━━━━━━━
💰 *CREDIT PACKS*
━━━━━━━━━━━━━━━━━━━━━

🎯 *Try It* – ${p.micro.points} credits – *$0.99*
   └ Perfect for your first video!

⭐ *Starter* – ${p.starter.points} credits – $4.99
   └ ~${p.starter.approx5sDemos} videos

🔥 *Plus* – ${p.plus.points} credits – $8.99 ⭐ BEST VALUE
   └ ~${p.plus.approx5sDemos} videos

💎 *Pro* – ${p.pro.points} credits – $14.99
   └ ~${p.pro.approx5sDemos} videos (25% savings!)

━━━━━━━━━━━━━━━━━━━━━
🎁 *FREE CREDITS*
━━━━━━━━━━━━━━━━━━━━━

✨ *69 FREE credits* for new users!
   └ Just verify your card (no charge)
   └ ⚠️ *Limited time offer!*

🔄 *10 FREE credits daily*
   └ Claim every 24 hours
   └ Build streaks for bonus credits!

━━━━━━━━━━━━━━━━━━━━━
📹 *VIDEO PRICING*
━━━━━━━━━━━━━━━━━━━━━

• 5 seconds – 60 credits (~$0.75)
• 10 seconds – 90 credits (~$1.12)
• 15 seconds – 125 credits (~$1.56)

👇 *TAP BELOW TO GET STARTED* 👇`;
}

// Buy buttons for channel posts
function getBuyButtons() {
    const Markup = require('telegraf').Markup;
    const p = demoCfg.packs;
    
    return Markup.inlineKeyboard([
        [Markup.button.url('🎁 Get 69 FREE Credits', 'https://t.me/ImMoreThanJustSomeBot?start=get_credits')],
        [Markup.button.url('🎯 Buy $0.99 Pack', 'https://t.me/ImMoreThanJustSomeBot?start=buy_micro')],
        [Markup.button.url('⭐ Buy $4.99 Pack', 'https://t.me/ImMoreThanJustSomeBot?start=buy_starter')],
        [Markup.button.url('🔥 Buy $8.99 Pack', 'https://t.me/ImMoreThanJustSomeBot?start=buy_plus')],
        [Markup.button.url('🎬 Create Video Now', 'https://t.me/ImMoreThanJustSomeBot?start=create')]
    ]);
}

async function postStartupVideos(bot) {
    const channelId = process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi';
    try {
        const t5 = demoCfg.templates['5'];
        const t10 = demoCfg.templates['10'];
        const t15 = demoCfg.templates['15'];

        const c5 = demoCfg.demoCosts['5'];
        const c10 = demoCfg.demoCosts['10'];
        const c15 = demoCfg.demoCosts['15'];

        const cap5 = `🔞 5s Example (blurred) – ${c5.points} pts (~$${c5.usd})`;
        const cap10 = `🔞 10s Example (blurred) – ${c10.points} pts (~$${c10.usd})`;
        const cap15 = `🔞 15s Example (blurred) – ${c15.points} pts (~$${c15.usd})`;

        const Markup = require('telegraf').Markup;
        
        const btn5 = Markup.inlineKeyboard([
            [Markup.button.url('▶️ Create 5s Swap', 'https://t.me/ImMoreThanJustSomeBot?start=demo_5')],
            [Markup.button.url('🎁 Get 69 Free Credits', 'https://t.me/ImMoreThanJustSomeBot?start=get_credits')]
        ]);
        const btn10 = Markup.inlineKeyboard([
            [Markup.button.url('▶️ Create 10s Swap', 'https://t.me/ImMoreThanJustSomeBot?start=demo_10')],
            [Markup.button.url('🎁 Get 69 Free Credits', 'https://t.me/ImMoreThanJustSomeBot?start=get_credits')]
        ]);
        const btn15 = Markup.inlineKeyboard([
            [Markup.button.url('▶️ Create 15s Swap', 'https://t.me/ImMoreThanJustSomeBot?start=demo_15')],
            [Markup.button.url('🎁 Get 69 Free Credits', 'https://t.me/ImMoreThanJustSomeBot?start=get_credits')]
        ]);

        if (t5) await bot.telegram.sendVideo(channelId, blurUrl(t5), { caption: cap5, reply_markup: btn5.reply_markup }).catch(() => { });
        if (t10) await bot.telegram.sendVideo(channelId, blurUrl(t10), { caption: cap10, reply_markup: btn10.reply_markup }).catch(() => { });
        if (t15) await bot.telegram.sendVideo(channelId, blurUrl(t15), { caption: cap15, reply_markup: btn15.reply_markup }).catch(() => { });

        console.log('Startup videos posted to channel with purchase buttons.');
    } catch (error) {
        console.error('Failed to post startup videos:', error.message);
    }
}

async function postPromoBatch(bot) {
    const channelId = process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi';
    try {
        const validPromos = PROMO_IMAGES.filter(p => p && p.path);
        
        // First send the promo images
        if (validPromos.length > 0) {
            const mediaGroup = validPromos.map((p, i) => ({
                type: 'photo',
                media: p.path,
                ...(i === 0 && p.caption ? { caption: p.caption } : {})
            }));

            try {
                await bot.telegram.sendMediaGroup(channelId, mediaGroup);
                console.log('Promo batch successfully sent as media group.');
            } catch (error) {
                console.error('Media group send failed, falling back to individual photos:', error.message);
                for (let i = 0; i < mediaGroup.length; i++) {
                    try {
                        const item = mediaGroup[i];
                        await bot.telegram.sendPhoto(channelId, item.media, item.caption ? { caption: item.caption } : undefined);
                    } catch (fallbackError) {
                        console.error(`Failed to send individual promo ${i + 1}:`, fallbackError.message);
                    }
                }
            }
        }
        
        // Then send the full pricing/info message with buy buttons
        await bot.telegram.sendMessage(channelId, getPromoMessage(), {
            parse_mode: 'Markdown',
            reply_markup: getBuyButtons().reply_markup
        });
        
        console.log('Promo message with pricing posted to channel.');
    } catch (error) {
        console.error('Promo post failed:', error.message);
        console.log('Retrying in 5 minutes...');
        setTimeout(() => postPromoBatch(bot), 5 * 60 * 1000);
    }
}

function startPromoScheduler(bot) {
    // Run startup videos once
    postStartupVideos(bot);

    // Run first promo batch with pricing
    postPromoBatch(bot);

    // Schedule subsequent promo batches every 6 hours
    setInterval(() => postPromoBatch(bot), 6 * 60 * 60 * 1000);
}

async function postInteractiveMenu(bot) {
    const channelId = process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi';
    try {
        await bot.telegram.sendMessage(channelId, getPromoMessage(), {
            parse_mode: 'Markdown',
            reply_markup: getBuyButtons().reply_markup
        });
        console.log('Interactive menu posted to channel.');
    } catch (error) {
        console.error('Failed to post interactive menu:', error.message);
    }
}

module.exports = { startPromoScheduler, postPromoBatch, postInteractiveMenu, getPromoMessage, getBuyButtons };
