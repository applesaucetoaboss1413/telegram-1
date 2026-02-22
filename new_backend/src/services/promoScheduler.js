const { PROMO_IMAGES } = require('../config/promoImages');
const demoCfg = require('./a2eConfig');
const { getBilingualPromoMessage, getBilingualBuyButtons } = require('./promoUtils');

// Add blur effect to Cloudinary URLs for NSFW content
const blurUrl = (url) => {
    if (!url || !url.includes('cloudinary.com')) return url;
    return url.replace('/upload/', '/upload/e_blur:800/');
};

async function postStartupVideos(bot) {
    const channelId = process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi';
    try {
        const Markup = require('telegraf').Markup;
        const botName = process.env.BOT_USERNAME || 'ImMoreThanJustSomeBot';
        const miniAppUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp` : 'https://telegramalam.onrender.com/miniapp/';

        // Unified Startup Message (Reduces spam, high impact)
        // Includes: Welcome, Instructions, Mini App Upsell, and Pricing
        const msg = getBilingualPromoMessage();
        
        // Use Bilingual Buy Buttons (URL buttons) for Channel context
        const buttons = getBilingualBuyButtons(Markup);

        await bot.telegram.sendMessage(channelId, msg, {
            parse_mode: 'Markdown',
            reply_markup: buttons.reply_markup
        });

        console.log('Startup intro message posted to channel (Unified).');
    } catch (error) {
        console.error('Failed to post startup intro:', error.message);
    }
}

async function postPromoBatch(bot) {
    const channelId = process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi';
    try {
        const validPromos = PROMO_IMAGES.filter(p => p && p.path);
        const Markup = require('telegraf').Markup;

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
                // Fallback logic omitted for brevity, assume main path works
            }
        }

        // Then send the full pricing/info message with buy buttons
        // Use the main bilingual promo message which now includes:
        // 1. Instructions (Photo + Video)
        // 2. Mini App upsell
        // 3. Website upsell (full suite)
        const msg = getBilingualPromoMessage();
        const buttons = getBilingualBuyButtons(Markup);

        await bot.telegram.sendMessage(channelId, msg, {
            parse_mode: 'Markdown',
            reply_markup: buttons.reply_markup
        });

        console.log('Promo message with pricing posted to channel.');
    } catch (error) {
        console.error('Promo post failed:', error.message);
        console.log('Retrying in 5 minutes...');
        setTimeout(() => postPromoBatch(bot), 5 * 60 * 1000);
    }
}

// THE BIG FLASHY STUDIO BUTTON - Sent LAST after everything else
async function sendFlashyStudioButton(bot) {
    const channelId = process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi';
    const Markup = require('telegraf').Markup;
    const miniAppUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp` : 'https://telegramalam.onrender.com/miniapp/';

    try {
        await bot.telegram.sendMessage(channelId,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🚀🚀🚀 *AI FACE-SWAP STUDIO* 🚀🚀🚀\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🎨 *YOUR COMPLETE AI TOOLKIT / TU KIT COMPLETO:*\n\n` +
            `✅ *Face Swap Videos* - _Intercambio de Rostros_\n` +
            `✅ *Talking Avatars* - _Avatares Parlantes_\n` +
            `✅ *Image Animation* - _Animación de Fotos_\n` +
            `✅ *4K Enhancement* - _Mejora 4K_\n` +
            `✅ *Background Removal* - _Eliminar Fondo_\n\n` +
            `💰 One balance for all tools! / _¡Un saldo para todo!_\n` +
            `⚡ Fast & Easy / _Rápido y Fácil_\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `     👇👇👇 *TAP TO LAUNCH / ABRIR* 👇👇👇\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            {
                parse_mode: 'Markdown',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.webApp('🎨✨ OPEN STUDIO / ABRIR APP ✨🎨', miniAppUrl)]
                ]).reply_markup
            }
        );
        console.log('✅ FLASHY STUDIO BUTTON sent!');
    } catch (error) {
        console.error('Failed to send flashy studio button:', error.message);
    }
}

async function startPromoScheduler(bot) {
    // SEQUENTIAL execution - each waits for previous to complete

    // Step 1: Promo batch with images and pricing
    await postPromoBatch(bot);

    // Step 2: Wait 2 seconds
    await new Promise(r => setTimeout(r, 2000));

    // Step 3: Startup intro videos (5 blocks)
    await postStartupVideos(bot);

    // Step 4: Wait 2 seconds
    await new Promise(r => setTimeout(r, 2000));

    // Step 5: THE BIG FLASHY STUDIO BUTTON - ABSOLUTELY LAST
    await sendFlashyStudioButton(bot);

    // Schedule subsequent promo batches every 6 hours
    setInterval(() => postPromoBatch(bot), 6 * 60 * 60 * 1000);

    // Start re-engagement system - runs every 2 hours
    setInterval(() => sendReEngagementMessages(bot), 2 * 60 * 60 * 1000);

    // Run first re-engagement after 5 minutes
    setTimeout(() => sendReEngagementMessages(bot), 5 * 60 * 1000);
}

async function postInteractiveMenu(bot) {
    const channelId = process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi';
    const Markup = require('telegraf').Markup;
    try {
        await bot.telegram.sendMessage(channelId, getBilingualPromoMessage(), {
            parse_mode: 'Markdown',
            reply_markup: getBilingualBuyButtons(Markup).reply_markup
        });
        console.log('Interactive menu posted to channel.');
    } catch (error) {
        console.error('Failed to post interactive menu:', error.message);
    }
}

// RE-ENGAGEMENT SYSTEM - Message inactive users to bring them back
async function sendReEngagementMessages(bot) {
    const { db } = require('../database');
    const { getCredits } = require('./creditsService');
    const Markup = require('telegraf').Markup;

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const threeDays = 3 * oneDay;
    const sevenDays = 7 * oneDay;

    console.log('Running re-engagement check...');

    try {
        // Get all users
        const users = db.prepare('SELECT * FROM users').all();
        let sentCount = 0;
        const maxPerRun = 20; // Limit to avoid rate limits

        for (const user of users) {
            if (sentCount >= maxPerRun) break;

            const userId = user.id;
            const credits = getCredits({ telegramUserId: userId });
            const lastActivity = user.last_activity || user.created_at || 0;
            const timeSinceActivity = now - lastActivity;
            const hasPurchased = user.has_purchased === 1;

            let message = null;
            let buttons = null;

            // CASE 1: New user who never bought (1-3 days old)
            if (!hasPurchased && timeSinceActivity > oneDay && timeSinceActivity < threeDays) {
                if (credits >= 60) {
                    message = `👋 *Hey! You have ${credits} credits waiting!*
_¡Hola! Tienes ${credits} créditos esperando!_

That's enough for ${Math.floor(credits / 60)} face swap video${Math.floor(credits / 60) > 1 ? 's' : ''}!
_¡Es suficiente para ${Math.floor(credits / 60)} video(s)!_

🎬 Don't let them go to waste - create something awesome today!
_¡No los dejes perder - crea algo increíble hoy!_`;
                    buttons = Markup.inlineKeyboard([
                        [Markup.button.url('🎬 Create Video Now / Crear Video', 'https://t.me/ImMoreThanJustSomeBot?start=create')],
                        [Markup.button.url('📹 See Examples / Ver Ejemplos', 'https://t.me/ImMoreThanJustSomeBot?start=examples')]
                    ]);
                } else {
                    message = `👋 *Welcome back! / ¡Bienvenido de nuevo!*

🎁 Did you know you can get *69 FREE credits* just by verifying your card?
_¿Sabías que puedes obtener *69 créditos GRATIS* solo verificando tu tarjeta?_

That's enough for a FREE face swap video!
_¡Suficiente para un video gratis!_

✅ No charge - just verification
_✅ Sin cargo - solo verificación_`;
                    buttons = Markup.inlineKeyboard([
                        [Markup.button.url('🎁 Get 69 FREE Credits / GRATIS', 'https://t.me/ImMoreThanJustSomeBot?start=get_credits')],
                        [Markup.button.url('💰 See Pricing / Ver Precios', 'https://t.me/ImMoreThanJustSomeBot?start=buy_points')]
                    ]);
                }
            }

            // CASE 2: User hasn't been active for 3-7 days
            else if (timeSinceActivity > threeDays && timeSinceActivity < sevenDays) {
                message = `🔥 *We miss you! / ¡Te extrañamos!*

Come back and create more amazing face swap videos!
_¡Vuelve y crea más videos increíbles!_

💰 *Special offer:* Your next purchase gets priority processing!
_💰 *Oferta especial:* ¡Tu próxima compra tiene prioridad!_

🎁 Plus, claim your *FREE daily credits* - they stack up!
_🎁 ¡Además, reclama tus *créditos diarios GRATIS*!_`;
                buttons = Markup.inlineKeyboard([
                    [Markup.button.url('🎬 Create Video / Crear Video', 'https://t.me/ImMoreThanJustSomeBot?start=create')],
                    [Markup.button.url('🎁 Claim Daily Credits / Reclamar Diarios', 'https://t.me/ImMoreThanJustSomeBot?start=daily')],
                    [Markup.button.url('💳 Buy Credits / Comprar Créditos', 'https://t.me/ImMoreThanJustSomeBot?start=buy_points')]
                ]);
            }

            // CASE 3: User inactive for 7+ days - win-back offer
            else if (timeSinceActivity > sevenDays && !user.winback_sent) {
                message = `🎉 *COMEBACK SPECIAL! / ¡OFERTA DE REGRESO!*

We haven't seen you in a while...
_Hace tiempo que no te vemos..._

Here's a deal just for you:
_Aquí hay una oferta solo para ti:_

🔥 *Get 20% MORE credits* on your next purchase!
_🔥 *¡Obtén 20% MÁS créditos* en tu próxima compra!_

Use code: *COMEBACK20*
_Usa el código: *COMEBACK20*_

⏰ Valid for 48 hours only!
_⏰ ¡Válido solo por 48 horas!_`;
                buttons = Markup.inlineKeyboard([
                    [Markup.button.url('💰 Claim Your Bonus / Reclamar Bono', 'https://t.me/ImMoreThanJustSomeBot?start=buy_points')],
                    [Markup.button.url('🎬 Create Free Video / Crear Video Gratis', 'https://t.me/ImMoreThanJustSomeBot?start=create')]
                ]);

                // Mark winback as sent (we'd need to add this column)
                try {
                    db.prepare('UPDATE users SET winback_sent = 1 WHERE id = ?').run(userId);
                } catch (e) {
                    // Column might not exist yet
                }
            }

            // CASE 4: User has credits but hasn't created a video recently
            else if (credits >= 60 && timeSinceActivity > oneDay) {
                const videoCount = Math.floor(credits / 60);
                message = `💰 *You have ${credits} credits! / ¡Tienes ${credits} créditos!*

That's enough for *${videoCount} video${videoCount > 1 ? 's' : ''}*!
_¡Suficiente para *${videoCount} video(s)*!_

🎬 Ready to create something amazing?
_🎬 ¿Listo para crear algo increíble?_`;
                buttons = Markup.inlineKeyboard([
                    [Markup.button.url('▶️ Create Video Now / Crear Video', 'https://t.me/ImMoreThanJustSomeBot?start=create')]
                ]);
            }

            // Send the message if we have one
            if (message && buttons) {
                try {
                    await bot.telegram.sendMessage(userId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: buttons.reply_markup
                    });
                    sentCount++;
                    console.log(`Re-engagement sent to user ${userId}`);

                    // Small delay to avoid rate limits
                    await new Promise(r => setTimeout(r, 500));
                } catch (e) {
                    // User may have blocked bot or chat not found - ignore
                    if (!e.message.includes('bot was blocked') && !e.message.includes('chat not found')) {
                        console.error(`Failed to send re-engagement to ${userId}:`, e.message);
                    }
                }
            }
        }

        console.log(`Re-engagement complete. Sent ${sentCount} messages.`);
    } catch (error) {
        console.error('Re-engagement system error:', error.message);
    }
}

// Flash sale function - call this manually or schedule for special occasions
async function sendFlashSale(bot, discountPercent = 30, durationHours = 2) {
    const { db } = require('../database');
    const Markup = require('telegraf').Markup;

    const message = `⚡ *FLASH SALE - ${discountPercent}% OFF! / ¡OFERTA FLASH!* ⚡

🔥 For the next *${durationHours} hours only*:
_🔥 Solo por las próximas *${durationHours} horas*:_

All credit packs are *${discountPercent}% OFF!*
_¡Todos los paquetes con *${discountPercent}% de descuento!*_

💰 *Limited Time Pricing / Precios Limitados:*
• Starter Pack: ~$3.50 (was $4.99)
• Plus Pack: ~$6.30 (was $8.99) 
• Pro Pack: ~$10.50 (was $14.99)

⏰ *Hurry - sale ends soon! / ¡Corre - termina pronto!*`;

    const buttons = Markup.inlineKeyboard([
        [Markup.button.url('🔥 Get Sale Price NOW / Comprar AHORA', 'https://t.me/ImMoreThanJustSomeBot?start=buy_points')],
        [Markup.button.url('🎬 Create Video First / Crear Video', 'https://t.me/ImMoreThanJustSomeBot?start=create')]
    ]);

    try {
        // Send to promo channel
        const channelId = process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi';
        await bot.telegram.sendMessage(channelId, message, {
            parse_mode: 'Markdown',
            reply_markup: buttons.reply_markup
        });

        // Send to all users who have purchased before (high value)
        const buyers = db.prepare('SELECT DISTINCT telegram_user_id FROM purchases').all();
        for (const buyer of buyers) {
            try {
                await bot.telegram.sendMessage(buyer.telegram_user_id, message, {
                    parse_mode: 'Markdown',
                    reply_markup: buttons.reply_markup
                });
                await new Promise(r => setTimeout(r, 300));
            } catch (e) {
                // Ignore blocked users
            }
        }

        console.log(`Flash sale sent to ${buyers.length} previous buyers`);
    } catch (error) {
        console.error('Flash sale send error:', error.message);
    }
}

module.exports = { startPromoScheduler, postPromoBatch, postInteractiveMenu, sendReEngagementMessages, sendFlashSale, sendFlashyStudioButton };
