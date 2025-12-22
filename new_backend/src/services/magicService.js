const axios = require('axios');
const winston = require('winston');

const A2E_KEY = process.env.A2E_API_KEY;
const A2E_VIDEO_BASE = process.env.A2E_VIDEO_BASE || 'https://video.a2e.ai/api/v1';
const A2E_API_BASE = process.env.A2E_API_BASE || 'https://api.a2e.ai/api/v1';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

const startFaceSwap = async (faceUrl, videoUrl) => {
    const endpoint = `${A2E_VIDEO_BASE}/userFaceSwapTask/add`;
    const payload = { name: `faceswap_${Date.now()}`, face_url: faceUrl, video_url: videoUrl };
    const response = await axios.post(endpoint, payload, { headers: { Authorization: `Bearer ${A2E_KEY}` } });
    const json = response.data || {};
    const id = json?.data?._id || json?.id || json?.task_id;
    if (!id) throw new Error('No task id');
    logger.info('a2e_start', { type: 'faceswap', endpoint, status: response.status, id });
    return id;
};

const checkFaceSwapTaskStatus = async (taskId) => {
    let response;
    try {
        response = await axios.get(`${A2E_VIDEO_BASE}/userFaceSwapTask/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${A2E_KEY}` } });
    } catch (e) {
        response = await axios.get(`${A2E_VIDEO_BASE}/userFaceSwapTask/status`, { headers: { Authorization: `Bearer ${A2E_KEY}` }, params: { _id: taskId } });
    }
    const json = response.data || {};
    let rec = null;
    if (json && json.data) {
        if (Array.isArray(json.data)) rec = json.data.find(t => (t && (t._id || t.id || t.task_id)) === taskId);
        else if (typeof json.data === 'object') {
            const rid = json.data._id || json.data.id || json.data.task_id;
            rec = (!rid || rid === taskId) ? json.data : null;
        }
    } else if (json && (json._id || json.id || json.task_id)) {
        const rid = json._id || json.id || json.task_id;
        rec = (!rid || rid === taskId) ? json : null;
    }
    const status = rec && rec.current_status;
    const resultUrl = rec && rec.result_url;
    logger.info('a2e_status', { type: 'faceswap', endpoint: 'detail-or-status', id: taskId, status, ok: response.status });
    return { status, result_url: resultUrl };
};

const startFaceSwapPreview = async (faceUrl, videoUrl) => {
    const endpoint = `${A2E_VIDEO_BASE}/userFaceSwapPreview/add`;
    const payload = { face_url: faceUrl, video_url: videoUrl };
    const response = await axios.post(endpoint, payload, { headers: { Authorization: `Bearer ${A2E_KEY}` } });
    const json = response.data || {};
    const id = json?.data?._id || json?.id || json?.task_id;
    if (!id) throw new Error('No preview id');
    logger.info('a2e_start', { type: 'faceswap_preview', endpoint, status: response.status, id });
    return id;
};

const checkFaceSwapPreviewStatus = async (previewId) => {
    const endpoint = `${A2E_VIDEO_BASE}/userFaceSwapPreview/status`;
    const response = await axios.get(endpoint, { headers: { Authorization: `Bearer ${A2E_KEY}` }, params: { _id: previewId } });
    const json = response.data || {};
    let rec = null;
    if (json && json.data) {
        if (Array.isArray(json.data)) rec = json.data.find(t => (t && (t._id || t.id || t.task_id)) === previewId);
        else if (typeof json.data === 'object') {
            const rid = json.data._id || json.data.id || json.data.task_id;
            rec = (!rid || rid === previewId) ? json.data : null;
        }
    } else if (json && (json._id || json.id || json.task_id)) {
        const rid = json._id || json.id || json.task_id;
        rec = (!rid || rid === previewId) ? json : null;
    }
    const status = rec && rec.current_status;
    const resultUrl = rec && rec.result_url;
    logger.info('a2e_status', { type: 'faceswap_preview', endpoint, id: previewId, status, ok: response.status });
    return { status, result_url: resultUrl };
};

const startImage2Video = async (imageUrl, prompt) => {
    const endpoint = `${A2E_VIDEO_BASE}/userImage2Video/start`;
    const payload = { name: `image2video_${Date.now()}`, image_url: imageUrl, prompt };
    const response = await axios.post(endpoint, payload, { headers: { Authorization: `Bearer ${A2E_KEY}` } });
    const json = response.data || {};
    const id = json?.data?._id || json?.id || json?.task_id;
    if (!id) throw new Error('No task id');
    const bodyPreview = (() => {
        try { return JSON.stringify(json).slice(0, 300); } catch (_) { return '[unserializable]'; }
    })();
    logger.info('a2e_start', { type: 'image2video', endpoint, status: response.status, id, body: bodyPreview, payload: { image_url: imageUrl, prompt } });
    return id;
};

const checkImage2VideoStatus = async (taskId) => {
    // Provider has routed status under the video host; api host may return docs HTML
    const endpoint = `${A2E_VIDEO_BASE}/userImage2Video/${encodeURIComponent(taskId)}`;
    try {
        const response = await axios.get(endpoint, { headers: { Authorization: `Bearer ${A2E_KEY}` }, responseType: 'json', validateStatus: () => true });
        const raw = response.data;
        const isHtml = typeof raw === 'string' && /<\/?html/i.test(raw);
        const bodyPreview = (() => {
            try { return (typeof raw === 'string' ? raw : JSON.stringify(raw)).slice(0, 300); } catch (_) { return '[unserializable]'; }
        })();
        logger.info('a2e_poll', { type: 'image2video', endpoint, id: taskId, http: response.status, body: bodyPreview });
        if (isHtml) {
            return { status: 'provider_error_html', result_url: null, error: 'Unexpected HTML 404 from provider' };
        }
        if (response.status >= 500) {
            return { status: 'server_error', result_url: null, error: `HTTP ${response.status}` };
        }
        if (response.status === 404) {
            return { status: 'not_found', result_url: null, error: 'Task not found' };
        }
        if (response.status >= 400) {
            return { status: 'bad_request', result_url: null, error: `HTTP ${response.status}` };
        }
        const json = raw || {};
        const data = json && (json.data || json);
        const status = data && data.current_status;
        const resultUrl = data && data.result_url;
        return { status, result_url: resultUrl };
    } catch (e) {
        const msg = e && e.message ? e.message : 'Unknown error';
        logger.error('a2e_poll_error', { type: 'image2video', endpoint, id: taskId, error: msg });
        throw e;
    }
};

module.exports = {
    startFaceSwap,
    checkFaceSwapTaskStatus,
    startFaceSwapPreview,
    checkFaceSwapPreviewStatus,
    startImage2Video,
    checkImage2VideoStatus
};
