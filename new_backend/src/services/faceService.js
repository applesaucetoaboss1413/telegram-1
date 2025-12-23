const { Canvas, Image, ImageData, loadImage } = require('canvas');
const faceapi = require('@vladmandic/face-api');
const path = require('path');

// Configure face-api to use the canvas environment
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let modelsLoaded = false;

async function loadModels() {
    if (modelsLoaded) return;
    try {
        // Resolve path to models in node_modules
        // Note: The path depends on where the script runs, but __dirname is safe.
        // We assume @vladmandic/face-api is installed and has the 'model' folder.
        const modelPath = path.join(__dirname, '../../node_modules/@vladmandic/face-api/model');
        
        // Load SSD MobileNet V1 - robust and reasonably fast
        await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
        modelsLoaded = true;
    } catch (e) {
        console.error('ERROR: Failed to load face models:', e.message);
        throw e;
    }
}

/**
 * Detects faces in an image buffer using a robust CPU-only fallback if needed.
 * @param {Buffer} imageBuffer - The image data
 * @param {string} userId - User ID for logging
 * @returns {Promise<Array>} Array of detections (empty if none or error)
 */
const detectFaces = async (imageBuffer, userId = 'unknown') => {
    console.log(`DEBUG: starting face detection for user=${userId}`);
    
    try {
        await loadModels();
        
        // Load image into Canvas
        const img = await loadImage(imageBuffer);
        
        // Run detection
        // minConfidence: 0.5 is a standard threshold
        const detections = await faceapi.detectAllFaces(
            img, 
            new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
        );
        
        const count = detections.length;
        console.log(`DEBUG: face detection OK for user=${userId} count=${count}`);
        
        return detections;
        
    } catch (error) {
        // Log error but return empty array to fail gracefully (caller will say "No face detected" or handle it)
        console.error(`ERROR: face detection failed for user=${userId}:`, error.message);
        return []; 
    }
};

module.exports = { detectFaces };
