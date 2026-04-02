const BasePublisher = require('./base');
class FacebookPublisher extends BasePublisher {
    constructor() { super('facebook'); }
    format(post) { let t = post.body || ''; if (t.length > 5000) t = t.substring(0, 4995) + '...'; return { text: t, media: post.media_urls?.[0] }; }
}
module.exports = FacebookPublisher;
