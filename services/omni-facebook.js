/**
 * services/omni-facebook.js — Facebook Messenger Platform channel adapter
 *
 * Sends messages, replies to comments, and fetches user profiles
 * via the Facebook Graph API. Uses native https module (no axios / no npm deps).
 */
const https = require('https');
const { createLogger } = require('../utils/logger');
const { resolveOmniRuntimeConfig } = require('./omni-accounts');
const { normalizeBusinessContext } = require('./businessContext');
const { profileErrorCode } = require('./omni-meta-profile-errors');

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
function fbRequest(method, path, body, token = FB_PAGE_TOKEN, limits = {}) {
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
            const responseChunks = [];
            let responseBytes = 0;
            let responseTooLarge = false;
            httpRes.on('error', reject);
            httpRes.on('data', (chunk) => {
                if (responseTooLarge) return;
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                responseBytes += buffer.length;
                if (limits.maxResponseBytes && responseBytes > limits.maxResponseBytes) {
                    responseTooLarge = true;
                    req.destroy(Object.assign(new Error('Facebook response too large'), { code: 'PROFILE_RESPONSE_TOO_LARGE' }));
                    return;
                }
                responseChunks.push(buffer);
            });
            httpRes.on('end', () => {
                if (responseTooLarge) return;
                const data = Buffer.concat(responseChunks, responseBytes).toString('utf8');
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        const err = new Error(parsed.error.message || JSON.stringify(parsed.error));
                        err.statusCode = httpRes.statusCode;
                        err.fbErrorCode = parsed.error.code;
                        err.fbErrorSubcode = parsed.error.error_subcode;
                        reject(err);
                        return;
                    }
                    if (httpRes.statusCode >= 400) {
                        const err = new Error(`Facebook API HTTP ${httpRes.statusCode}: ${data.slice(0, 200)}`);
                        if (limits.maxResponseBytes) err.statusCode = httpRes.statusCode;
                        reject(err);
                        return;
                    }
                    resolve(parsed);
                } catch (err) {
                    const parseError = new Error(`FB API returned non-JSON (HTTP ${httpRes.statusCode}): ${data.slice(0, 200)}`);
                    if (limits.maxResponseBytes) parseError.statusCode = httpRes.statusCode;
                    reject(parseError);
                }
            });
        });

        req.setTimeout(limits.timeoutMs || SOCKET_TIMEOUT, () => {
            req.destroy(Object.assign(new Error('Facebook API socket timeout'), { code: 'ETIMEDOUT' }));
        });

        const responseTimer = setTimeout(() => {
            req.destroy(Object.assign(new Error('Facebook API response timeout'), { code: 'ETIMEDOUT' }));
        }, limits.timeoutMs || RESPONSE_TIMEOUT);

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
    const runtime = await resolveOmniRuntimeConfig('facebook', { businessContext: options.businessContext || options.business_context });
    const token = runtime.pageToken || runtime.token;
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
        return { success: false, uncertain: !err.statusCode || err.statusCode >= 500, error: err.message };
    }
}

/**
 * Reply to a Facebook post comment.
 * @param {string} commentId - Facebook comment ID
 * @param {string} text - Reply text
 * @returns {Promise<{success: boolean, commentId?: string, error?: string}>}
 */
async function replyToComment(commentId, text, options = {}) {
    const runtime = await resolveOmniRuntimeConfig('facebook', { businessContext: options.businessContext });
    const token = runtime.pageToken || runtime.token;
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
        return { success: true, commentId: response.id, messageId: response.id };
    } catch (err) {
        log.error('replyToComment failed', err);
        return { success: false, uncertain: !err.statusCode || err.statusCode >= 500, error: err.message };
    }
}

async function sendPrivateReply(commentId, text, options = {}) {
    const runtime = await resolveOmniRuntimeConfig('facebook', { businessContext: options.businessContext });
    const token = runtime.pageToken || runtime.token;
    if (!token) return { success: false, error: 'Facebook не підключено.' };
    try {
        const result = await fbRequest('POST', '/' + encodeURIComponent(commentId) + '/private_replies', { message: text }, token);
        return { success: true, messageId: result.id };
    } catch (err) { return { success: false, uncertain: !err.statusCode || err.statusCode >= 500, error: err.message }; }
}


/**
 * Get a Facebook user's profile information.
 * @param {string} userId - Facebook user PSID
 * @param {string[]} [fields] - Fields to request (default: first_name, last_name, profile_pic)
 * @param {object} options - Must contain an explicit businessContext
 * @returns {Promise<{success: boolean, profile?: object, code?: string, error?: string}>}
 */
async function getUserProfile(userId, fields, options = {}) {
    const context = options.businessContext || options.business_context;
    if (typeof context !== 'string' || !/^[a-z][a-z0-9_]{2,63}$/.test(context.trim())) {
        return { success: false, code: 'PROFILE_CONTEXT_REQUIRED', error: 'Explicit business context is required.' };
    }
    if (!/^[0-9]{1,64}$/.test(String(userId || ''))) {
        return { success: false, code: 'PROFILE_ID_INVALID', error: 'A Facebook PSID is required.' };
    }

    try {
        const businessContext = normalizeBusinessContext(context);
        const runtime = await resolveOmniRuntimeConfig('facebook', { businessContext, strict: true });
        const token = runtime.pageToken || runtime.token;
        if (!token || !runtime.pageId) {
            return { success: false, code: 'PROFILE_CONFIG_MISSING', error: 'Facebook Page configuration is missing for this business.' };
        }
        const validFieldPattern = /^[a-z_]+$/i;
        const defaultFields = 'first_name,last_name,profile_pic';
        let fieldList = defaultFields;
        if (Array.isArray(fields) && fields.length > 0) {
            const sanitized = fields.filter(f => typeof f === 'string' && validFieldPattern.test(f));
            fieldList = sanitized.length > 0 ? sanitized.join(',') : defaultFields;
        }

        const response = await fbRequest('GET', `/${userId}?fields=${encodeURIComponent(fieldList)}`, null, token,
            { timeoutMs: 3000, maxResponseBytes: 64 * 1024 });
        if (!response || typeof response.id !== 'string' || response.id !== String(userId)) {
            return { success: false, code: 'PROFILE_ID_MISMATCH', error: 'Facebook profile identity does not match the requested user.' };
        }
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
        const code = profileErrorCode(err);
        return { success: false, code, error: 'Facebook profile lookup unavailable.' };
    }
}

module.exports = { sendFacebook, replyToComment, getUserProfile, sendPrivateReply };
