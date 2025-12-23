/**
 * STUB: Local face detection removed in favor of A2E.
 * This module now does nothing but return a successful dummy response.
 * The backend no longer loads TensorFlow or face-api.js.
 */

/**
 * Stub implementation of face detection.
 * Always returns a dummy face so the flow proceeds to A2E.
 * 
 * @param {Buffer} imageBuffer - The image data (unused in stub)
 * @param {string} userId - User ID for logging
 * @returns {Promise<Array>} Array of dummy detections
 */
const detectFaces = async (imageBuffer, userId = 'unknown') => {
    console.log(`DEBUG: stub face detection invoked for user=${userId}`);
    
    // Return a dummy detection to satisfy the caller
    // A2E will handle the actual face detection/swapping
    return [{ 
        confidence: 0.99, 
        box: { x: 0, y: 0, width: 100, height: 100 } 
    }];
};

module.exports = { detectFaces };
