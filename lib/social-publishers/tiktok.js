const BasePublisher = require('./base');
class TikTokPublisher extends BasePublisher {
    constructor() { super('tiktok'); }
    format(post) { let t = post.body || ''; if (t.length > 300) t = t.substring(0, 295) + '...'; return { text: t, video: post.media_urls?.[0] }; }
}
module.exports = TikTokPublisher;
