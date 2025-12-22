const cfg = {
    key: process.env.A2E_API_KEY,
    videoBase: process.env.A2E_VIDEO_BASE || 'https://video.a2e.ai/api/v1',
    apiBase: process.env.A2E_API_BASE || 'https://api.a2e.ai/api/v1'
};

module.exports = cfg;

