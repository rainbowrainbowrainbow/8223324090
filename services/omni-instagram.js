/**
 * services/omni-instagram.js — Instagram Messaging API channel adapter
 *
 * Sends DMs and replies to comments via the Instagram Graph API
 * (uses the same Facebook Graph API endpoint with an IG-specific token).
 * Uses native https module (no axios / no npm deps).
 */
const https = require('https');
const { createLogger } = require('../utils/logger');

const log = createLogger('OmniInstagram');

const IG_PAGE_TOKEN = process.env.IG_PAGE_TOKEN || '';
const IG_API_VERSION = 'v18.0';

const SOCKET_TIMEOUT = 15000;
const RESPONSE_TIMEOUT = 15000;

if (!IG_PAGE_TOKEN) {
    log.warn('IG_PAGE_TOKEN not set. Instagram channel disabled.');
}

/**
 * Low-level request to Instagram (Facebook Graph) API.
 * @param {string} method - HTTP method
 * @param {string} path - API path (without hostname)
 * @param {object|null} body - JSON payload (null for GET)
 * @returns {Promise<object>} parsed response
 */
function igRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;

        const separator = path.includes('?') ? '&' : '?';
        const fullPath = `/${IG_API_VERSION}${path}${separator}access_token=${IG_PAGE_TOKEN}`;

        const options = {
            hostname: 'graph.facebook.com',
            port: 443,
            path: fullPath,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload && { 'Content-Length': Buffer.byteLength(payload) })
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
                        return;
                    }
                    resolve(parsed);
                } catch (err) {
                    reject(new Error(`IG API returned non-JSON: ${data.slice(0, 200)}`));
                }
            });
        });

        req.setTimeout(SOCKET_TIMEOUT, () => {
            req.destroy(new Error('Instagram API socket timeout'));
        });

        const responseTimer = setTimeout(() => {
            req.destroy(new Error('Instagram API response timeout'));
        }, RESPONSE_TIMEOUT);

        req.on('close', () => clearTimeout(responseTimer));

        req.on('error', (err) => {
            clearTimeout(responseTimer);
            reject(err);
        });

        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

/**
 * Send a direct message via Instagram Messenger.
 * @param {string} recipientId - Instagram-scoped user ID (IGSID)
 * @param {string} text - Message text
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendInstagram(recipientId, text) {
    if (!IG_PAGE_TOKEN) {
        log.warn('sendInstagram called but IG_PAGE_TOKEN not configured');
        return { success: false, error: 'IG_PAGE_TOKEN not configured' };
    }

    if (!recipientId || !text) {
        return { success: false, error: 'recipientId and text are required' };
    }

    try {
        const body = {
            recipient: { id: recipientId },
            message: { text }
        };

        log.debug('Sending Instagram DM', { recipientId });

        const response = await igRequest('POST', '/me/messages', body);

        log.info('Instagram DM sent', { recipientId, messageId: response.message_id });
        return { success: true, messageId: response.message_id };
    } catch (err) {
        log.error('sendInstagram failed', err);
        return { success: false, error: err.message };
    }
}

/**
 * Reply to an Instagram comment.
 * @param {string} commentId - Instagram comment ID
 * @param {string} text - Reply text
 * @returns {Promise<{success: boolean, commentId?: string, error?: string}>}
 */
async function replyToComment(commentId, text) {
    if (!IG_PAGE_TOKEN) {
        log.warn('replyToComment called but IG_PAGE_TOKEN not configured');
        return { success: false, error: 'IG_PAGE_TOKEN not configured' };
    }

    if (!commentId || !text) {
        return { success: false, error: 'commentId and text are required' };
    }

    try {
        log.debug('Replying to IG comment', { commentId });

        const response = await igRequest('POST', `/${commentId}/replies`, { message: text });

        log.info('IG comment reply sent', { parentCommentId: commentId, replyId: response.id });
        return { success: true, commentId: response.id };
    } catch (err) {
        log.error('replyToComment failed', err);
        return { success: false, error: err.message };
    }
}

module.exports = { sendInstagram, replyToComment };
