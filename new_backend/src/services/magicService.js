const axios = require('axios');
const winston = require('winston');

const A2E_KEY = process.env.A2E_API_KEY;
const A2E_API_RESOURCE_BASE = process.env.A2E_API_RESOURCE_BASE || 'https://video.a2e.ai/api/v1';
const A2E_API_BASE = process.env.A2E_API_BASE || 'https://api.a2e.ai/api/v1';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

// ==================== FACE SWAP ====================
const startFaceSwap = async (faceUrl, videoUrl) => {
    const endpoint = `${A2E_API_RESOURCE_BASE}/userFaceSwapTask/add`;
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
        response = await axios.get(`${A2E_API_RESOURCE_BASE}/userFaceSwapTask/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${A2E_KEY}` } });
    } catch (e) {
        response = await axios.get(`${A2E_API_RESOURCE_BASE}/userFaceSwapTask/status`, { headers: { Authorization: `Bearer ${A2E_KEY}` }, params: { _id: taskId } });
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
    const endpoint = `${A2E_API_RESOURCE_BASE}/userFaceSwapPreview/add`;
    const payload = { face_url: faceUrl, video_url: videoUrl };
    const response = await axios.post(endpoint, payload, { headers: { Authorization: `Bearer ${A2E_KEY}` } });
    const json = response.data || {};
    const id = json?.data?._id || json?.id || json?.task_id;
    if (!id) throw new Error('No preview id');
    logger.info('a2e_start', { type: 'faceswap_preview', endpoint, status: response.status, id });
    return id;
};

const checkFaceSwapPreviewStatus = async (previewId) => {
    const endpoint = `${A2E_API_RESOURCE_BASE}/userFaceSwapPreview/status`;
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

// ==================== IMAGE TO VIDEO ====================
const startImage2Video = async (imageUrl, prompt) => {
    const endpoint = `${A2E_API_RESOURCE_BASE}/userImage2Video/start`;
    const payload = { name: `image2video_${Date.now()}`, image_url: imageUrl, prompt };
    const response = await axios.post(endpoint, payload, { headers: { Authorization: `Bearer ${A2E_KEY}` } });
    const json = response.data || {};
    const id = json?.data?._id || json?.id || json?.task_id;
    if (!id) throw new Error('No task id');
    logger.info('a2e_start', { type: 'image2video', endpoint, status: response.status, id, payload: { image_url: imageUrl, prompt } });
    return id;
};

const checkImage2VideoStatus = async (taskId) => {
    const endpoint = `${A2E_API_RESOURCE_BASE}/userImage2Video/${encodeURIComponent(taskId)}`;
    try {
        const response = await axios.get(endpoint, { 
            headers: { Authorization: `Bearer ${A2E_KEY}` }, 
            responseType: 'json', 
            validateStatus: () => true 
        });
        const raw = response.data;
        const isHtml = typeof raw === 'string' && /<\/?html/i.test(raw);
        
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
        const curr = data && data.current_status;
        const resultUrl = data && data.result_url;

        let mapped = 'processing';
        if (curr === 'completed') mapped = 'completed';
        else if (curr === 'failed' || curr === 'error') mapped = 'failed';
        else if (curr === 'processing' || curr === 'initialized' || curr === 'sent' || curr === 'in_progress' || curr === 'queued' || curr === 'pending') mapped = 'processing';
        
        logger.info('status_map', { type: 'image2video', id: taskId, current_status: curr, mapped_status: mapped });
        return { status: mapped, result_url: resultUrl };
    } catch (e) {
        logger.error('a2e_poll_error', { type: 'image2video', endpoint, id: taskId, error: e.message });
        throw e;
    }
};

// ==================== TALKING AVATAR ====================
const startTalkingAvatar = async (imageUrl, audioUrl, text = null) => {
    const endpoint = `${A2E_API_BASE}/talking-avatar/create`;
    const payload = { 
        name: `avatar_${Date.now()}`, 
        image_url: imageUrl,
        ...(audioUrl ? { audio_url: audioUrl } : {}),
        ...(text ? { text: text, voice: 'en-US-Standard-A' } : {})
    };
    
    try {
        const response = await axios.post(endpoint, payload, { 
            headers: { Authorization: `Bearer ${A2E_KEY}`, 'Content-Type': 'application/json' } 
        });
        const json = response.data || {};
        const id = json?.data?._id || json?.data?.id || json?.id || json?.task_id;
        if (!id) throw new Error('No task id returned');
        logger.info('a2e_start', { type: 'talking_avatar', endpoint, status: response.status, id });
        return id;
    } catch (e) {
        // Try alternate endpoint
        const altEndpoint = `${A2E_API_RESOURCE_BASE}/userTalkingPhoto/add`;
        const response = await axios.post(altEndpoint, payload, { 
            headers: { Authorization: `Bearer ${A2E_KEY}`, 'Content-Type': 'application/json' } 
        });
        const json = response.data || {};
        const id = json?.data?._id || json?.data?.id || json?.id || json?.task_id;
        if (!id) throw new Error('No task id returned');
        logger.info('a2e_start', { type: 'talking_avatar', endpoint: altEndpoint, status: response.status, id });
        return id;
    }
};

const checkTalkingAvatarStatus = async (taskId) => {
    const endpoints = [
        `${A2E_API_BASE}/talking-avatar/${encodeURIComponent(taskId)}`,
        `${A2E_API_RESOURCE_BASE}/userTalkingPhoto/${encodeURIComponent(taskId)}`
    ];
    
    for (const endpoint of endpoints) {
        try {
            const response = await axios.get(endpoint, { 
                headers: { Authorization: `Bearer ${A2E_KEY}` },
                validateStatus: () => true
            });
            
            if (response.status === 404) continue;
            
            const json = response.data || {};
            const data = json.data || json;
            const status = data.current_status || data.status;
            const resultUrl = data.result_url || data.video_url;
            
            let mapped = 'processing';
            if (status === 'completed' || status === 'success') mapped = 'completed';
            else if (status === 'failed' || status === 'error') mapped = 'failed';
            
            logger.info('a2e_status', { type: 'talking_avatar', id: taskId, status: mapped });
            return { status: mapped, result_url: resultUrl };
        } catch (e) {
            continue;
        }
    }
    return { status: 'processing', result_url: null };
};

// ==================== VIDEO ENHANCEMENT ====================
const startVideoEnhancement = async (videoUrl, targetResolution = '4k') => {
    const endpoint = `${A2E_API_RESOURCE_BASE}/userVideoEnhance/add`;
    const payload = { 
        name: `enhance_${Date.now()}`, 
        video_url: videoUrl,
        target_resolution: targetResolution
    };
    
    try {
        const response = await axios.post(endpoint, payload, { 
            headers: { Authorization: `Bearer ${A2E_KEY}`, 'Content-Type': 'application/json' } 
        });
        const json = response.data || {};
        const id = json?.data?._id || json?.data?.id || json?.id || json?.task_id;
        if (!id) throw new Error('No task id returned');
        logger.info('a2e_start', { type: 'video_enhance', endpoint, status: response.status, id });
        return id;
    } catch (e) {
        logger.error('video_enhance_error', { error: e.message });
        throw e;
    }
};

const checkVideoEnhancementStatus = async (taskId) => {
    const endpoint = `${A2E_API_RESOURCE_BASE}/userVideoEnhance/${encodeURIComponent(taskId)}`;
    try {
        const response = await axios.get(endpoint, { 
            headers: { Authorization: `Bearer ${A2E_KEY}` },
            validateStatus: () => true
        });
        
        const json = response.data || {};
        const data = json.data || json;
        const status = data.current_status || data.status;
        const resultUrl = data.result_url || data.enhanced_url;
        
        let mapped = 'processing';
        if (status === 'completed' || status === 'success') mapped = 'completed';
        else if (status === 'failed' || status === 'error') mapped = 'failed';
        
        logger.info('a2e_status', { type: 'video_enhance', id: taskId, status: mapped });
        return { status: mapped, result_url: resultUrl };
    } catch (e) {
        logger.error('a2e_poll_error', { type: 'video_enhance', id: taskId, error: e.message });
        return { status: 'processing', result_url: null };
    }
};

// ==================== BACKGROUND REMOVAL ====================
const startBackgroundRemoval = async (imageUrl) => {
    const endpoint = `${A2E_API_BASE}/background/remove`;
    const payload = { 
        name: `bgremove_${Date.now()}`, 
        image_url: imageUrl
    };
    
    try {
        const response = await axios.post(endpoint, payload, { 
            headers: { Authorization: `Bearer ${A2E_KEY}`, 'Content-Type': 'application/json' } 
        });
        const json = response.data || {};
        
        // Background removal might return result directly
        if (json.data?.result_url || json.result_url) {
            return { 
                id: `instant_${Date.now()}`, 
                instant: true, 
                result_url: json.data?.result_url || json.result_url 
            };
        }
        
        const id = json?.data?._id || json?.data?.id || json?.id || json?.task_id;
        if (!id) throw new Error('No task id returned');
        logger.info('a2e_start', { type: 'bg_removal', endpoint, status: response.status, id });
        return { id, instant: false };
    } catch (e) {
        // Try alternate endpoint
        const altEndpoint = `${A2E_API_RESOURCE_BASE}/userBackgroundRemove/add`;
        const response = await axios.post(altEndpoint, payload, { 
            headers: { Authorization: `Bearer ${A2E_KEY}`, 'Content-Type': 'application/json' } 
        });
        const json = response.data || {};
        const id = json?.data?._id || json?.data?.id || json?.id || json?.task_id;
        if (!id) throw new Error('No task id returned');
        logger.info('a2e_start', { type: 'bg_removal', endpoint: altEndpoint, status: response.status, id });
        return { id, instant: false };
    }
};

const checkBackgroundRemovalStatus = async (taskId) => {
    const endpoints = [
        `${A2E_API_BASE}/background/${encodeURIComponent(taskId)}`,
        `${A2E_API_RESOURCE_BASE}/userBackgroundRemove/${encodeURIComponent(taskId)}`
    ];
    
    for (const endpoint of endpoints) {
        try {
            const response = await axios.get(endpoint, { 
                headers: { Authorization: `Bearer ${A2E_KEY}` },
                validateStatus: () => true
            });
            
            if (response.status === 404) continue;
            
            const json = response.data || {};
            const data = json.data || json;
            const status = data.current_status || data.status;
            const resultUrl = data.result_url || data.image_url;
            
            let mapped = 'processing';
            if (status === 'completed' || status === 'success') mapped = 'completed';
            else if (status === 'failed' || status === 'error') mapped = 'failed';
            
            logger.info('a2e_status', { type: 'bg_removal', id: taskId, status: mapped });
            return { status: mapped, result_url: resultUrl };
        } catch (e) {
            continue;
        }
    }
    return { status: 'processing', result_url: null };
};

module.exports = {
    // Face Swap
    startFaceSwap,
    checkFaceSwapTaskStatus,
    startFaceSwapPreview,
    checkFaceSwapPreviewStatus,
    // Image to Video
    startImage2Video,
    checkImage2VideoStatus,
    // Talking Avatar
    startTalkingAvatar,
    checkTalkingAvatarStatus,
    // Video Enhancement
    startVideoEnhancement,
    checkVideoEnhancementStatus,
    // Background Removal
    startBackgroundRemoval,
    checkBackgroundRemovalStatus
};
