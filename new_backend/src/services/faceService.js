const { Canvas, Image, ImageData, loadImage } = require('canvas');
const path = require('path');
// Import tfjs-node for server-side performance (avoids the register_all_gradients issue)
const tf = require('@tensorflow/tfjs-node');

let faceapi;
let modelsLoaded = false;

const loadFaceApi = async () => {
    if (faceapi) return;
    const module = await import('@vladmandic/face-api/dist/face-api.esm-nobundle.js');
    faceapi = module;
    
    // Monkey patch for Node.js environment
    faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
};

const loadModels = async () => {
    await loadFaceApi();
    if (modelsLoaded) return;
    try {
        // Path to models in node_modules
        const modelPath = path.join(__dirname, '../../node_modules/@vladmandic/face-api/model');
        console.log('Loading face models from:', modelPath);
        
        await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
        modelsLoaded = true;
        console.log('Face models loaded successfully');
    } catch (error) {
        console.error('Error loading face models:', error);
        throw error;
    }
};

/**
 * Detects faces in an image buffer
 * @param {Buffer} imageBuffer 
 * @param {string} userId - Optional user ID for logging
 * @returns {Promise<Array>} Array of detections
 */
const detectFaces = async (imageBuffer, userId = 'unknown') => {
    await loadModels();
    
    try {
        const img = await loadImage(imageBuffer);
        
        // Use SSD MobileNet V1 for better accuracy (vs Tiny)
        // minConfidence 0.6 to filter out false positives
        
        const detections = await faceapi.detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 }));
        
        if (detections.length > 0) {
            console.log(`DEBUG: face detection OK for user=${userId}`);
        } else {
            console.log(`DEBUG: face detection result: 0 faces found for user=${userId}`);
        }
        
        return detections;
    } catch (error) {
        // Log the internal error but don't expose it to the user
        console.error(`ERROR: face detection failed for user=${userId}:`, error.message);
        throw new Error('Failed to process image for face detection');
    }
};

module.exports = { detectFaces };
