const winston = require('winston');
const fs = require('fs');
const path = require('path');

class MonitoringService {
    constructor() {
        this.alerts = [];
        this.metrics = new Map();
        this.thresholds = {
            cpu: parseInt(process.env.ALERT_THRESHOLD_CPU) || 80,
            memory: parseInt(process.env.ALERT_THRESHOLD_MEMORY) || 85,
            responseTime: parseInt(process.env.ALERT_THRESHOLD_RESPONSE_TIME) || 5000,
            errorRate: parseInt(process.env.ALERT_THRESHOLD_ERROR_RATE) || 5
        };
        
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ filename: 'logs/monitoring.log' }),
                new winston.transports.Console()
            ]
        });
        
        this.startMonitoring();
    }

    startMonitoring() {
        // Monitor system resources every 30 seconds
        setInterval(() => {
            this.checkSystemResources();
        }, 30000);
        
        // Monitor application metrics every 60 seconds
        setInterval(() => {
            this.checkApplicationMetrics();
        }, 60000);
        
        // Clean up old metrics every hour
        setInterval(() => {
            this.cleanupMetrics();
        }, 3600000);
    }

    checkSystemResources() {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        // Check memory usage
        const memoryPercent = (memUsage.rss / (1024 * 1024 * 1024)) * 100;
        if (memoryPercent > this.thresholds.memory) {
            this.sendAlert('HIGH_MEMORY_USAGE', {
                current: Math.round(memoryPercent),
                threshold: this.thresholds.memory,
                memory: {
                    rss: Math.round(memUsage.rss / 1024 / 1024),
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
                }
            });
        }
        
        // Log system metrics
        this.logger.info('System resources check', {
            memory: {
                rss: Math.round(memUsage.rss / 1024 / 1024),
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
            },
            uptime: process.uptime()
        });
    }

    checkApplicationMetrics() {
        const now = Date.now();
        const oneHourAgo = now - 3600000;
        
        // Calculate error rate for the last hour
        const recentMetrics = Array.from(this.metrics.values()).filter(m => 
            m.timestamp > oneHourAgo
        );
        
        if (recentMetrics.length > 0) {
            const errorCount = recentMetrics.filter(m => m.status === 'error').length;
            const errorRate = (errorCount / recentMetrics.length) * 100;
            
            if (errorRate > this.thresholds.errorRate) {
                this.sendAlert('HIGH_ERROR_RATE', {
                    current: Math.round(errorRate),
                    threshold: this.thresholds.errorRate,
                    totalRequests: recentMetrics.length,
                    errorCount: errorCount
                });
            }
        }
        
        // Check database connectivity
        this.checkDatabaseHealth();
    }

    async checkDatabaseHealth() {
        try {
            const Database = require('better-sqlite3');
            const dbPath = path.join(__dirname, '..', 'data', 'faceswap.db');
            
            if (!fs.existsSync(dbPath)) {
                this.sendAlert('DATABASE_MISSING', { path: dbPath });
                return;
            }
            
            const db = new Database(dbPath);
            const stmt = db.prepare('SELECT COUNT(*) as count FROM users');
            const result = stmt.get();
            db.close();
            
            this.logger.info('Database health check passed', {
                userCount: result.count,
                dbSize: fs.statSync(dbPath).size
            });
            
        } catch (error) {
            this.sendAlert('DATABASE_ERROR', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    recordMetric(metric) {
        const id = `${metric.type}_${Date.now()}_${Math.random()}`;
        this.metrics.set(id, {
            ...metric,
            timestamp: Date.now()
        });
        
        // Check if this metric triggers any alerts
        this.checkMetricThresholds(metric);
    }

    checkMetricThresholds(metric) {
        switch (metric.type) {
            case 'response_time':
                if (metric.value > this.thresholds.responseTime) {
                    this.sendAlert('HIGH_RESPONSE_TIME', {
                        current: metric.value,
                        threshold: this.thresholds.responseTime,
                        endpoint: metric.endpoint,
                        method: metric.method
                    });
                }
                break;
                
            case 'error':
                this.sendAlert('APPLICATION_ERROR', {
                    error: metric.error,
                    endpoint: metric.endpoint,
                    method: metric.method
                });
                break;
                
            case 'telegram_error':
                this.sendAlert('TELEGRAM_ERROR', {
                    error: metric.error,
                    userId: metric.userId,
                    action: metric.action
                });
                break;
                
            case 'face_detection_error':
                this.sendAlert('FACE_DETECTION_ERROR', {
                    error: metric.error,
                    userId: metric.userId,
                    imageSize: metric.imageSize
                });
                break;
        }
    }

    sendAlert(type, data) {
        const alert = {
            id: `alert_${Date.now()}_${Math.random()}`,
            type: type,
            data: data,
            timestamp: new Date().toISOString(),
            severity: this.getAlertSeverity(type)
        };
        
        this.alerts.push(alert);
        
        // Log the alert
        this.logger.warn('Alert triggered', alert);
        
        // Send notification (implement based on your notification system)
        this.sendNotification(alert);
        
        // Keep only recent alerts
        if (this.alerts.length > 1000) {
            this.alerts = this.alerts.slice(-500);
        }
    }

    getAlertSeverity(type) {
        const severityMap = {
            'HIGH_MEMORY_USAGE': 'warning',
            'HIGH_CPU_USAGE': 'warning',
            'HIGH_RESPONSE_TIME': 'warning',
            'HIGH_ERROR_RATE': 'critical',
            'DATABASE_ERROR': 'critical',
            'DATABASE_MISSING': 'critical',
            'TELEGRAM_ERROR': 'error',
            'FACE_DETECTION_ERROR': 'error',
            'APPLICATION_ERROR': 'error'
        };
        
        return severityMap[type] || 'info';
    }

    sendNotification(alert) {
        // Implement your notification system here
        // This could be:
        // - Email notifications
        // - Slack/Discord webhooks
        // - SMS for critical alerts
        // - Push notifications
        
        // For now, just log it
        this.logger.info('Notification sent', {
            alertId: alert.id,
            type: alert.type,
            severity: alert.severity
        });
    }

    cleanupMetrics() {
        const oneDayAgo = Date.now() - 86400000;
        
        for (const [id, metric] of this.metrics.entries()) {
            if (metric.timestamp < oneDayAgo) {
                this.metrics.delete(id);
            }
        }
        
        this.logger.info('Metrics cleaned up', {
            remainingMetrics: this.metrics.size
        });
    }

    getMetrics() {
        return {
            alerts: this.alerts.slice(-100), // Last 100 alerts
            metrics: Array.from(this.metrics.values()).slice(-1000), // Last 1000 metrics
            thresholds: this.thresholds,
            system: {
                memory: process.memoryUsage(),
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            }
        };
    }

    getHealthStatus() {
        const recentAlerts = this.alerts.filter(a => 
            Date.now() - new Date(a.timestamp).getTime() < 300000 // Last 5 minutes
        );
        
        const criticalAlerts = recentAlerts.filter(a => a.severity === 'critical');
        const warningAlerts = recentAlerts.filter(a => a.severity === 'warning');
        
        let status = 'healthy';
        if (criticalAlerts.length > 0) {
            status = 'critical';
        } else if (warningAlerts.length > 0) {
            status = 'warning';
        }
        
        return {
            status: status,
            alerts: {
                critical: criticalAlerts.length,
                warning: warningAlerts.length,
                total: recentAlerts.length
            },
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = MonitoringService;