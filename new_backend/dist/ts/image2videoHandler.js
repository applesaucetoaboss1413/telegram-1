"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runImage2VideoFlow = runImage2VideoFlow;
const a2eClient_1 = require("./a2eClient");
async function runImage2VideoFlow(imageUrl, prompt, onProgress, maxMs = 120000) {
    const payload = { name: `image2video_${Date.now()}`, image_url: imageUrl, prompt };
    onProgress('We’re checking your video. This can take up to 120 seconds…');
    const { taskId } = await (0, a2eClient_1.startImage2Video)(payload);
    const started = Date.now();
    let delay = 2000;
    while (Date.now() - started < maxMs) {
        const res = await (0, a2eClient_1.checkImage2VideoStatus)(taskId);
        if (res.status === 'completed')
            return res.result_url || '';
        if (res.status === 'failed')
            throw new Error(res.error || 'Provider failed');
        if (res.status === 'provider_error_html')
            throw new Error('The video provider returned an unexpected error. Your request did not complete; please try again in a few minutes.');
        if (res.status === 'server_error') {
            await new Promise(r => setTimeout(r, delay));
            delay = Math.min(15000, delay * 2);
            continue;
        }
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(15000, delay * 2);
    }
    throw new Error('Timed out while waiting for the provider');
}
