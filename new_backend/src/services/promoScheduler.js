const { PROMO_IMAGES } = require('../config/promoImages');

async function postPromoBatch(bot) {
    const channelId = process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi';
    try {
        const validPromos = PROMO_IMAGES.filter(p => p && p.path);
        if (validPromos.length === 0) return;

        const me = await bot.telegram.getMe();
        const mediaGroup = validPromos.map((p, i) => ({
            type: 'photo',
            media: p.path,
            caption: i === 0 ? p.caption.replace(/@YourBotName/g, `@${me.username}`) : undefined
        }));

        try {
            await bot.telegram.sendMediaGroup(channelId, mediaGroup);
        } catch (err) {
            console.error('sendMediaGroup failed, falling back to individual photos:', err.message);
            for (const p of validPromos) {
                await bot.telegram.sendPhoto(channelId, p.path, {
                    caption: p.caption.replace(/@YourBotName/g, `@${me.username}`)
                });
            }
        }
    } catch (error) {
        console.error('Promo post failed:', error.message);
        console.log('Retrying in 5 minutes...');
        setTimeout(() => postPromoBatch(bot), 5 * 60 * 1000);
    }
}

function startPromoScheduler(bot) {
    postPromoBatch(bot);
    setInterval(() => postPromoBatch(bot), 6 * 60 * 60 * 1000);
}

module.exports = { startPromoScheduler, postPromoBatch };
