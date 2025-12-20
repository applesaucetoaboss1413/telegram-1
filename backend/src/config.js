require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const PRICING = [
    { id: 'p60', points: 60, usd: 3.09, stars: 150, tierBonus: 0.0 },
    { id: 'p120', points: 120, usd: 5.09, stars: 250, tierBonus: 0.02 },
    { id: 'p300', points: 300, usd: 9.99, stars: 500, tierBonus: 0.05 },
    { id: 'p800', points: 800, usd: 19.99, stars: 1000, tierBonus: 0.08 },
    { id: 'p1500', points: 1500, usd: 29.99, stars: 1500, tierBonus: 0.10 },
    { id: 'p7500', points: 7500, usd: 99.0, stars: 5000, tierBonus: 0.12 },
];

function computeOrigin() {
    const raw = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || process.env.PUBLIC_ORIGIN || (process.env.BOT_USERNAME ? `https://t.me/${process.env.BOT_USERNAME}` : 'https://t.me');
    return String(raw).trim().replace(/\/$/, '').replace(/^['"`]+|['"`]+$/g, '');
}

module.exports = {
    PORT: process.env.PORT || 3000,
    BOT_TOKEN: process.env.BOT_TOKEN,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
    API_MARKET_KEY: process.env.API_MARKET_KEY || process.env.MAGICAPI_KEY,
    CHANNEL_ID: process.env.CHANNEL_ID,
    PUBLIC_ORIGIN: computeOrigin(),
    PRICING,
    DIRS: {
        uploads: process.env.VERCEL ? require('path').join(require('os').tmpdir(), 'uploads') : require('path').join(__dirname, '../../uploads'),
        outputs: process.env.VERCEL ? require('path').join(require('os').tmpdir(), 'outputs') : require('path').join(__dirname, '../../outputs'),
        data: process.env.DATA_PATH || require('path').join(require('os').tmpdir(), 'data.json')
    }
};
