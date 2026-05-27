'use strict';

/**
 * services/omni-sms.js - provider-aware SMS channel adapter.
 *
 * The channel runtime is resolved from Omni account configuration. TurboSMS
 * remains supported for legacy setups, while FlySMS/SMS-fly is available as a
 * first-class provider.
 */

const { createLogger } = require('../utils/logger');
const { resolveOmniRuntimeConfig } = require('./omni-accounts');
const {
    sendSmsViaProvider,
    sendBulkSmsViaProvider,
    normalizeSmsProvider,
} = require('./omni-sms-providers');

const log = createLogger('OmniSMS');

async function smsRuntime(options = {}) {
    const runtime = await resolveOmniRuntimeConfig('sms', { businessContext: options.businessContext || options.business_context });
    const provider = normalizeSmsProvider(runtime.provider) || normalizeSmsProvider(process.env.SMS_PROVIDER) || 'flysms';
    return { ...runtime, provider };
}

async function sendSMS(phone, text, options = {}) {
    if (!phone || !text) {
        return { success: false, error: 'phone and text are required' };
    }

    try {
        const runtime = await smsRuntime(options);
        log.debug('Sending SMS', { provider: runtime.provider });
        return await sendSmsViaProvider(runtime, phone, text);
    } catch (err) {
        log.error('sendSMS failed', err);
        return { success: false, error: err.message };
    }
}

async function sendBulkSMS(phones, text, options = {}) {
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
        return { success: false, error: 'phones array is required and must not be empty' };
    }
    if (!text) {
        return { success: false, error: 'text is required' };
    }

    try {
        const runtime = await smsRuntime(options);
        log.debug('Sending bulk SMS', { provider: runtime.provider, count: phones.length });
        return await sendBulkSmsViaProvider(runtime, phones, text);
    } catch (err) {
        log.error('sendBulkSMS failed', err);
        return { success: false, error: err.message };
    }
}

module.exports = { sendSMS, sendBulkSMS };
