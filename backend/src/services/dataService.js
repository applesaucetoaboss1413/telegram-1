const fs = require('fs');
const { DIRS } = require('../config');

// Ensure directory exists - handle permission errors gracefully
try {
    const dir = require('path').dirname(DIRS.data);
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (mkdirErr) {
            // Permission denied on /data - this is OK, we'll use the file path as-is
            console.warn(`[DataService] Could not create directory ${dir}:`, mkdirErr.message);
        }
    }
} catch (e) {
    console.error('[DataService] Directory init error:', e.message);
}

function loadData() {
    try {
        if (!fs.existsSync(DIRS.data)) return { users: {}, purchases: {}, channel: {} };
        const raw = fs.readFileSync(DIRS.data, 'utf8');
        const data = JSON.parse(raw);
        if (!data.users) data.users = {};
        if (!data.purchases) data.purchases = {};
        if (!data.channel) data.channel = {};
        return data;
    } catch (e) {
        console.error('loadData error:', e);
        return { users: {}, purchases: {}, channel: {} };
    }
}

function saveData(data) {
    try {
        fs.writeFileSync(DIRS.data, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('saveData error:', e);
    }
}

function getUser(id) {
    const data = loadData();
    return data.users[id];
}

function updateUser(id, updates) {
    const data = loadData();
    if (!data.users[id]) {
        data.users[id] = {
            id,
            points: 9,
            created_at: Date.now(),
            ...updates
        };
    } else {
        Object.assign(data.users[id], updates);
    }
    saveData(data);
    return data.users[id];
}

function getOrCreateUser(id, defaults = {}) {
    const data = loadData();
    if (!data.users[id]) {
        data.users[id] = {
            id,
            points: 9, // Start with 9 points
            created_at: Date.now(),
            ...defaults
        };
        saveData(data);
    }
    return data.users[id];
}

module.exports = {
    loadData,
    saveData,
    getUser,
    updateUser,
    getOrCreateUser
};
