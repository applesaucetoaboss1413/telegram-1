const { Canvas, Image, ImageData, loadImage } = require('canvas');
const path = require('path');
const tf = require('@tensorflow/tfjs');

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
 * @returns {Promise<Array>} Array of detections
 */
const detectFaces = async (imageBuffer) => {
    await loadModels();
    
    try {
        const img = await loadImage(imageBuffer);
        
        // Use SSD MobileNet V1 for better accuracy (vs Tiny)
        // minConfidence 0.6 to filter out false positives
        
        const detections = await faceapi.detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 }));
        return detections;
    } catch (error) {
        console.error('Face detection error:', error);
        throw new Error('Failed to process image for face detection');
    }
};

module.exports = { detectFaces };
