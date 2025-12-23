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

module.exports = cfg;
