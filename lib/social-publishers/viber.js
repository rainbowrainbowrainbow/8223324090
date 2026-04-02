const BasePublisher = require('./base');
class ViberPublisher extends BasePublisher {
    constructor() { super('viber'); }
    format(post) { let t = post.body || ''; if (t.length > 1000) t = t.substring(0, 995) + '...'; return { text: t, media: post.media_urls?.[0] }; }
}
module.exports = ViberPublisher;
