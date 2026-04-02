/**
 * lib/social-publishers/base.js — Base class for social media publishers (v42.3)
 */
class BasePublisher {
    constructor(platform) {
        this.platform = platform;
    }

    async publish(post, account) {
        if (!account || !account.is_connected) {
            throw new Error(`${this.platform} не підключено`);
        }
        const formatted = this.format(post);
        const result = await this.send(formatted, account);
        return { postId: result.id, postUrl: result.url };
    }

    format(post) {
        return { text: post.body || '', media: post.media_urls?.[0] || null };
    }

    async send(/* formatted, account */) {
        throw new Error(`${this.platform} publisher не реалізований. Використовуйте ручний постинг.`);
    }
}

module.exports = BasePublisher;
