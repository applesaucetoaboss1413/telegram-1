const winston = require('winston');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

const detectFaces = async (imageBuffer, userId = 'unknown') => {
    logger.info('face_detection_stub_invoked', { userId });
    
    return [{ 
        confidence: 0.99, 
        box: { x: 0, y: 0, width: 100, height: 100 } 
    }];
};

module.exports = { detectFaces };
