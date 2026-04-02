const BasePublisher = require('./base');
class ThreadsPublisher extends BasePublisher {
    constructor() { super('threads'); }
    format(post) { let t = post.body || ''; if (t.length > 500) t = t.substring(0, 495) + '...'; return { text: t }; }
}
module.exports = ThreadsPublisher;
