"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.A2E_API_KEY = exports.A2E_API_RESOURCE_BASE = void 0;
exports.startImage2Video = startImage2Video;
exports.checkImage2VideoStatus = checkImage2VideoStatus;
exports.A2E_API_RESOURCE_BASE = process.env.A2E_API_RESOURCE_BASE || 'https://video.a2e.ai/api/v1';
exports.A2E_API_KEY = process.env.A2E_API_KEY || '';
async function startImage2Video(payload) {
    const res = await fetch(`${exports.A2E_API_RESOURCE_BASE}/userImage2Video/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${exports.A2E_API_KEY}` },
        body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    }
    catch { }
    if (!res.ok)
        throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`);
    const id = json?.data?._id || json?.id || json?.task_id;
    if (!id)
        throw new Error('No task id');
    return { taskId: id };
}
async function checkImage2VideoStatus(taskId) {
    const endpoint = `${exports.A2E_API_RESOURCE_BASE}/userImage2Video/${encodeURIComponent(taskId)}`;
    const res = await fetch(endpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${exports.A2E_API_KEY}`, Accept: 'application/json' },
    });
    const text = await res.text();
    const isHtml = /<\/?html/i.test(text);
    if (isHtml)
        return { status: 'provider_error_html', error: 'HTML 404' };
    if (res.status >= 500)
        return { status: 'server_error', error: `HTTP ${res.status}` };
    if (res.status === 404)
        return { status: 'not_found', error: text.slice(0, 300) };
    if (!res.ok)
        return { status: 'bad_request', error: text.slice(0, 300) };
    let json = null;
    try {
        json = JSON.parse(text);
    }
    catch { }
    const data = (json && json.data) || json;
    const s = (data && data.current_status) || '';
    if (s === 'completed') {
        return { status: 'completed', result_url: data.result_url || null };
    }
    if (s === 'failed' || s === 'error') {
        return { status: 'failed', error: data.failed_message || '' };
    }
    return { status: 'processing' };
}
