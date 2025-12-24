const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static');
const { callA2eApi } = require('./a2eClient');

if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}
if (ffprobePath && ffprobePath.path) {
    ffmpeg.setFfprobePath(ffprobePath.path);
}

// Validation constants
const MAX_HEAD_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const MIN_DIMENSION = 300;
const MAX_DIMENSION = 5000;
const MAX_VIDEO_DURATION_SECONDS = 15;

function getMediaInfo(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata);
        });
    });
}

function validateHeadImage(filePath) {
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_HEAD_SIZE_BYTES) {
        return { valid: false, reason: 'File size exceeds 20MB limit.' };
    }

    return getMediaInfo(filePath).then(metadata => {
        const stream = metadata.streams.find(s => s.codec_type === 'video' || s.codec_type === 'image'); // ffprobe reports images as video streams usually
        if (!stream) return { valid: false, reason: 'Not a valid image file.' };

        const { width, height } = stream;
        if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
            return { valid: false, reason: `Image too small. Minimum dimension is ${MIN_DIMENSION}px.` };
        }
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            return { valid: false, reason: `Image too large. Maximum dimension is ${MAX_DIMENSION}px.` };
        }
        return { valid: true };
    }).catch(err => {
        console.error('Validation error:', err);
        return { valid: false, reason: 'Could not validate image file.' };
    });
}

function validateTargetMedia(filePath) {
    // Basic file extension check handled by bot before calling this, but we can double check
    return getMediaInfo(filePath).then(metadata => {
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        if (!videoStream) {
            // Maybe it's an image
            const imageStream = metadata.streams.find(s => s.codec_type === 'video' || s.codec_type === 'image'); // for images
            if (imageStream) return { valid: true, type: 'image' };
            return { valid: false, reason: 'No video or image stream found.' };
        }

        const duration = metadata.format.duration;
        if (duration && duration > MAX_VIDEO_DURATION_SECONDS + 1) { // +1 tolerance
            return { valid: false, reason: `Video is too long (${Math.round(duration)}s). Max 15 seconds.` };
        }

        return { valid: true, type: 'video', duration };
    }).catch(err => {
        console.error('Validation error:', err);
        return { valid: false, reason: 'Could not validate media file.' };
    });
}

async function startHeadSwapTask(headUrl, targetUrl, taskName) {
    const payload = {
        name: taskName,
        face_url: headUrl,
        target_url: targetUrl
    };

    // Using the endpoint from server.js reference
    // /userHeadSwapTask/add
    const result = await callA2eApi('/userHeadSwapTask/add', 'POST', payload);

    // Check A2E response code
    if (result.code !== 0) {
        throw new Error(result.data?.failed_message || result.message || 'Head Swap API request failed');
    }

    return {
        taskId: result.data._id || result.data.id,
        status: result.data.current_status
    };
}

async function checkHeadSwapStatus(taskId) {
    // /userHeadSwapTask/status?_id=...
    // Or just /userHeadSwapTask/status and filter?
    // server.js used: /userHeadSwapTask/status then find.
    // Ideally we can pass _id. Let's try passing _id query param if supported, otherwise fetch all.
    // Based on server.js: result = await callA2eApi('/userHeadSwapTask/status', 'GET'); then find.
    // Optimizing: Many APIs support ?_id=
    // I'll try to find specific task.

    let result;
    try {
        result = await callA2eApi('/userHeadSwapTask/status', 'GET');
    } catch (e) {
        throw new Error('Failed to check status');
    }

    if (!result || !result.data) return { status: 'UNKNOWN' };

    let task;
    if (Array.isArray(result.data)) {
        task = result.data.find(t => t._id === taskId);
    } else if (result.data._id === taskId) {
        task = result.data;
    }

    if (!task) return { status: 'NOT_FOUND' };

    return {
        status: task.current_status,
        resultUrl: task.result_url,
        error: task.failed_message
    };
}

module.exports = {
    validateHeadImage,
    validateTargetMedia,
    startHeadSwapTask,
    checkHeadSwapStatus
};
