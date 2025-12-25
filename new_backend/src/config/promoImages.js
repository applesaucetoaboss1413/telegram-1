const PROMO_IMAGES = [ 
   { 
     id: 'promo-1', 
     path: 'https://res.cloudinary.com/drtnsapz2/image/upload/v1766638693/How-to-face-swap-Photoshop_tok5vd.webp', 
     caption: 'Swap your face into any video in seconds. New users get 69 free credits (first 5-second video costs 60, 9 left over). Open @FaceSwapVideoAi or tap https://t.me/FaceSwapVideoAi?start=get_69_credits to start.', 
   }, 
   { 
     id: 'promo-2', 
     path: 'https://res.cloudinary.com/drtnsapz2/image/upload/v1766638680/1f9346e3-40a0-54bf-8523-9248b523ad1f_u9gsgy.jpg', 
   }
 ]; 

const PROMO_CONFIG = {
    channelId: process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi',
    intervalMs: 6 * 60 * 60 * 1000, // 6 hours
    retryDelayMs: 5 * 60 * 1000,     // 5 minutes
};

module.exports = { PROMO_IMAGES, PROMO_CONFIG };
