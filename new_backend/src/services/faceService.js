const detectFaces = async (imageBuffer, userId = 'unknown') => {
    console.log(`DEBUG: stub face detection invoked for user=${userId}`);
    
    return [{ 
        confidence: 0.99, 
        box: { x: 0, y: 0, width: 100, height: 100 } 
    }];
};

module.exports = { detectFaces };
