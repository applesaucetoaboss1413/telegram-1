const fs = require('fs');
const path = require('path');
const https = require('https');
const querystring = require('querystring');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static');
const { API_MARKET_KEY, PUBLIC_ORIGIN, DIRS, CHANNEL_ID } = require('../config');
const { loadData, saveData } = require('../services/dataService');

if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}
if (ffprobePath && ffprobePath.path) {
    ffmpeg.setFfprobePath(ffprobePath.path);
}

// Helpers
async function downloadTo(url, dest) {
    const proto = url.startsWith('https') ? require('https') : require('http');
    await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        proto.get(url, res => {
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', err => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

async function ffprobeDuration(p) {
    return await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(p, (err, d) => {
            if (err) reject(err); else resolve((d.format && d.format.duration) ? Math.ceil(d.format.duration) : 0);
        });
    });
}

function startMagicResultPoll(requestId, chatId, bot) {
    let tries = 0;
    const key = API_MARKET_KEY;
    const resultChatId = CHANNEL_ID || chatId;
    console.log(`[Faceswap] Starting poll for ${requestId} in chat ${chatId}, results to ${resultChatId}`);

    const poll = () => {
        tries++;
        const form = querystring.stringify({ request_id: String(requestId) });
        const reqOpts = { hostname: 'api.magicapi.dev', path: '/api/v1/capix/faceswap/result/', method: 'POST', headers: { 'x-magicapi-key': key, 'Content-Type': 'application/x-www-form-urlencoded', 'accept': 'application/json', 'Content-Length': Buffer.byteLength(form) } };

        const r = https.request(reqOpts, res2 => {
            let buf = '';
            res2.on('data', c => buf += c);
            res2.on('end', async () => {
                let j;
                try { j = JSON.parse(buf); } catch (_) { j = null; }
                const status = j && (j.status || j.state || j.result_status || '');
                console.log(`[Faceswap] Request ${requestId} status: ${status}`);

                if (status && /succeeded|successful|completed|done/i.test(String(status))) {
                    const out = j.output || j.result || j.url || j.image_url || j.video_url;
                    const url = Array.isArray(out) ? out[out.length - 1] : out;
                    if (resultChatId && url) {
                        try {
                            const dest = path.join(DIRS.outputs, `faceswap_${Date.now()}${path.extname(String(url)) || ''}`);
                            await downloadTo(String(url), dest);
                            try { await bot.telegram.sendVideo(resultChatId, { source: fs.createReadStream(dest) }); }
                            catch (_) { try { await bot.telegram.sendPhoto(resultChatId, { source: fs.createReadStream(dest) }); } catch (e2) { await bot.telegram.sendMessage(resultChatId, String(url)); } }
                        } catch (e) {
                            console.error('[Faceswap] Error sending result', e);
                        }
                    }
                } else if (status && /failed|error|canceled/i.test(String(status))) {
                    if (resultChatId) { try { await bot.telegram.sendMessage(resultChatId, 'Faceswap failed'); } catch (_) { } }
                } else {
                    if (tries < 40) setTimeout(poll, 3000);
                }
            });
        });
        r.on('error', () => { if (tries < 40) setTimeout(poll, 3000); });
        r.write(form);
        r.end();
    };
    if (key) setTimeout(poll, 2000);
}

// Logic
async function runFaceswap(u, photoPath, videoPath, chatId, bot) {
    let cost = 3;
    if (videoPath) {
        try {
            const duration = await ffprobeDuration(videoPath);
            cost = duration * 3;
        } catch (e) {
            console.error('Duration check failed', e);
            cost = 9; // Fallback
        }
    }

    const data = loadData();
    const user = data.users[u.id];
    if ((user.points || 0) < cost) return { error: 'not enough points', required: cost, points: user.points };

    user.points -= cost;
    saveData(data);

    if (!PUBLIC_ORIGIN) return { error: 'Server misconfigured: Missing PUBLIC_URL/PUBLIC_ORIGIN', required: 0, points: user.points };

    const base = PUBLIC_ORIGIN;
    const swapUrl = `${base}/uploads/${path.basename(photoPath)}`;
    const targetUrl = `${base}/uploads/${path.basename(videoPath || photoPath)}`;
    const key = API_MARKET_KEY;

    if (!key) return { error: 'Server misconfigured: missing API key', required: 0, points: user.points };

    const form = querystring.stringify({ target_url: targetUrl, swap_url: swapUrl });
    const pth = videoPath ? '/api/v1/capix/faceswap/faceswap/v1/video' : '/api/v1/capix/faceswap/faceswap/v1/image';
    const reqOpts = { hostname: 'api.magicapi.dev', path: pth, method: 'POST', headers: { 'x-magicapi-key': key, 'Content-Type': 'application/x-www-form-urlencoded', 'accept': 'application/json', 'Content-Length': Buffer.byteLength(form) } };

    try {
        const result = await new Promise((resolve, reject) => {
            const r = https.request(reqOpts, res2 => {
                let buf = '';
                res2.on('data', c => buf += c);
                res2.on('end', () => {
                    try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
                });
            });
            r.on('error', reject);
            r.write(form);
            r.end();
        });

        const requestId = result && (result.request_id || result.requestId || result.id);
        if (!requestId) {
            console.error('MagicAPI Error (No Request ID):', JSON.stringify(result, null, 2));
            return { error: 'MagicAPI submission failed: no request_id returned', required: 0, points: user.points };
        }

        startMagicResultPoll(String(requestId), String(chatId || ''), bot);
        return { started: true, points: user.points };
    } catch (e) {
        console.error('MagicAPI Request Failed:', e);
        return { error: 'API request failed', required: 0, points: user.points };
    }
}

async function runFaceswapImage(u, swapPhotoPath, targetPhotoPath, chatId, bot) {
    const cost = 9;
    const data = loadData();
    const user = data.users[u.id];

    if ((user.points || 0) < cost) return { error: 'not enough points', required: cost, points: user.points };

    user.points -= cost;
    saveData(data);

    const base = PUBLIC_ORIGIN;
    const swapUrl = base ? `${base}/uploads/${path.basename(swapPhotoPath)}` : '';
    const targetUrl = base ? `${base}/uploads/${path.basename(targetPhotoPath)}` : '';
    const key = API_MARKET_KEY;

    if (!base || !key) return { error: 'missing config', required: 0, points: user.points };

    const form = querystring.stringify({ target_url: targetUrl, swap_url: swapUrl });
    const reqOpts = { hostname: 'api.magicapi.dev', path: '/api/v1/capix/faceswap/faceswap/v1/image', method: 'POST', headers: { 'x-magicapi-key': key, 'Content-Type': 'application/x-www-form-urlencoded', 'accept': 'application/json', 'Content-Length': Buffer.byteLength(form) } };

    try {
        const result = await new Promise((resolve, reject) => {
            const r = https.request(reqOpts, res2 => {
                let buf = '';
                res2.on('data', c => buf += c);
                res2.on('end', () => {
                    try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
                });
            });
            r.on('error', reject);
            r.write(form);
            r.end();
        });

        const requestId = result && (result.request_id || result.requestId || result.id);
        if (!requestId) {
            console.error('MagicAPI Image Error (No Request ID):', JSON.stringify(result, null, 2));
            return { error: 'MagicAPI Image submission failed: no request_id returned', required: 0, points: user.points };
        }

        startMagicResultPoll(String(requestId), String(chatId || ''), bot);
        return { started: true, points: user.points };
    } catch (e) {
        console.error('MagicAPI Image Error:', e);
        return { error: 'submit error', required: 0, points: user.points };
    }
}

async function createVideo(u, photoPath, videoPath, chatId, bot) {
    const cost = 10;
    const data = loadData();
    const user = data.users[u.id];

    if ((user.points || 0) < cost) return { error: 'not enough points', required: cost, points: user.points };

    user.points -= cost;
    saveData(data);

    const outputPath = path.join(DIRS.outputs, `short-${Date.now()}.mp4`);

    ffmpeg(videoPath)
        .setDuration(10)
        .addInput(photoPath)
        .complexFilter('overlay=0:0')
        .save(outputPath)
        .on('end', async () => {
            try {
                await bot.telegram.sendVideo(chatId, { source: fs.createReadStream(outputPath) });
            } catch (e) {
                await bot.telegram.sendMessage(chatId, `Video ready at /outputs/${path.basename(outputPath)}`);
            }
        })
        .on('error', async (err) => {
            console.error('FFmpeg Error:', err);
            await bot.telegram.sendMessage(chatId, `Error: ${err.message}`);
        });

    return { started: true, points: user.points };
}

module.exports = {
    downloadTo,
    runFaceswap,
    runFaceswapImage,
    createVideo
};
