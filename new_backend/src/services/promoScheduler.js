const { PROMO_IMAGES } = require('../config/promoImages');
const demoCfg = require('./a2eConfig');

async function postStartupVideos(bot) {
    const channelId = process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi';
    try {
        const t5 = demoCfg.templates['5'];
        const t10 = demoCfg.templates['10'];
        const t15 = demoCfg.templates['15'];

        const c5 = demoCfg.demoCosts['5'];
        const c10 = demoCfg.demoCosts['10'];
        const c15 = demoCfg.demoCosts['15'];

        const cap5 = `5s demo – Fastest preview. Costs ${c5.points} pts (~$${c5.usd}). Good for quick tests.`;
        const cap10 = `10s demo – Standard length. Costs ${c10.points} pts (~$${c10.usd}). Best balance.`;
        const cap15 = `15s demo – Maximum detail. Costs ${c15.points} pts (~$${c15.usd}). For pro results.`;

        if (t5) await bot.telegram.sendVideo(channelId, t5, { caption: cap5 }).catch(() => {});
        if (t10) await bot.telegram.sendVideo(channelId, t10, { caption: cap10 }).catch(() => {});
        if (t15) await bot.telegram.sendVideo(channelId, t15, { caption: cap15 }).catch(() => {});
        
        console.log('Startup videos posted to channel.');
    } catch (error) {
        console.error('Failed to post startup videos:', error.message);
    }
}

async function postPromoBatch(bot) {
    const channelId = process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi';
    try {
        const validPromos = PROMO_IMAGES.filter(p => p && p.path);
        if (validPromos.length === 0) return;

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

            // Fallback path: send photos individually
            for (let i = 0; i < mediaGroup.length; i++) {
                try {
                    const item = mediaGroup[i];
                    await bot.telegram.sendPhoto(
                        channelId,
                        item.media,
                        item.caption ? { caption: item.caption } : undefined
                    );
                } catch (fallbackError) {
                    console.error(`Failed to send individual promo ${i + 1}:`, fallbackError.message);
                }
            }
        }
    } catch (error) {
        console.error('Promo post failed:', error.message);
        console.log('Retrying in 5 minutes...');
        setTimeout(() => postPromoBatch(bot), 5 * 60 * 1000);
    }
}

function startPromoScheduler(bot) {
    // Run startup videos once
    postStartupVideos(bot);
    
    // Run first promo batch
    postPromoBatch(bot);
    
    // Schedule subsequent promo batches every 6 hours
    setInterval(() => postPromoBatch(bot), 6 * 60 * 60 * 1000);
}

module.exports = { startPromoScheduler, postPromoBatch };
