/**
 * services/omni-sms.js — TurboSMS API channel adapter
 *
 * Sends SMS messages via TurboSMS (Ukrainian provider).
 * Uses native https module (no axios / no npm deps).
 * API docs: https://turbosms.ua/api.html
 */
const https = require('https');
const { createLogger } = require('../utils/logger');

const log = createLogger('OmniSMS');

const TURBOSMS_TOKEN = process.env.TURBOSMS_TOKEN || '';
const TURBOSMS_SENDER = process.env.TURBOSMS_SENDER || 'EventGenix';

const SOCKET_TIMEOUT = 15000;
const RESPONSE_TIMEOUT = 15000;

if (!TURBOSMS_TOKEN) {
    log.warn('TURBOSMS_TOKEN not set. SMS channel disabled.');
}

/**
 * Low-level POST request to TurboSMS API.
 * @param {string} path - API path (e.g. '/message/send.json')
 * @param {object} body - JSON payload
 * @returns {Promise<object>} parsed response
 */
function turboSmsRequest(path, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);

        const options = {
            hostname: 'api.turbosms.ua',
            port: 443,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TURBOSMS_TOKEN}`,
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (err) {
                    reject(new Error(`TurboSMS API returned non-JSON: ${data.slice(0, 200)}`));
                }
            });
        });

        req.setTimeout(SOCKET_TIMEOUT, () => {
            req.destroy(new Error('TurboSMS API socket timeout'));
        });

        const responseTimer = setTimeout(() => {
            req.destroy(new Error('TurboSMS API response timeout'));
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
 * Normalize a Ukrainian phone number to international format.
 * @param {string} phone - Phone number in any format
 * @returns {string} Phone in +380XXXXXXXXX format
 */
function normalizePhone(phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('380') && digits.length === 12) {
        return '+' + digits;
    }
    if (digits.startsWith('0') && digits.length === 10) {
        return '+38' + digits;
    }
    if (digits.startsWith('80') && digits.length === 11) {
        return '+3' + digits;
    }
    // Return as-is with + prefix if already looks international
    return digits.startsWith('+') ? phone : '+' + digits;
}

/**
 * Send a single SMS message.
 * @param {string} phone - Recipient phone number
 * @param {string} text - Message text
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendSMS(phone, text) {
    if (!TURBOSMS_TOKEN) {
        log.warn('sendSMS called but TURBOSMS_TOKEN not configured');
        return { success: false, error: 'TURBOSMS_TOKEN not configured' };
    }

    if (!phone || !text) {
        return { success: false, error: 'phone and text are required' };
    }

    try {
        const normalizedPhone = normalizePhone(phone);
        const body = {
            recipients: [normalizedPhone],
            sms: {
                sender: TURBOSMS_SENDER,
                text
            }
        };

        log.debug('Sending SMS', { phone: normalizedPhone });

        const response = await turboSmsRequest('/message/send.json', body);

        if (response.response_code === 0 && response.response_result) {
            const result = response.response_result[0];
            if (result && result.response_code === 0) {
                log.info('SMS sent', { phone: normalizedPhone, messageId: result.message_id });
                return { success: true, messageId: result.message_id };
            }

            const errorMsg = result ? result.response_status : 'Unknown send error';
            log.warn('SMS send failed for recipient', { phone: normalizedPhone, error: errorMsg });
            return { success: false, error: errorMsg };
        }

        const errorMsg = response.response_status || `TurboSMS code ${response.response_code}`;
        log.warn('TurboSMS API error', { responseCode: response.response_code, status: errorMsg });
        return { success: false, error: errorMsg };
    } catch (err) {
        log.error('sendSMS failed', err);
        return { success: false, error: err.message };
    }
}

/**
 * Send SMS to multiple recipients in a single API call.
 * @param {string[]} phones - Array of phone numbers
 * @param {string} text - Message text
 * @returns {Promise<{success: boolean, results?: Array<{phone: string, messageId?: string, error?: string}>, error?: string}>}
 */
async function sendBulkSMS(phones, text) {
    if (!TURBOSMS_TOKEN) {
        log.warn('sendBulkSMS called but TURBOSMS_TOKEN not configured');
        return { success: false, error: 'TURBOSMS_TOKEN not configured' };
    }

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
        return { success: false, error: 'phones array is required and must not be empty' };
    }

    if (!text) {
        return { success: false, error: 'text is required' };
    }

    try {
        const normalizedPhones = phones.map(normalizePhone);
        const body = {
            recipients: normalizedPhones,
            sms: {
                sender: TURBOSMS_SENDER,
                text
            }
        };

        log.debug('Sending bulk SMS', { count: normalizedPhones.length });

        const response = await turboSmsRequest('/message/send.json', body);

        if (response.response_code === 0 && response.response_result) {
            const results = response.response_result.map((result, index) => {
                if (result.response_code === 0) {
                    return { phone: normalizedPhones[index], messageId: result.message_id };
                }
                return { phone: normalizedPhones[index], error: result.response_status };
            });

            const successCount = results.filter(r => r.messageId).length;
            log.info('Bulk SMS completed', { total: results.length, success: successCount, failed: results.length - successCount });

            return { success: true, results };
        }

        const errorMsg = response.response_status || `TurboSMS code ${response.response_code}`;
        log.warn('TurboSMS bulk API error', { responseCode: response.response_code, status: errorMsg });
        return { success: false, error: errorMsg };
    } catch (err) {
        log.error('sendBulkSMS failed', err);
        return { success: false, error: err.message };
    }
}

module.exports = { sendSMS, sendBulkSMS };
