const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const downloadTo = (url, dest) => {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(dest);
        proto.get(url, res => {
            if (res.statusCode !== 200) {
                fs.unlink(dest, () => {}); // Async unlink, don't wait
                return reject(new Error(`Status Code: ${res.statusCode}`));
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(dest);
            });
        }).on('error', err => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
};

const downloadBuffer = (url) => {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        proto.get(url, res => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Status Code: ${res.statusCode}`));
            }
            const data = [];
            res.on('data', chunk => data.push(chunk));
            res.on('end', () => resolve(Buffer.concat(data)));
        }).on('error', err => reject(err));
    });
};

const cleanupFile = (filePath) => {
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
        console.error('Cleanup failed:', e.message);
    }
};

module.exports = { downloadTo, downloadBuffer, cleanupFile };
