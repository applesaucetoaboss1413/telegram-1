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
            ...(i === 0 && p.caption ? { caption: p.caption.replace(/@YourBotName/g, `@${me.username}`) } : {})
        }));

        try {
            await bot.telegram.sendMediaGroup(channelId, mediaGroup);
        } catch (error) {
            console.error('Media group send failed, falling back to individual photos:', error.message);

            // Fallback path: send photos individually
            for (const promo of mediaGroup.map(item => ({
                path: item.media,
                caption: item.caption
            }))) {
                try {
                    await bot.telegram.sendPhoto(
                        channelId,
                        promo.path,
                        promo.caption ? { caption: promo.caption } : undefined
                    );
                } catch (fallbackError) {
                    console.error('Failed to send individual promo:', fallbackError.message);
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
    postPromoBatch(bot);
    setInterval(() => postPromoBatch(bot), 6 * 60 * 60 * 1000);
}

module.exports = { startPromoScheduler, postPromoBatch };
