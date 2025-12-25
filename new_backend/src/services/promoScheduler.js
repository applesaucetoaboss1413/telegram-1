const { PROMO_IMAGES } = require('../config/promoImages');

/**
 * Posts the promotional image batch to the configured Telegram channel.
 * Uses sendMediaGroup as primary method with a fallback to individual sendPhoto calls.
 */
async function postPromoBatch(bot) {
  try {
    // 1. Filter and validate promo images (Single filter operation)
    const validPromos = PROMO_IMAGES.filter(p => Boolean(p && p.path));

    if (validPromos.length === 0) {
      console.warn('No valid promo images configured for promo batch');
      return;
    }

    // Get bot username for dynamic replacement
    const me = await bot.telegram.getMe();
    const botUsername = me.username;

    // 2. Format media group (Single map operation)
    const mediaGroup = validPromos.map((promo, index) => {
      const caption = promo.caption ? promo.caption.replace(/@YourBotName/g, `@${botUsername}`) : '';
      return {
        type: 'photo',
        media: promo.path,
        // Caption only on the first item as per spec
        ...(index === 0 && caption ? { caption } : {})
      };
    });

    try {
      // Primary path: send as media group (album)
      await bot.telegram.sendMediaGroup(
        process.env.PROMO_CHANNEL_ID,
        mediaGroup
      );
      console.log('Posted promo batch (media group)', {
        channel: process.env.PROMO_CHANNEL_ID,
        count: validPromos.length,
      });
    } catch (mediaGroupError) {
      console.error(
        'sendMediaGroup failed for promo batch, falling back to sendPhoto loop:',
        mediaGroupError.message
      );

      // Fallback: send each promo individually
      for (const promo of validPromos) {
        const caption = promo.caption ? promo.caption.replace(/@YourBotName/g, `@${botUsername}`) : '';
        await bot.telegram.sendPhoto(
          process.env.PROMO_CHANNEL_ID,
          promo.path,
          caption ? { caption } : {}
        );
      }

      console.log('Posted promo batch via sendPhoto loop', {
        channel: process.env.PROMO_CHANNEL_ID,
        count: validPromos.length,
      });
    }
  } catch (error) {
    console.error('Failed to post promo batch:', error.message);
    console.info('Retrying in 5 minutes...');
    // Automatic retry after 5 minutes on failure
    setTimeout(() => postPromoBatch(bot), 5 * 60 * 1000);
  }
}

/**
 * Initializes the promo scheduler.
 * Runs once on startup and then every 6 hours.
 */
function startPromoScheduler(bot) {
  // Initial run on startup
  postPromoBatch(bot).catch(err => console.error('Startup promo post failed:', err.message));

  // Repeat every 6 hours
  setInterval(() => postPromoBatch(bot), 6 * 60 * 60 * 1000);
}

module.exports = { startPromoScheduler, postPromoBatch };
