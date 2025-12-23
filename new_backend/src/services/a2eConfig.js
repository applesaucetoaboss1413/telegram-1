const cfg = {
    key: process.env.A2E_API_KEY,
    videoBase: process.env.A2E_VIDEO_BASE || 'https://video.a2e.ai/api/v1',
    apiBase: process.env.A2E_API_BASE || 'https://api.a2e.ai/api/v1',
    demoPrices: {
        '5': Number(process.env.DEMO_PRICE_05 || 60),
        '10': Number(process.env.DEMO_PRICE_10 || 90),
        '15': Number(process.env.DEMO_PRICE_15 || 125)
    },
    maxDurations: {
        '5': Number(process.env.DEMO_MAX_05 || 5),
        '10': Number(process.env.DEMO_MAX_10 || 10),
        '15': Number(process.env.DEMO_MAX_15 || 15)
    },
    templates: {
        '5': process.env.DEMO_EXAMPLE_05_URL || '',
        '10': process.env.DEMO_EXAMPLE_10_URL || '',
        '15': process.env.DEMO_EXAMPLE_15_URL || ''
    },
    packs: {
        starter: { points: Number(process.env.PACK_STARTER_POINTS || 400), label: process.env.PACK_STARTER_LABEL || 'Starter Pack', price_cents: Number(process.env.PACK_STARTER_PRICE_CENTS || 499) },
        plus: { points: Number(process.env.PACK_PLUS_POINTS || 800), label: process.env.PACK_PLUS_LABEL || 'Plus Pack', price_cents: Number(process.env.PACK_PLUS_PRICE_CENTS || 899) },
        pro: { points: Number(process.env.PACK_PRO_POINTS || 1600), label: process.env.PACK_PRO_LABEL || 'Pro Pack', price_cents: Number(process.env.PACK_PRO_PRICE_CENTS || 1499) }
    }
};

// Calculate derived display values
const pricePerPoint = cfg.packs.starter.price_cents / 100 / cfg.packs.starter.points;

cfg.demoCosts = {
    '5': { points: cfg.demoPrices['5'], usd: (cfg.demoPrices['5'] * pricePerPoint).toFixed(2) },
    '10': { points: cfg.demoPrices['10'], usd: (cfg.demoPrices['10'] * pricePerPoint).toFixed(2) },
    '15': { points: cfg.demoPrices['15'], usd: (cfg.demoPrices['15'] * pricePerPoint).toFixed(2) }
};

for (const key in cfg.packs) {
    cfg.packs[key].priceDisplay = `$${(cfg.packs[key].price_cents / 100).toFixed(2)}`;
    // Approx 10s demos
    cfg.packs[key].approxDemos = Math.floor(cfg.packs[key].points / cfg.demoPrices['10']);
}

module.exports = cfg;
