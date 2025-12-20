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

        // Process jobs concurrently with a limit (e.g., 5)
        const CONCURRENCY_LIMIT = 5;
        const chunks = [];
        for (let i = 0; i < jobs.length; i += CONCURRENCY_LIMIT) {
            chunks.push(jobs.slice(i, i + CONCURRENCY_LIMIT));
        }

        for (const chunk of chunks) {
            await Promise.all(chunk.map(job => this.processJob(job)));
        }
    }

    async processJob(job) {
        try {
            const meta = JSON.parse(job.meta || '{}');
            const isVideo = job.type === 'video';
            
            // Check API status
            let result;
            try {
                result = await checkStatus(job.request_id, isVideo);
            } catch (apiError) {
                // Handle 400/404 specifically
                if (apiError.response && (apiError.response.status === 400 || apiError.response.status === 404)) {
                    const msg = apiError.response.data?.message || 'Invalid Job ID or Bad Request';
                    markJobComplete(job.request_id, 'failed', null, msg);
                    this.emit('job_failed', { job, error: msg });
                    logger.error(`Job ${job.request_id} failed permanently: ${msg}`);
                    return;
                }
                throw apiError; // Rethrow transient errors
            }

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

                markJobComplete(job.request_id, 'completed', output, null);
                this.emit('job_complete', { job, output });
                logger.info(`Job ${job.request_id} completed`);

            } else if (status === 'failed' || status === 'error') {
                // Failure
                const errorMsg = result.error || result.message || 'Unknown API Error';
                markJobComplete(job.request_id, 'failed', null, errorMsg);
                this.emit('job_failed', { job, error: errorMsg });
                logger.error(`Job ${job.request_id} failed: ${errorMsg}`);
            } else {
                // Still processing
                // Check timeout (e.g., 10 minutes)
                if (Date.now() - job.created_at > 10 * 60 * 1000) {
                    markJobComplete(job.request_id, 'failed', null, 'Timeout');
                    this.emit('job_failed', { job, error: 'Timeout' });
                }
            }

        } catch (error) {
            logger.error(`Error processing job ${job.request_id}`, error);
            // Don't fail immediately on network error, just retry next tick
        }
    }
}

const queueService = new QueueService();
module.exports = queueService;
