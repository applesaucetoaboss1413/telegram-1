const { getPendingJobs, updateJobStatus, updateJobStatus: markJobComplete } = require('../database');
const { checkStatus } = require('./magicService');
const EventEmitter = require('events');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
});

class QueueService extends EventEmitter {
    constructor() {
        super();
        this.isPolling = false;
        this.interval = null;
    }

    start() {
        if (this.isPolling) return;
        this.isPolling = true;
        logger.info('Queue Service Started');

        // Initial recovery
        this.poll();

        // Regular interval
        this.interval = setInterval(() => this.poll(), 5000); // Poll every 5s
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        this.isPolling = false;
    }

    async poll() {
        const jobs = getPendingJobs();
        if (jobs.length === 0) return;

        for (const job of jobs) {
            try {
                const meta = JSON.parse(job.meta || '{}');
                const isVideo = job.type === 'video';

                // Check API status
                const result = await checkStatus(job.request_id, isVideo);
                const status = (result.status || result.state || '').toLowerCase();

                if (status === 'success' || status === 'completed' || status === 'done') {
                    // Success
                    let output = result.output || result.result || result.url || result.image_url || result.video_url;
                    // Handle object output from V2
                    if (typeof output === 'object') {
                        output = output.video_url || output.image_url || output.url || Object.values(output)[0];
                    }
                    // Handle array output
                    if (Array.isArray(output)) output = output[output.length - 1];

                    const changes = markJobComplete(job.request_id, 'completed', output, null);
                    if (changes > 0) {
                        this.emit('job_complete', { job, output });
                        logger.info(`Job ${job.request_id} completed`);
                    } else {
                        logger.warn(`Job ${job.request_id} already completed by another worker`);
                    }

                } else if (status === 'failed' || status === 'error') {
                    // Failure
                    const errorMsg = result.error || result.message || 'Unknown API Error';
                    const changes = markJobComplete(job.request_id, 'failed', null, errorMsg);
                    if (changes > 0) {
                        this.emit('job_failed', { job, error: errorMsg });
                        logger.error(`Job ${job.request_id} failed: ${errorMsg}`);
                    }

                } else {
                    // Still processing
                    // Check timeout (e.g., 10 minutes)
                    if (Date.now() - job.created_at > 10 * 60 * 1000) {
                        const changes = markJobComplete(job.request_id, 'failed', null, 'Timeout');
                        if (changes > 0) {
                            this.emit('job_failed', { job, error: 'Timeout' });
                        }
                    }
                }

            } catch (error) {
                logger.error(`Error processing job ${job.request_id}`, error);
                // Don't fail immediately on network error, just retry next tick
            }
        }
    }
}

const queueService = new QueueService();
module.exports = queueService;
