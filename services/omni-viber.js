/**
 * services/omni-viber.js — Viber REST API channel adapter
 *
 * Sends messages and manages webhooks via Viber Bot API.
 * Uses native https module (no axios / no npm deps).
 */
const https = require('https');
const { createLogger } = require('../utils/logger');
const { resolveOmniRuntimeConfig } = require('./omni-accounts');

const log = createLogger('OmniViber');

const VIBER_TOKEN = process.env.VIBER_TOKEN || '';
const VIBER_SENDER_NAME = process.env.VIBER_SENDER_NAME || 'EventGenix';

const SOCKET_TIMEOUT = 15000;
const RESPONSE_TIMEOUT = 15000;

if (!VIBER_TOKEN) {
    log.warn('VIBER_TOKEN not set. Viber channel disabled.');
}

/**
 * Low-level POST request to Viber API.
 * @param {string} path - API path (e.g. '/pa/send_message')
 * @param {object} body - JSON payload
 * @returns {Promise<object>} parsed response
 */
function viberRequest(path, body, token = VIBER_TOKEN) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);

        const options = {
            hostname: 'chatapi.viber.com',
            port: 443,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Viber-Auth-Token': token,
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, (httpRes) => {
            let data = '';
            httpRes.on('data', (chunk) => { data += chunk; });
            httpRes.on('end', () => {
                if (httpRes.statusCode >= 400) {
                    reject(new Error(`Viber API HTTP ${httpRes.statusCode}: ${data.slice(0, 200)}`));
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (err) {
                    reject(new Error(`Viber API returned non-JSON (HTTP ${httpRes.statusCode}): ${data.slice(0, 200)}`));
                }
            });
        });

        req.setTimeout(SOCKET_TIMEOUT, () => {
            req.destroy(new Error('Viber API socket timeout'));
        });

        const responseTimer = setTimeout(() => {
            req.destroy(new Error('Viber API response timeout'));
        }, RESPONSE_TIMEOUT);

        req.on('close', () => clearTimeout(responseTimer));

        req.on('error', (err) => {
            clearTimeout(responseTimer);
            reject(err);
        });

        req.write(payload);
        req.end();
    });
}

/**
 * Send a text message to a Viber user.
 * @param {string} receiverId - Viber user ID
 * @param {string} text - Message text
 * @param {object} [options] - Optional overrides
 * @param {string} [options.type] - Message type (default 'text')
 * @param {string} [options.senderName] - Override sender name
 * @param {string} [options.senderAvatar] - Sender avatar URL
 * @param {string} [options.mediaUrl] - Media URL for picture/video/file types
 * @param {string} [options.thumbnail] - Thumbnail URL for media messages
 * @param {object} [options.keyboard] - Viber keyboard object
 * @returns {Promise<{success: boolean, messageToken?: number, error?: string}>}
 */
async function sendViber(receiverId, text, options = {}) {
    const runtime = await resolveOmniRuntimeConfig('viber');
    const token = runtime.token || VIBER_TOKEN;
    const senderName = runtime.senderName || VIBER_SENDER_NAME;
    if (!token) {
        log.warn('sendViber called but VIBER_TOKEN not configured');
        return { success: false, error: 'VIBER_TOKEN not configured' };
    }

    if (!receiverId || !text) {
        return { success: false, error: 'receiverId and text are required' };
    }

    try {
        const body = {
            receiver: receiverId,
            type: options.type || 'text',
            text,
            sender: {
                name: options.senderName || senderName,
                ...((options.senderAvatar || runtime.senderAvatar) && { avatar: options.senderAvatar || runtime.senderAvatar })
            }
        };

        if (options.mediaUrl) {
            body.media = options.mediaUrl;
        }
        if (options.thumbnail) {
            body.thumbnail = options.thumbnail;
        }
        if (options.keyboard) {
            body.keyboard = options.keyboard;
        }

        log.debug('Sending Viber message', { receiverId, type: body.type });

        const response = await viberRequest('/pa/send_message', body, token);

        if (response.status === 0) {
            log.info('Viber message sent', { receiverId, messageToken: response.message_token });
            return { success: true, messageToken: response.message_token };
        }

        log.warn('Viber API error', { status: response.status, statusMessage: response.status_message });
        return { success: false, error: response.status_message || `Viber status ${response.status}` };
    } catch (err) {
        log.error('sendViber failed', err);
        return { success: false, error: err.message };
    }
}

/**
 * Register a webhook URL with Viber.
 * @param {string} url - Public HTTPS URL for webhook
 * @param {string[]} [eventTypes] - Event types to subscribe (default: all)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function setViberWebhook(url, eventTypes) {
    const runtime = await resolveOmniRuntimeConfig('viber');
    const token = runtime.token || VIBER_TOKEN;
    if (!token) {
        log.warn('setViberWebhook called but VIBER_TOKEN not configured');
        return { success: false, error: 'VIBER_TOKEN not configured' };
    }

    if (!url) {
        return { success: false, error: 'Webhook URL is required' };
    }

    try {
        const body = { url };
        if (eventTypes && eventTypes.length > 0) {
            body.event_types = eventTypes;
        }

        log.info('Setting Viber webhook', { url });

        const response = await viberRequest('/pa/set_webhook', body, token);

        if (response.status === 0) {
            log.info('Viber webhook registered', { url, eventTypes: response.event_types });
            return { success: true };
        }

        log.warn('Viber webhook registration failed', { status: response.status, statusMessage: response.status_message });
        return { success: false, error: response.status_message || `Viber status ${response.status}` };
    } catch (err) {
        log.error('setViberWebhook failed', err);
        return { success: false, error: err.message };
    }
}

module.exports = { sendViber, setViberWebhook };
