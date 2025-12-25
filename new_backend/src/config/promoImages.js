const PROMO_IMAGES = [ 
   { 
     id: 'promo-1', 
     path: 'https://res.cloudinary.com/drtnsapz2/image/upload/v1735144883/samples/upscale-20k.jpg', 
     caption: 'Swap your face into any video in seconds. New users get 69 free credits (first 5-second video costs 60, 9 left over). Open @FaceSwapVideoAi and tap ‘Get 69 Free Credits’ to start.', 
   }, 
   { 
     id: 'promo-2', 
     path: 'https://res.cloudinary.com/drtnsapz2/image/upload/v1735144882/samples/landscapes/beach-boat.jpg', 
     caption: 'Make your photos talk and swap faces in seconds. Tap @YourBotName and send /start.', 
   }, 
   { 
     id: 'promo-3', 
     path: 'https://res.cloudinary.com/drtnsapz2/image/upload/v1735144881/samples/animals/reindeer.jpg', 
     caption: 'AI head swaps & talking avatars. Start now with /start in @YourBotName.', 
   }, 
 ]; 

const PROMO_CONFIG = {
    channelId: process.env.PROMO_CHANNEL_ID || '@FaceSwapVideoAi',
    intervalMs: 6 * 60 * 60 * 1000, // 6 hours
    retryDelayMs: 5 * 60 * 1000,     // 5 minutes
};

module.exports = { PROMO_IMAGES, PROMO_CONFIG };
