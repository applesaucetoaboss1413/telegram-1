// Monetization-Optimized Configuration

// Demo/video pricing by duration (in credits)
const demoPrices = {
    '5': 60,
    '10': 90,
    '15': 125,
    '20': 150
};

const microPoints = Number(process.env.PACK_MICRO_POINTS || 80);
const starterPoints = Number(process.env.PACK_STARTER_POINTS || 400);
const plusPoints = Number(process.env.PACK_PLUS_POINTS || 800);
const proPoints = Number(process.env.PACK_PRO_POINTS || 1600);

const cfg = {
    key: process.env.A2E_API_KEY,
    videoBase: process.env.A2E_VIDEO_BASE || 'https://video.a2e.ai/api/v1',
    apiBase: process.env.A2E_API_BASE || 'https://api.a2e.ai/api/v1',

    // Demo/video pricing by duration (in credits)
    demoPrices,

    // MONETIZATION PACKS
    packs: {
        micro: {
            points: microPoints,
            label: process.env.PACK_MICRO_LABEL || '🎯 Try It - 1 Video',
            price_cents: Number(process.env.PACK_MICRO_PRICE_CENTS || 99),
            badge: 'BEST FOR FIRST PURCHASE',
            approx5sDemos: Math.max(1, Math.floor(microPoints / demoPrices['5']))
        },
        starter: {
            points: starterPoints,
            label: process.env.PACK_STARTER_LABEL || '⭐ Starter Pack',
            price_cents: Number(process.env.PACK_STARTER_PRICE_CENTS || 499),
            badge: 'POPULAR',
            approx5sDemos: Math.max(1, Math.floor(starterPoints / demoPrices['5']))
        },
        plus: {
            points: plusPoints,
            label: process.env.PACK_PLUS_LABEL || '🔥 Plus Pack',
            price_cents: Number(process.env.PACK_PLUS_PRICE_CENTS || 899),
            badge: 'BEST VALUE',
            savings: '10%',
            approx5sDemos: Math.max(1, Math.floor(plusPoints / demoPrices['5']))
        },
        pro: {
            points: proPoints,
            label: process.env.PACK_PRO_LABEL || '💎 Pro Pack',
            price_cents: Number(process.env.PACK_PRO_PRICE_CENTS || 1499),
            badge: 'POWER USER',
            savings: '25%',
            approx5sDemos: Math.max(1, Math.floor(proPoints / demoPrices['5']))
        }
    },

    // Daily free credits to drive engagement
    dailyFreeCredits: Number(process.env.DAILY_FREE_CREDITS || 10),

    // Welcome credits for new users
    welcomeCredits: Number(process.env.WELCOME_CREDITS || 69),

    // First purchase discount percentage
    firstPurchaseDiscount: Number(process.env.FIRST_PURCHASE_DISCOUNT || 50),

    // Promotional credit expiry (in days, 0 = never expire)
    promoCreditsExpiryDays: Number(process.env.PROMO_CREDITS_EXPIRY_DAYS || 7),

    // Referral reward points
    referralReward: Number(process.env.REFERRAL_REWARD || 60)
};

module.exports = cfg;
