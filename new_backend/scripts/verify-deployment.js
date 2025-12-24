#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple()
        }),
        new winston.transports.File({ filename: 'logs/deployment-verify.log' })
    ]
});

class DeploymentVerifier {
    constructor() {
        this.baseUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
        this.results = {
            timestamp: new Date().toISOString(),
            baseUrl: this.baseUrl,
            checks: {},
            overall: 'unknown'
        };
    }

    async makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : require('http');
            
            const requestOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                timeout: options.timeout || 10000,
                ...options.headers && { headers: options.headers }
            };
            
            const req = client.request(requestOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: data
                    });
                });
            });
            
            req.on('error', reject);
            req.on('timeout', () => reject(new Error('Request timeout')));
            
            if (options.body) {
                req.write(options.body);
            }
            
            req.end();
        });
    }

    async checkHealthEndpoint() {
        logger.info('Checking health endpoint...');
        
        try {
            const url = `${this.baseUrl}/health`;
            const startTime = Date.now();
            const response = await this.makeRequest(url);
            const responseTime = Date.now() - startTime;
            
            let result = {
                status: 'failed',
                responseTime: responseTime,
                statusCode: response.statusCode,
                error: null
            };
            
            if (response.statusCode === 200) {
                try {
                    const healthData = JSON.parse(response.data);
                    result.status = healthData.overall === 'healthy' ? 'passed' : 'failed';
                    result.healthData = healthData;
                } catch (error) {
                    result.error = `Failed to parse health response: ${error.message}`;
                }
            } else {
                result.error = `Unexpected status code: ${response.statusCode}`;
            }
            
            this.results.checks.health = result;
            logger.info(`Health check: ${result.status} (${responseTime}ms)`);
            
        } catch (error) {
            this.results.checks.health = {
                status: 'failed',
                error: error.message
            };
            logger.error('Health check failed', error);
        }
    }

    async checkTelegramBot() {
        logger.info('Checking Telegram bot connectivity...');
        
        try {
            const token = process.env.BOT_TOKEN;
            if (!token) {
                this.results.checks.telegram = {
                    status: 'skipped',
                    error: 'BOT_TOKEN not configured'
                };
                logger.warn('BOT_TOKEN not configured, skipping Telegram check');
                return;
            }
            
            const url = `https://api.telegram.org/bot${token}/getMe`;
            const startTime = Date.now();
            const response = await this.makeRequest(url);
            const responseTime = Date.now() - startTime;
            
            let result = {
                status: 'failed',
                responseTime: responseTime,
                statusCode: response.statusCode,
                error: null
            };
            
            if (response.statusCode === 200) {
                try {
                    const botData = JSON.parse(response.data);
                    if (botData.ok) {
                        result.status = 'passed';
                        result.botUsername = botData.result.username;
                        result.botName = botData.result.first_name;
                    } else {
                        result.error = `Telegram API error: ${botData.description}`;
                    }
                } catch (error) {
                    result.error = `Failed to parse bot response: ${error.message}`;
                }
            } else {
                result.error = `Unexpected status code: ${response.statusCode}`;
            }
            
            this.results.checks.telegram = result;
            logger.info(`Telegram check: ${result.status} (${responseTime}ms)`);
            
        } catch (error) {
            this.results.checks.telegram = {
                status: 'failed',
                error: error.message
            };
            logger.error('Telegram check failed', error);
        }
    }

    async checkDatabase() {
        logger.info('Checking database connectivity...');
        
        try {
            const dbPath = path.join(__dirname, '..', 'data', 'faceswap.db');
            
            if (!fs.existsSync(dbPath)) {
                this.results.checks.database = {
                    status: 'failed',
                    error: 'Database file not found'
                };
                logger.error('Database file not found');
                return;
            }
            
            const Database = require('better-sqlite3');
            const db = new Database(dbPath);
            
            const startTime = Date.now();
            const result = db.prepare('SELECT COUNT(*) as count FROM users').get();
            const responseTime = Date.now() - startTime;
            
            db.close();
            
            this.results.checks.database = {
                status: 'passed',
                responseTime: responseTime,
                userCount: result.count,
                dbSize: fs.statSync(dbPath).size
            };
            
            logger.info(`Database check: passed (${responseTime}ms), ${result.count} users`);
            
        } catch (error) {
            this.results.checks.database = {
                status: 'failed',
                error: error.message
            };
            logger.error('Database check failed', error);
        }
    }

    async checkStripe() {
        logger.info('Checking Stripe connectivity...');
        
        try {
            const stripeKey = process.env.STRIPE_SECRET_KEY;
            if (!stripeKey) {
                this.results.checks.stripe = {
                    status: 'skipped',
                    error: 'STRIPE_SECRET_KEY not configured'
                };
                logger.warn('STRIPE_SECRET_KEY not configured, skipping Stripe check');
                return;
            }
            
            const stripe = require('stripe')(stripeKey);
            const startTime = Date.now();
            const balance = await stripe.balance.retrieve();
            const responseTime = Date.now() - startTime;
            
            this.results.checks.stripe = {
                status: 'passed',
                responseTime: responseTime,
                availableBalance: balance.available,
                pendingBalance: balance.pending
            };
            
            logger.info(`Stripe check: passed (${responseTime}ms)`);
            
        } catch (error) {
            this.results.checks.stripe = {
                status: 'failed',
                error: error.message
            };
            logger.error('Stripe check failed', error);
        }
    }

    async checkEnvironment() {
        logger.info('Checking environment configuration...');
        
        const requiredVars = ['BOT_TOKEN', 'MAGICAPI_KEY', 'ADMIN_SECRET'];
        const optionalVars = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
        
        const result = {
            status: 'passed',
            required: {},
            optional: {},
            missing: []
        };
        
        for (const varName of requiredVars) {
            const value = process.env[varName];
            result.required[varName] = {
                present: !!value,
                length: value ? value.length : 0
            };
            
            if (!value) {
                result.missing.push(varName);
                result.status = 'failed';
            }
        }
        
        for (const varName of optionalVars) {
            const value = process.env[varName];
            result.optional[varName] = {
                present: !!value,
                length: value ? value.length : 0
            };
        }
        
        this.results.checks.environment = result;
        
        if (result.missing.length > 0) {
            logger.error(`Environment check failed: missing ${result.missing.join(', ')}`);
        } else {
            logger.info('Environment check: passed');
        }
    }

    async runAllChecks() {
        logger.info('Starting deployment verification...');
        logger.info(`Base URL: ${this.baseUrl}`);
        
        const checks = [
            () => this.checkEnvironment(),
            () => this.checkHealthEndpoint(),
            () => this.checkTelegramBot(),
            () => this.checkDatabase(),
            () => this.checkStripe()
        ];
        
        for (const check of checks) {
            await check();
        }
        
        // Calculate overall status
        const results = Object.values(this.results.checks);
        const passed = results.filter(r => r.status === 'passed').length;
        const failed = results.filter(r => r.status === 'failed').length;
        const skipped = results.filter(r => r.status === 'skipped').length;
        
        if (failed > 0) {
            this.results.overall = 'failed';
        } else if (passed === 0) {
            this.results.overall = 'unknown';
        } else {
            this.results.overall = 'passed';
        }
        
        this.results.summary = {
            total: results.length,
            passed: passed,
            failed: failed,
            skipped: skipped
        };
        
        logger.info(`Verification completed: ${this.results.overall}`);
        logger.info(`Summary: ${passed} passed, ${failed} failed, ${skipped} skipped`);
        
        return this.results;
    }

    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            overall: this.results.overall,
            summary: this.results.summary,
            details: this.results.checks
        };
        
        // Save report to file
        const reportPath = path.join(__dirname, '..', 'logs', `deployment-verify-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        
        logger.info(`Report saved to: ${reportPath}`);
        
        // Print summary to console
        console.log('\n=== DEPLOYMENT VERIFICATION REPORT ===');
        console.log(`Overall Status: ${this.results.overall.toUpperCase()}`);
        console.log(`Timestamp: ${report.timestamp}`);
        console.log(`Base URL: ${this.baseUrl}`);
        console.log(`\nSummary: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped`);
        
        if (report.summary.failed > 0) {
            console.log('\nFailed Checks:');
            Object.entries(report.details).forEach(([name, check]) => {
                if (check.status === 'failed') {
                    console.log(`- ${name}: ${check.error}`);
                }
            });
        }
        
        console.log('\n=== END REPORT ===\n');
        
        return report;
    }
}

// CLI interface
if (require.main === module) {
    const verifier = new DeploymentVerifier();
    
    verifier.runAllChecks()
        .then(() => {
            const report = verifier.generateReport();
            
            // Exit with appropriate code
            process.exit(report.overall === 'passed' ? 0 : 1);
        })
        .catch(error => {
            logger.error('Verification failed', error);
            process.exit(1);
        });
}

module.exports = DeploymentVerifier;