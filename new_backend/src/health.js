const os = require('os');
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const Database = require('better-sqlite3');

class HealthMonitor {
    constructor() {
        this.startTime = Date.now();
        this.checks = new Map();
        this.alerts = [];
    }

    async checkTelegramAPI() {
        try {
            const token = process.env.BOT_TOKEN;
            if (!token) {
                throw new Error('BOT_TOKEN not configured');
            }

            const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
            const data = await response.json();
            
            return {
                status: data.ok ? 'healthy' : 'unhealthy',
                responseTime: Date.now(),
                botUsername: data.result?.username,
                error: data.ok ? null : data.description
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                responseTime: Date.now(),
                error: error.message
            };
        }
    }

    async checkDatabase() {
        try {
            const dbPath = path.join(__dirname, '..', 'data', 'faceswap.db');
            const db = new Database(dbPath);
            
            // Test query
            const stmt = db.prepare('SELECT COUNT(*) as count FROM users');
            const result = stmt.get();
            
            db.close();
            
            return {
                status: 'healthy',
                responseTime: Date.now(),
                userCount: result.count,
                dbSize: fs.statSync(dbPath).size
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                responseTime: Date.now(),
                error: error.message
            };
        }
    }

    checkSystemResources() {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        return {
            status: 'healthy',
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            memory: {
                rss: Math.round(memUsage.rss / 1024 / 1024),
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                external: Math.round(memUsage.external / 1024 / 1024)
            },
            system: {
                loadAvg: os.loadavg(),
                freeMem: Math.round(os.freemem() / 1024 / 1024),
                totalMem: Math.round(os.totalmem() / 1024 / 1024)
            }
        };
    }

    async checkFaceDetection() {
        try {
            const { detectFaces } = require('./services/faceService');
            
            // Test with a simple image buffer
            const testBuffer = Buffer.from('test');
            const result = await detectFaces(testBuffer);
            
            return {
                status: 'healthy',
                responseTime: Date.now(),
                modelLoaded: true
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                responseTime: Date.now(),
                error: error.message
            };
        }
    }

    async checkStripe() {
        try {
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
            
            // Test Stripe connectivity
            const balance = await stripe.balance.retrieve();
            
            return {
                status: 'healthy',
                responseTime: Date.now(),
                availableBalance: balance.available,
                pendingBalance: balance.pending
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                responseTime: Date.now(),
                error: error.message
            };
        }
    }

    async runAllChecks() {
        const results = {
            timestamp: new Date().toISOString(),
            overall: 'healthy',
            checks: {}
        };

        // Run all health checks
        const checks = [
            { name: 'telegram', check: () => this.checkTelegramAPI() },
            { name: 'database', check: () => this.checkDatabase() },
            { name: 'system', check: () => this.checkSystemResources() },
            { name: 'face_detection', check: () => this.checkFaceDetection() },
            { name: 'stripe', check: () => this.checkStripe() }
        ];

        for (const { name, check } of checks) {
            try {
                results.checks[name] = await check();
                if (results.checks[name].status === 'unhealthy') {
                    results.overall = 'unhealthy';
                }
            } catch (error) {
                results.checks[name] = {
                    status: 'error',
                    error: error.message,
                    responseTime: Date.now()
                };
                results.overall = 'unhealthy';
            }
        }

        return results;
    }

    getHealthStatus() {
        return {
            status: 'healthy',
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            version: process.env.npm_package_version || '1.0.0',
            environment: process.env.NODE_ENV || 'development'
        };
    }
}

module.exports = HealthMonitor;