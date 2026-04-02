/**
 * lib/social-publishers/instagram.js — Instagram Graph API publisher (v42.3)
 */
const BasePublisher = require('./base');
const { createLogger } = require('../../utils/logger');
const log = createLogger('InstagramPublisher');

class InstagramPublisher extends BasePublisher {
    constructor() { super('instagram'); }

    format(post) {
        let text = post.body || '';
        const hashtags = (post.hashtags || []).join(' ');
        if (hashtags && !text.includes('#')) {
            text += '\n\n' + hashtags;
        }
        if (text.length > 2200) text = text.substring(0, 2195) + '...';
        return { caption: text, imageUrl: post.media_urls?.[0] || null };
    }

    async send(formatted, account) {
        const igUserId = account.account_id;
        const token = account.access_token;
        if (!igUserId || !token) throw new Error('Instagram credentials не налаштовані');
        if (!formatted.imageUrl) throw new Error('Instagram вимагає зображення');

        const graphUrl = 'https://graph.facebook.com/v19.0';

        // Step 1: Create media container
        const createRes = await fetch(`${graphUrl}/${igUserId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_url: formatted.imageUrl,
                caption: formatted.caption,
                access_token: token
            })
        });
        const createData = await createRes.json();
        if (createData.error) throw new Error(createData.error.message || 'IG media create failed');
        const creationId = createData.id;

        // Step 2: Publish
        const pubRes = await fetch(`${graphUrl}/${igUserId}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                creation_id: creationId,
                access_token: token
            })
        });
        const pubData = await pubRes.json();
        if (pubData.error) throw new Error(pubData.error.message || 'IG publish failed');
        log.info(`Published to Instagram: ${pubData.id}`);
        return { id: pubData.id, url: `https://instagram.com/p/${pubData.id}` };
    }
}

module.exports = InstagramPublisher;
