const { getPendingJobs, updateJobStatus, updateJobStatus: markJobComplete, updateJobMeta } = require('../database');
const { checkFaceSwapTaskStatus, checkFaceSwapPreviewStatus, checkImage2VideoStatus } = require('./magicService');
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

<<<<<<< HEAD
        for (const job of jobs) {
            try {
                const meta = JSON.parse(job.meta || '{}');
                const isVideo = job.type === 'video';

                // Check API status
                const result = await checkStatus(job.request_id, isVideo);
                const status = (result.status || result.state || '').toLowerCase();
=======
        // Process jobs concurrently with a limit (e.g., 5)
        const CONCURRENCY_LIMIT = 5;
        const chunks = [];
        for (let i = 0; i < jobs.length; i += CONCURRENCY_LIMIT) {
            chunks.push(jobs.slice(i, i + CONCURRENCY_LIMIT));
        }
>>>>>>> 54956f0adcd9dc55e53517b8c737d596041bffff

        for (const chunk of chunks) {
            await Promise.all(chunk.map(job => this.processJob(job)));
        }
    }

<<<<<<< HEAD
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
=======
    async processJob(job) {
        try {
            const meta = JSON.parse(job.meta || '{}');
            if (meta.next_poll_at && Date.now() < meta.next_poll_at) {
                return;
>>>>>>> 54956f0adcd9dc55e53517b8c737d596041bffff
            }
            let result;
            try {
                if (meta && meta.service === 'faceswap_preview') {
                    logger.info('poll', { user: job.user_id, id: job.request_id, service: 'faceswap_preview' });
                    result = await checkFaceSwapPreviewStatus(job.request_id);
                } else if (meta && meta.service === 'image2video') {
                    logger.info('poll', { user: job.user_id, id: job.request_id, service: 'image2video' });
                    result = await checkImage2VideoStatus(job.request_id);
                } else {
                    logger.info('poll', { user: job.user_id, id: job.request_id, service: 'faceswap' });
                    result = await checkFaceSwapTaskStatus(job.request_id);
                }
            } catch (apiError) {
                // Handle 400/404 specifically
                if (apiError.response && (apiError.response.status === 400 || apiError.response.status === 404)) {
                    const msg = apiError.response.data?.message || 'Invalid Job ID or Bad Request';
                    markJobComplete(job.request_id, 'failed', null, msg);
                    this.emit('job_failed', { job, error: msg });
                    logger.error('job_failed_permanent', { user: job.user_id, id: job.request_id, error: msg });
                    return;
                }
                if (apiError.response && apiError.response.status >= 500) {
                    const attempts = (meta.attempts || 0) + 1;
                    const delay = Math.min(15000, 2000 * Math.pow(2, attempts - 1));
                    const nextMeta = { ...meta, attempts, next_poll_at: Date.now() + delay };
                    updateJobMeta(job.request_id, nextMeta);
                    logger.warn('poll_retry_5xx', { id: job.request_id, user: job.user_id, status: apiError.response.status, delay });
                    return;
                }
                throw apiError; // Rethrow transient errors
            }

            const status = (result.status || '').toLowerCase();

            if (status === 'completed' || status === 'success' || status === 'done') {
                // Success
                let output = result.result_url || result.output || result.result || result.url || result.image_url || result.video_url;

                markJobComplete(job.request_id, 'completed', output, null);
                this.emit('job_complete', { job, output });
                logger.info('job_complete', { user: job.user_id, id: job.request_id, output });

            } else if (status === 'failed' || status === 'error' || status === 'provider_error_html') {
                // Failure
                const errorMsg = result.error || result.message || 'Unknown API Error';
                markJobComplete(job.request_id, 'failed', null, errorMsg);
                this.emit('job_failed', { job, error: errorMsg });
                logger.error('job_failed', { user: job.user_id, id: job.request_id, error: errorMsg });
            } else {
                // Still processing
                const attempts = (meta.attempts || 0) + 1;
                const delay = Math.min(15000, 2000 * Math.pow(2, attempts - 1));
                const nextMeta = { ...meta, attempts, next_poll_at: Date.now() + delay };
                updateJobMeta(job.request_id, nextMeta);
                // Timeout window ~120s
                if (Date.now() - job.created_at > 120 * 1000) {
                    markJobComplete(job.request_id, 'failed', null, 'Timeout');
                    this.emit('job_failed', { job, error: 'Timeout' });
                    logger.error('job_failed_timeout', { user: job.user_id, id: job.request_id });
                }
            }

        } catch (error) {
            logger.error('job_process_error', { id: job.request_id, user: job.user_id, error: error.message });
            // Don't fail immediately on network error, just retry next tick
        }
    }
}

const queueService = new QueueService();
module.exports = queueService;
