const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../server.js');
let code = fs.readFileSync(target, 'utf8');

const startMarker = '\n// --- MagicAPI Integration ---';
const botLogicMarker = '\n// --- Bot Logic ---';

const startIdx = code.indexOf(startMarker);
const botIdx = code.indexOf(botLogicMarker);
if (startIdx === -1 || botIdx === -1) {
  console.error('Markers not found');
  process.exit(1);
}

const head = code.slice(0, startIdx + startMarker.length);
const tail = code.slice(botIdx);

const segment = `
async function getFileUrl(ctx, fileId, localPath) {
  if (PUBLIC_BASE) return \`${PUBLIC_BASE}/uploads/${path.basename(localPath)}\`;
  try {
    const link = await ctx.telegram.getFileLink(fileId);
    return link.href;
  } catch (e) {
    console.error('Failed to get telegram link', e);
    return null;
  }
}

async function ack(ctx, text) {
  if (ctx && ctx.updateType === 'callback_query') {
    try { await ctx.answerCbQuery(text || 'Processing…'); } catch (_) {}
  }
}

async function runFaceswap(ctx, u, swapPath, targetPath, swapFileId, targetFileId, isVideo) {
  const cost = isVideo ? 9 : 9;
  const user = DB.users[u.id];
  if ((user.points || 0) < cost) return { error: 'not enough points', required: cost, points: user.points };

  adjustPoints(u.id, -cost, 'faceswap_start', { isVideo });

  const swapUrl = await getFileUrl(ctx, swapFileId, swapPath);
  const targetUrl = await getFileUrl(ctx, targetFileId, targetPath);

  if (!swapUrl || !targetUrl) {
    adjustPoints(u.id, cost, 'faceswap_refund_urls_failed', { isVideo });
    return { error: 'Failed to generate file URLs.', points: user.points };
  }

  const key = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;
  if (!key) return { error: 'Server config error', points: user.points };

  const endpoint = isVideo 
    ? '/api/v1/capix/faceswap/faceswap/v1/video'
    : '/api/v1/capix/faceswap/faceswap/v1/image';

  const form = querystring.stringify({ target_url: targetUrl, swap_url: swapUrl });
  const reqOpts = {
    hostname: 'api.magicapi.dev',
    path: endpoint,
    method: 'POST',
    headers: {
      'x-magicapi-key': key,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(form)
    }
  };

  try {
    const result = await new Promise((resolve, reject) => {
      const r = https.request(reqOpts, res => {
        let buf = '';
        res.on('data', c => buf+=c);
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch(e) { reject(e); }
        });
      });
      r.on('error', reject);
      r.write(form);
      r.end();
    });

    const requestId = result && (result.request_id || result.requestId || result.id);
    if (!requestId) {
      adjustPoints(u.id, cost, 'faceswap_refund_api_error', { isVideo });
      console.error('MagicAPI Error', result);
      return { error: 'API Error: ' + (result.message || JSON.stringify(result)), points: user.points };
    }

    if (!DB.pending_swaps) DB.pending_swaps = {};
    DB.pending_swaps[requestId] = {
      chatId: ctx.chat.id,
      userId: u.id,
      startTime: Date.now(),
      isVideo: isVideo,
      status: 'processing'
    };
    saveDB();

    pollMagicResult(requestId, ctx.chat.id);
    return { started: true, points: user.points, requestId };

  } catch (e) {
    adjustPoints(u.id, cost, 'faceswap_refund_network_error', { isVideo });
    return { error: 'Network Error: ' + e.message, points: user.points };
  }
}

function pollMagicResult(requestId, chatId) {
  let tries = 0;
  const key = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;

  const poll = () => {
    tries++;
    if (tries > 60) {
       bot.telegram.sendMessage(chatId, 'Task timed out. Please contact support.').catch(()=>{});
       if (DB.pending_swaps[requestId]) { delete DB.pending_swaps[requestId]; saveDB(); }
       return;
    }

    const form = querystring.stringify({ request_id: requestId });
    const req = https.request({
      hostname: 'api.magicapi.dev',
      path: '/api/v1/capix/faceswap/result/',
      method: 'POST',
      headers: { 'x-magicapi-key': key, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) }
    }, res => {
      let buf=''; res.on('data', c=>buf+=c); res.on('end', async () => {
        try {
          const j = JSON.parse(buf);
          const status = (j.status || j.state || '').toLowerCase();
          if (status.includes('success') || status.includes('done')) {
            const outUrl = j.output || j.result || j.url || j.image_url || j.video_url;
            const finalUrl = Array.isArray(outUrl) ? outUrl[outUrl.length-1] : outUrl;
            if (finalUrl) {
              const dest = path.join(outputsDir, \`result_${Date.now()}.${finalUrl.split('.').pop() || 'dat'}\`);
              await downloadTo(finalUrl, dest);
              if (dest.endsWith('mp4')) await bot.telegram.sendVideo(chatId, { source: fs.createReadStream(dest) });
              else await bot.telegram.sendPhoto(chatId, { source: fs.createReadStream(dest) });
            } else {
               bot.telegram.sendMessage(chatId, 'Success, but no output URL found.').catch(()=>{});
            }
            if (DB.pending_swaps[requestId]) { delete DB.pending_swaps[requestId]; saveDB(); }
          } else if (status.includes('fail') || status.includes('error')) {
            bot.telegram.sendMessage(chatId, \`Task failed: ${j.error || status}\`).catch(()=>{});
            if (DB.pending_swaps[requestId]) { delete DB.pending_swaps[requestId]; saveDB(); }
          } else {
            setTimeout(poll, 3000);
          }
        } catch (e) { setTimeout(poll, 3000); }
      });
    });
    req.on('error', () => setTimeout(poll, 3000));
    req.write(form);
    req.end();
  };
  setTimeout(poll, 2000);
}

// Resume polling for any swaps that were left pending
setTimeout(() => {
  const pendingIds = Object.keys(DB.pending_swaps || {});
  if (pendingIds.length > 0) {
    console.log(\`Recovering ${pendingIds.length} pending swaps...\`);
    pendingIds.forEach(rid => {
      const job = DB.pending_swaps[rid];
      if (job && job.chatId) {
        console.log(\`Resuming poll for job ${rid} (Chat ${job.chatId})\`);
        pollMagicResult(rid, job.chatId);
      }
    });
  }
}, 1000);
`;

code = head + '\n' + segment + tail;
fs.writeFileSync(target, code);
console.log('Rebuilt segment in', target);
