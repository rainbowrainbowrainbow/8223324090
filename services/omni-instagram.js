/**
 * services/omni-instagram.js — Instagram Messaging API channel adapter
 *
 * Sends DMs and replies to comments via the Instagram Graph API
 * (uses the same Facebook Graph API endpoint with the linked Facebook Page ID and Page access token).
 * Uses native https module (no axios / no npm deps).
 */
const https = require('https');
const { createLogger } = require('../utils/logger');
const { resolveOmniRuntimeConfig } = require('./omni-accounts');
const { normalizeBusinessContext } = require('./businessContext');
const { profileErrorCode } = require('./omni-meta-profile-errors');

const log = createLogger('OmniInstagram');

const IG_PAGE_TOKEN = process.env.IG_PAGE_TOKEN || '';
const IG_API_VERSION = process.env.IG_API_VERSION || 'v21.0';

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
function igRequest(method, path, body, token = IG_PAGE_TOKEN, limits = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;

        const fullPath = `/${IG_API_VERSION}${path}`;

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
                    req.destroy(Object.assign(new Error('Instagram response too large'), { code: 'PROFILE_RESPONSE_TOO_LARGE' }));
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
                        err.igErrorCode = parsed.error.code;
                        err.igErrorSubcode = parsed.error.error_subcode;
                        reject(err);
                        return;
                    }
                    if (httpRes.statusCode >= 400) {
                        const err = new Error(`Instagram API HTTP ${httpRes.statusCode}: ${data.slice(0, 200)}`);
                        if (limits.maxResponseBytes) err.statusCode = httpRes.statusCode;
                        reject(err);
                        return;
                    }
                    resolve(parsed);
                } catch (err) {
                    const parseError = new Error(`IG API returned non-JSON (HTTP ${httpRes.statusCode}): ${data.slice(0, 200)}`);
                    if (limits.maxResponseBytes) parseError.statusCode = httpRes.statusCode;
                    reject(parseError);
                }
            });
        });

        req.setTimeout(limits.timeoutMs || SOCKET_TIMEOUT, () => {
            const err = new Error('Instagram API socket timeout');
            if (limits.timeoutMs) err.code = 'ETIMEDOUT';
            req.destroy(err);
        });

        const responseTimer = setTimeout(() => {
            const err = new Error('Instagram API response timeout');
            if (limits.timeoutMs) err.code = 'ETIMEDOUT';
            req.destroy(err);
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
 * Send a direct message via Instagram Messenger.
 * @param {string} recipientId - Instagram-scoped user ID (IGSID)
 * @param {string} text - Message text
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendInstagram(recipientId, text, options = {}) {
    const runtime = await resolveOmniRuntimeConfig('instagram', { businessContext: options.businessContext || options.business_context });
    const token = runtime.pageToken || runtime.token;
    if (!token) {
        log.warn('sendInstagram called but IG_PAGE_TOKEN not configured');
        return { success: false, error: 'IG_PAGE_TOKEN not configured' };
    }

    if (!recipientId || (!text && !options.attachment)) {
        return { success: false, error: 'recipientId and text are required' };
    }

    try {
        const body = {
            recipient: { id: recipientId },
            message: options.attachment ? { attachment: options.attachment } : { text }
        };

        log.debug('Sending Instagram DM', { recipientId });

        const response = await igRequest('POST', '/' + encodeURIComponent(runtime.pageId || 'me') + '/messages', body, token);

        log.info('Instagram DM sent', { recipientId, messageId: response.message_id });
        return { success: true, messageId: response.message_id };
    } catch (err) {
        log.error('sendInstagram failed', err);
        return { success: false, uncertain: !err.statusCode || err.statusCode >= 500, error: err.message };
    }
}

/**
 * Reply to an Instagram comment.
 * @param {string} commentId - Instagram comment ID
 * @param {string} text - Reply text
 * @returns {Promise<{success: boolean, commentId?: string, error?: string}>}
 */
async function replyToComment(commentId, text, options = {}) {
    const runtime = await resolveOmniRuntimeConfig('instagram', { businessContext: options.businessContext });
    const token = runtime.pageToken || runtime.token;
    if (!token) {
        log.warn('replyToComment called but IG_PAGE_TOKEN not configured');
        return { success: false, error: 'IG_PAGE_TOKEN not configured' };
    }

    if (!commentId || !text) {
        return { success: false, error: 'commentId and text are required' };
    }

    try {
        log.debug('Replying to IG comment', { commentId });

        const response = await igRequest('POST', `/${commentId}/replies`, { message: text }, token);

        log.info('IG comment reply sent', { parentCommentId: commentId, replyId: response.id });
        return { success: true, commentId: response.id, messageId: response.id };
    } catch (err) {
        log.error('replyToComment failed', err);
        return { success: false, uncertain: !err.statusCode || err.statusCode >= 500, error: err.message };
    }
}

async function sendPrivateReply(commentId, text, options = {}) {
    const runtime = await resolveOmniRuntimeConfig('instagram', { businessContext: options.businessContext });
    const token = runtime.pageToken || runtime.token;
    if (!token) return { success: false, error: 'Instagram не підключено.' };
    try {
        const result = await igRequest('POST', '/' + encodeURIComponent(runtime.pageId || 'me') + '/messages', { recipient: { comment_id: commentId }, message: { text } }, token);
        return { success: true, messageId: result.message_id };
    } catch (err) { return { success: false, uncertain: !err.statusCode || err.statusCode >= 500, error: err.message }; }
}

async function getMediaPermalink(mediaId, options = {}) {
    const runtime = await resolveOmniRuntimeConfig('instagram', { businessContext: options.businessContext });
    const result = await igRequest('GET', '/' + encodeURIComponent(mediaId) + '?fields=permalink', null, runtime.pageToken || runtime.token);
    const url = new URL(result.permalink);
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname)) throw new Error('Invalid permalink');
    return url.href;
}

/**
 * Read an Instagram-scoped user's profile using this business's linked Page token.
 * @param {string} userId - Instagram-scoped user ID (IGSID)
 * @param {string[]} [fields] - Fields to request (default: name, username)
 * @param {object} options - Must contain an explicit businessContext
 * @returns {Promise<{success: boolean, profile?: object, code?: string, error?: string}>}
 */
async function getUserProfile(userId, fields, options = {}) {
    const context = options.businessContext || options.business_context;
    if (typeof context !== 'string' || !/^[a-z][a-z0-9_]{2,63}$/.test(context.trim())) {
        return { success: false, code: 'PROFILE_CONTEXT_REQUIRED', error: 'Explicit business context is required.' };
    }
    if (!/^[0-9]{1,64}$/.test(String(userId || ''))) {
        return { success: false, code: 'PROFILE_ID_INVALID', error: 'An Instagram-scoped user ID is required.' };
    }

    try {
        const businessContext = normalizeBusinessContext(context);
        const runtime = await resolveOmniRuntimeConfig('instagram', { businessContext, strict: true,
            ...(options.ownershipClient && { ownershipClient: options.ownershipClient }) });
        const token = runtime.pageToken || runtime.token;
        if (!token || !runtime.pageId) {
            return { success: false, code: 'PROFILE_CONFIG_MISSING', error: 'Instagram Page configuration is missing for this business.' };
        }
        const validFieldPattern = /^[a-z_]+$/i;
        const defaultFields = 'name,username';
        let fieldList = defaultFields;
        if (Array.isArray(fields) && fields.length > 0) {
            const sanitized = fields.filter(field => typeof field === 'string' && validFieldPattern.test(field));
            fieldList = sanitized.length > 0 ? sanitized.join(',') : defaultFields;
        }

        const response = await igRequest('GET', `/${userId}?fields=${encodeURIComponent(fieldList)}`, null, token,
            { timeoutMs: 3000, maxResponseBytes: 64 * 1024 });
        if (!response || typeof response.id !== 'string' || response.id !== String(userId)) {
            return { success: false, code: 'PROFILE_ID_MISMATCH', error: 'Instagram profile identity does not match the requested user.' };
        }
        return { success: true, profile: response };
    } catch (err) {
        return { success: false, code: profileErrorCode(err), error: 'Instagram profile lookup unavailable.' };
    }
}

module.exports = { sendInstagram, replyToComment, sendPrivateReply, getMediaPermalink, getUserProfile };
