const PROMO_IMAGES = [ 
   { 
     id: 'promo-1', 
     path: 'https://res.cloudinary.com/drtnsapz2/image/upload/v1766638708/image_hfb1hy.avif', 
     caption: 'Turn your face into any character. Send /start to @YourBotName for a free sample.', 
   }, 
   { 
     id: 'promo-2', 
     path: 'https://res.cloudinary.com/drtnsapz2/image/upload/v1766638693/How-to-face-swap-Photoshop_tok5vd.webp', 
     caption: 'Make your photos talk and swap faces in seconds. Tap @YourBotName and send /start.', 
   }, 
   { 
     id: 'promo-3', 
     path: 'https://res.cloudinary.com/drtnsapz2/image/upload/v1766638680/1f9346e3-40a0-54bf-8523-9248b523ad1f_u9gsgy.jpg', 
     caption: 'AI head swaps & talking avatars. Start now with /start in @YourBotName.', 
   }, 
 ]; 

const PROMO_CONFIG = {
    channelId: process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi',
    intervalMs: 6 * 60 * 60 * 1000, // 6 hours
    retryDelayMs: 5 * 60 * 1000,     // 5 minutes
};

module.exports = { PROMO_IMAGES, PROMO_CONFIG };
