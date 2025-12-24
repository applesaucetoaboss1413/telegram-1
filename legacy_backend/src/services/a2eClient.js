const fetch = require('node-fetch');
const { A2E_API_KEY } = require('../config');

const BASE_URL = 'https://video.a2e.ai/api/v1';

async function callA2eApi(endpoint, method = 'GET', body = null) {
    if (!A2E_API_KEY) {
        throw new Error('A2E_API_KEY is not configured');
    }

    const url = `${BASE_URL}${endpoint}`;
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${A2E_API_KEY}`
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`A2E API Error ${response.status}: ${text}`);
        }
        return await response.json();
    } catch (error) {
        console.error('A2E API Call Failed:', error);
        throw error;
    }
}

module.exports = {
    callA2eApi
};
