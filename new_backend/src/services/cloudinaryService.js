const cloudinary = require('cloudinary').v2;

const hasUrl = !!process.env.CLOUDINARY_URL;
const hasKeys = !!process.env.CLOUDINARY_CLOUD_NAME && !!process.env.CLOUDINARY_API_KEY && !!process.env.CLOUDINARY_API_SECRET;
if (hasUrl || hasKeys) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
}

const uploadFromUrl = async (url, resourceType = 'image') => {
    const res = await cloudinary.uploader.upload(url, { resource_type: resourceType, folder: 'telegram-bot' });
    return res.secure_url || res.url;
};

module.exports = { uploadFromUrl };

