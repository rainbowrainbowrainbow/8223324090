/**
 * services/omni-facebook.js — Facebook Messenger Platform channel adapter
 *
 * Sends messages, replies to comments, and fetches user profiles
 * via the Facebook Graph API. Uses native https module (no axios / no npm deps).
 */
const https = require('https');
const { createLogger } = require('../utils/logger');
const { resolveOmniRuntimeConfig } = require('./omni-accounts');

const log = createLogger('OmniFacebook');

const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || '';
const FB_API_VERSION = process.env.FB_API_VERSION || 'v21.0';

const SOCKET_TIMEOUT = 15000;
const RESPONSE_TIMEOUT = 15000;

if (!FB_PAGE_TOKEN) {
    log.warn('FB_PAGE_TOKEN not set. Facebook channel disabled.');
}

/**
 * Low-level request to Facebook Graph API.
 * @param {string} method - HTTP method
 * @param {string} path - API path (without hostname)
 * @param {object|null} body - JSON payload (null for GET)
 * @returns {Promise<object>} parsed response
 */
function fbRequest(method, path, body, token = FB_PAGE_TOKEN) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;

        const fullPath = `/${FB_API_VERSION}${path}`;

        const options = {
            hostname: 'graph.facebook.com',
            port: 443,
            path: fullPath,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...(payload && { 'Content-Length': Buffer.byteLength(payload) })
            }
        };

        const req = https.request(options, (httpRes) => {
            let data = '';
            httpRes.on('data', (chunk) => { data += chunk; });
            httpRes.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        const err = new Error(parsed.error.message || JSON.stringify(parsed.error));
                        err.statusCode = httpRes.statusCode;
                        err.fbErrorCode = parsed.error.code;
                        reject(err);
                        return;
                    }
                    if (httpRes.statusCode >= 400) {
                        reject(new Error(`Facebook API HTTP ${httpRes.statusCode}: ${data.slice(0, 200)}`));
                        return;
                    }
                    resolve(parsed);
                } catch (err) {
                    reject(new Error(`FB API returned non-JSON (HTTP ${httpRes.statusCode}): ${data.slice(0, 200)}`));
                }
            });
        });

        req.setTimeout(SOCKET_TIMEOUT, () => {
            req.destroy(new Error('Facebook API socket timeout'));
        });

        const responseTimer = setTimeout(() => {
            req.destroy(new Error('Facebook API response timeout'));
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
 * Send a message via Facebook Messenger.
 * @param {string} recipientId - Facebook user PSID
 * @param {string} text - Message text
 * @param {object} [options] - Optional overrides
 * @param {string} [options.messagingType] - Messaging type (default 'RESPONSE')
 * @param {object} [options.attachment] - Attachment object (image, template, etc.)
 * @param {object[]} [options.quickReplies] - Quick reply buttons
 * @param {string} [options.tag] - Message tag for non-24h window messages
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendFacebook(recipientId, text, options = {}) {
    const runtime = await resolveOmniRuntimeConfig('facebook');
    const token = runtime.pageToken || runtime.token || FB_PAGE_TOKEN;
    if (!token) {
        log.warn('sendFacebook called but FB_PAGE_TOKEN not configured');
        return { success: false, error: 'FB_PAGE_TOKEN not configured' };
    }

    if (!recipientId) {
        return { success: false, error: 'recipientId is required' };
    }

    if (!text && !options.attachment) {
        return { success: false, error: 'text or attachment is required' };
    }

    try {
        const body = {
            messaging_type: options.messagingType || 'RESPONSE',
            recipient: { id: recipientId },
            message: {}
        };

        if (text) {
            body.message.text = text;
        }

        if (options.attachment) {
            body.message.attachment = options.attachment;
        }

        if (options.quickReplies && options.quickReplies.length > 0) {
            body.message.quick_replies = options.quickReplies;
        }

        if (options.tag) {
            body.tag = options.tag;
        }

        log.debug('Sending Facebook message', { recipientId, hasAttachment: !!options.attachment });

        const response = await fbRequest('POST', '/me/messages', body, token);

        log.info('Facebook message sent', { recipientId, messageId: response.message_id });
        return { success: true, messageId: response.message_id };
    } catch (err) {
        log.error('sendFacebook failed', err);
        return { success: false, error: err.message };
    }
}

/**
 * Reply to a Facebook post comment.
 * @param {string} commentId - Facebook comment ID
 * @param {string} text - Reply text
 * @returns {Promise<{success: boolean, commentId?: string, error?: string}>}
 */
async function replyToComment(commentId, text) {
    const runtime = await resolveOmniRuntimeConfig('facebook');
    const token = runtime.pageToken || runtime.token || FB_PAGE_TOKEN;
    if (!token) {
        log.warn('replyToComment called but FB_PAGE_TOKEN not configured');
        return { success: false, error: 'FB_PAGE_TOKEN not configured' };
    }

    if (!commentId || !text) {
        return { success: false, error: 'commentId and text are required' };
    }

    try {
        log.debug('Replying to FB comment', { commentId });

        const response = await fbRequest('POST', `/${commentId}/comments`, { message: text }, token);

        log.info('FB comment reply sent', { parentCommentId: commentId, replyId: response.id });
        return { success: true, commentId: response.id };
    } catch (err) {
        log.error('replyToComment failed', err);
        return { success: false, error: err.message };
    }
}

/**
 * Get a Facebook user's profile information.
 * @param {string} userId - Facebook user PSID
 * @param {string[]} [fields] - Fields to request (default: name, profile_pic)
 * @returns {Promise<{success: boolean, profile?: object, error?: string}>}
 */
async function getUserProfile(userId, fields) {
    const runtime = await resolveOmniRuntimeConfig('facebook');
    const token = runtime.pageToken || runtime.token || FB_PAGE_TOKEN;
    if (!token) {
        log.warn('getUserProfile called but FB_PAGE_TOKEN not configured');
        return { success: false, error: 'FB_PAGE_TOKEN not configured' };
    }

    if (!userId) {
        return { success: false, error: 'userId is required' };
    }

    try {
        const validFieldPattern = /^[a-z_]+$/i;
        const defaultFields = 'first_name,last_name,profile_pic';
        let fieldList = defaultFields;
        if (Array.isArray(fields) && fields.length > 0) {
            const sanitized = fields.filter(f => typeof f === 'string' && validFieldPattern.test(f));
            fieldList = sanitized.length > 0 ? sanitized.join(',') : defaultFields;
        }

        log.debug('Fetching FB user profile', { userId, fields: fieldList });

        const response = await fbRequest('GET', `/${userId}?fields=${encodeURIComponent(fieldList)}`, null, token);

        log.info('FB user profile fetched', { userId, name: response.first_name });
        return {
            success: true,
            profile: {
                id: response.id,
                firstName: response.first_name,
                lastName: response.last_name,
                profilePic: response.profile_pic,
                ...response
            }
        };
    } catch (err) {
        log.error('getUserProfile failed', err);
        return { success: false, error: err.message };
    }
}

module.exports = { sendFacebook, replyToComment, getUserProfile };
