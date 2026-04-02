/**
 * lib/social-publishers/index.js — Publisher registry (v42.3)
 */
const TelegramPublisher = require('./telegram');
const InstagramPublisher = require('./instagram');
const TikTokPublisher = require('./tiktok');
const FacebookPublisher = require('./facebook');
const ThreadsPublisher = require('./threads');
const ViberPublisher = require('./viber');

const publishers = {
    telegram: new TelegramPublisher(),
    instagram: new InstagramPublisher(),
    tiktok: new TikTokPublisher(),
    facebook: new FacebookPublisher(),
    threads: new ThreadsPublisher(),
    viber: new ViberPublisher(),
};

function getPublisher(platform) {
    const pub = publishers[platform];
    if (!pub) throw new Error(`Невідома платформа: ${platform}`);
    return pub;
}

module.exports = { getPublisher, publishers };
