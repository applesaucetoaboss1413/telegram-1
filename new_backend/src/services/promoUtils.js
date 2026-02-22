const demoCfg = require('./a2eConfig');

// Bilingual Promo Message Generator
function getBilingualPromoMessage() {
    const p = demoCfg.packs;
    const fakeVideoCount = 8400 + Math.floor(Math.random() * 600);

    return `🎭 *AI Face Swap Studio*
_Swap your face into any video in seconds!_
_¡Cambia tu rostro en cualquier video en segundos!_

📊 *${fakeVideoCount.toLocaleString()}+ videos created!*

━━━━━━━━━━━━━━━━━━━━━
💰 *CREDIT PACKS / PAQUETES*
━━━━━━━━━━━━━━━━━━━━━

🎯 *Try It* – ${p.micro.points} credits
🇺🇸 $0.99 USD | 🇲🇽 MX$${Math.round(p.micro.price_cents / 100)}
   └ Perfect for your first video!
   └ _¡Perfecto para tu primer video!_

⭐ *Starter* – ${p.starter.points} credits
🇺🇸 $4.99 USD | 🇲🇽 MX$${Math.round(p.starter.price_cents / 100)}
   └ ~${p.starter.approx5sDemos} videos
   └ _Most popular / Más popular_

🔥 *Plus* – ${p.plus.points} credits
🇺🇸 $8.99 USD | 🇲🇽 MX$${Math.round(p.plus.price_cents / 100)}
   └ ~${p.plus.approx5sDemos} videos
   └ ⭐ BEST VALUE / MEJOR VALOR

💎 *Pro* – ${p.pro.points} credits
🇺🇸 $14.99 USD | 🇲🇽 MX$${Math.round(p.pro.price_cents / 100)}
   └ ~${p.pro.approx5sDemos} videos
   └ _Power users / Usuarios avanzados_

━━━━━━━━━━━━━━━━━━━━━
🎁 *FREE CREDITS / CRÉDITOS GRATIS*
━━━━━━━━━━━━━━━━━━━━━

✨ *69 FREE credits / GRATIS*
   └ Verify card (no charge)
   └ _Verifica tarjeta (sin cargo)_

🔄 *10 FREE daily / GRATIS diarios*
   └ Claim every 24h
   └ _Reclama cada 24h_

━━━━━━━━━━━━━━━━━━━━━
👇 *START CREATING / COMIENZA AHORA* 👇`;
}

// Bilingual Buy Buttons
function getBilingualBuyButtons(Markup) {
    const p = demoCfg.packs;
    // Use env var for bot username if available, else default
    const botName = process.env.BOT_USERNAME || 'ImMoreThanJustSomeBot';
    const miniAppUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp` : 'https://telegramalam.onrender.com/miniapp/';

    return Markup.inlineKeyboard([
        [Markup.button.webApp('🎨 Open Studio App / Abrir App', miniAppUrl)],
        [Markup.button.url('🎁 Get 69 FREE Credits', `https://t.me/${botName}?start=get_credits`)],
        [Markup.button.url('🇺🇸 Buy USD Packs', `https://t.me/${botName}?start=buy_points`)],
        [Markup.button.url('🇲🇽 Comprar en Pesos', `https://t.me/${botName}?start=buy_points`)]
    ]);
}

// Direct Purchase Buttons (for Bot Menu)
function getDirectPurchaseButtons(Markup) {
    const p = demoCfg.packs;
    const miniAppUrl = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/miniapp` : 'https://telegramalam.onrender.com/miniapp/';

    return Markup.inlineKeyboard([
        [Markup.button.webApp('🎨 Open Studio App / Abrir App', miniAppUrl)],
        [Markup.button.callback(`🎯 ${p.micro.points} Cr - $0.99 / MX$${Math.round(p.micro.price_cents / 100)}`, 'buy_pack_micro')],
        [Markup.button.callback(`⭐ ${p.starter.points} Cr - $4.99 / MX$${Math.round(p.starter.price_cents / 100)}`, 'buy_pack_starter')],
        [Markup.button.callback(`🔥 ${p.plus.points} Cr - $8.99 / MX$${Math.round(p.plus.price_cents / 100)}`, 'buy_pack_plus')],
        [Markup.button.callback(`💎 ${p.pro.points} Cr - $14.99 / MX$${Math.round(p.pro.price_cents / 100)}`, 'buy_pack_pro')],
        // Use URL for free credits as it's a deep link flow
        [Markup.button.url('🎁 Get 69 FREE Credits / GRATIS', `https://t.me/${process.env.BOT_USERNAME || 'ImMoreThanJustSomeBot'}?start=get_credits`)]
    ]);
}

module.exports = {
    getBilingualPromoMessage,
    getBilingualBuyButtons,
    getDirectPurchaseButtons
};
