const axios = require('axios');
const winston = require('winston');

const API_KEY = process.env.MAGICAPI_KEY || process.env.API_MARKET_KEY;
const BASE_URL = 'https://api.magicapi.dev/api/v1/magicapi/faceswap-v2/faceswap';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'magic-api.log' })
    ]
});

const startFaceSwap = async (swapUrl, targetUrl, isVideo = false) => {
    const endpoint = isVideo ? `${BASE_URL}/video/run` : `${BASE_URL}/image/run`;
    const payload = {
        input: {
            swap_image: swapUrl,
            [isVideo ? 'target_video' : 'target_image']: targetUrl
        }
    };

    try {
        logger.info(`Starting FaceSwap: ${isVideo ? 'Video' : 'Image'}`, { swapUrl, targetUrl });
        const response = await axios.post(endpoint, payload, {
            headers: {
                'x-magicapi-key': API_KEY,
                'Content-Type': 'application/json'
            }
        });
        
        const requestId = response.data.request_id || response.data.requestId || response.data.id;
        if (!requestId) {
            throw new Error('No Request ID returned from API');
        }
        return requestId;
    } catch (error) {
        logger.error('FaceSwap Start Failed', { error: error.message, data: error.response?.data });
        throw error;
    }
};

const checkStatus = async (requestId, isVideo = false) => {
    const endpoint = `${BASE_URL}/${isVideo ? 'video' : 'image'}/status/${requestId}`;
    
    try {
        const response = await axios.get(endpoint, {
            headers: {
                'x-magicapi-key': API_KEY
            }
        });
        return response.data;
    } catch (error) {
        logger.error('FaceSwap Status Check Failed', { requestId, error: error.message });
        throw error;
    }
};

module.exports = {
    startFaceSwap,
    checkStatus
};
