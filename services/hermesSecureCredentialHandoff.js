'use strict';

const { createLogger } = require('../utils/logger');

const log = createLogger('HermesSecureCredentialHandoff');

const BUSINESS_CONTEXT = 'event_genix';
const DEFAULT_OWNER_USER_ID = 4;
const CHANNEL_OWNER_DM = 'owner_dm';
const DISABLED_VALUES = new Set(['0', 'false', 'off', 'disabled', 'none', 'no']);

function envText(env, key) {
    return String(env?.[key] ?? '').trim();
}

function envBool(env, key, defaultValue = false) {
    const value = envText(env, key).toLowerCase();
    if (!value) return defaultValue;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(value)) return true;
    if (DISABLED_VALUES.has(value)) return false;
    return defaultValue;
}

function cleanId(value) {
    const text = String(value ?? '').trim();
    return /^-?\d{1,20}$/.test(text) ? text : '';
}

function cleanPositiveInt(value, fallback = null) {
    const text = String(value ?? '').trim();
    if (!/^\d{1,10}$/.test(text)) return fallback;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function requestLabel(request = {}) {
    const requestId = request.requestId || request.request_id || request.id || 'unknown';
    const requestType = request.requestType || request.request_type || 'staff_account_onboarding';
    return `${String(requestType).slice(0, 80)} / ${String(requestId).slice(0, 80)}`;
}

function credentialMessage({ credential, request }) {
    return [
        '🔐 <b>Event Genix CRM: одноразовий доступ</b>',
        '',
        `Запит: <code>${escapeHtml(requestLabel(request))}</code>`,
        `Логін: <code>${escapeHtml(credential?.username || '')}</code>`,
        `Пароль: <code>${escapeHtml(credential?.password || '')}</code>`,
        '',
        '⚠️ Пароль одноразовий. Не пересилай у групи або публічні чати.'
    ].join('\n');
}

async function queryOwnerChatId(pool, ownerUserId) {
    if (!pool || typeof pool.query !== 'function' || !ownerUserId) return null;
    const result = await pool.query(
        `SELECT telegram_chat_id
           FROM users
          WHERE id = $1
            AND is_active IS DISTINCT FROM false
          LIMIT 1`,
        [ownerUserId]
    );
    return cleanId(result.rows?.[0]?.telegram_chat_id);
}

function resolveConfiguredOwnerChatId(env) {
    return cleanId(envText(env, 'HERMES_STAFF_ACCOUNT_ONBOARDING_CREDENTIAL_HANDOFF_OWNER_CHAT_ID'))
        || cleanId(envText(env, 'EVENT_GENIX_CREDENTIAL_HANDOFF_OWNER_CHAT_ID'))
        || cleanId(envText(env, 'HERMES_CREDENTIAL_HANDOFF_OWNER_CHAT_ID'));
}

function resolveOwnerUserId(env) {
    return cleanPositiveInt(
        envText(env, 'HERMES_STAFF_ACCOUNT_ONBOARDING_CREDENTIAL_HANDOFF_OWNER_USER_ID')
            || envText(env, 'EVENT_GENIX_CREDENTIAL_HANDOFF_OWNER_USER_ID')
            || envText(env, 'EVENT_GENIX_CRM_AGENT_OWNER_USER_ID'),
        DEFAULT_OWNER_USER_ID
    );
}

function hasTelegramToken(env) {
    return Boolean(envText(env, 'TELEGRAM_BOT_TOKEN'));
}

function handoffDisabled(env) {
    const mode = envText(env, 'HERMES_STAFF_ACCOUNT_ONBOARDING_CREDENTIAL_HANDOFF_MODE').toLowerCase();
    if (DISABLED_VALUES.has(mode)) return true;
    return envBool(env, 'HERMES_STAFF_ACCOUNT_ONBOARDING_CREDENTIAL_HANDOFF_DISABLED', false);
}

function handoffEnabled(env) {
    if (handoffDisabled(env)) return false;
    const mode = envText(env, 'HERMES_STAFF_ACCOUNT_ONBOARDING_CREDENTIAL_HANDOFF_MODE').toLowerCase();
    if (mode && mode !== CHANNEL_OWNER_DM) return false;
    if (mode === CHANNEL_OWNER_DM) return true;
    if (envBool(env, 'HERMES_STAFF_ACCOUNT_ONBOARDING_CREDENTIAL_HANDOFF_ENABLED', false)) return true;
    if (resolveConfiguredOwnerChatId(env)) return true;
    return Boolean(envText(env, 'EVENT_GENIX_CRM_AGENT_OWNER_USER_ID')) && hasTelegramToken(env);
}

function createOwnerDmSecureCredentialHandoff({ env = process.env, pool, telegramService } = {}) {
    const ownerUserId = resolveOwnerUserId(env);
    const configuredOwnerChatId = resolveConfiguredOwnerChatId(env);

    async function resolveTargetChatId() {
        return configuredOwnerChatId || await queryOwnerChatId(pool, ownerUserId);
    }

    async function preflight() {
        const telegram = telegramService || require('./telegram');
        const chatId = await resolveTargetChatId();
        const tokenReady = Boolean(envText(env, 'TELEGRAM_BOT_TOKEN') || telegram.TELEGRAM_BOT_TOKEN);
        const ready = tokenReady && Boolean(chatId);
        return {
            ready,
            channel: CHANNEL_OWNER_DM,
            target: chatId ? 'owner_dm' : null,
            meta: {
                ownerUserId,
                targetResolved: Boolean(chatId),
                telegramTokenConfigured: tokenReady,
                nonCredentialPreflight: true,
                staffWrites: 0,
                accountWrites: 0,
                credentialIssued: false,
                credentialMaterialReturnedInHermesResponse: false
            }
        };
    }

    async function handoff({ credential, request }) {
        const telegram = telegramService || require('./telegram');
        const chatId = await resolveTargetChatId();
        const tokenReady = Boolean(envText(env, 'TELEGRAM_BOT_TOKEN') || telegram.TELEGRAM_BOT_TOKEN);
        if (!credential?.username || !credential?.password || !tokenReady || !chatId) {
            return {
                delivered: false,
                channel: CHANNEL_OWNER_DM,
                target: chatId ? 'owner_dm' : null,
                meta: {
                    ownerUserId,
                    targetResolved: Boolean(chatId),
                    telegramTokenConfigured: tokenReady
                }
            };
        }
        const result = await telegram.sendTelegramMessage(chatId, credentialMessage({ credential, request }), {
            skipThread: true,
            retries: 1,
            businessContext: BUSINESS_CONTEXT,
            silent: false
        });
        const delivered = result?.ok === true;
        if (!delivered) {
            log.warn('Secure credential handoff delivery was not confirmed', {
                channel: CHANNEL_OWNER_DM,
                ownerUserId,
                telegramOk: result?.ok === true,
                telegramErrorCode: result?.error_code || null
            });
        }
        return {
            delivered,
            channel: CHANNEL_OWNER_DM,
            target: 'owner_dm',
            meta: {
                ownerUserId,
                telegramMessageId: result?.result?.message_id || null,
                staffWrites: 0,
                accountWrites: 0,
                credentialMaterialReturnedInHermesResponse: false
            }
        };
    }

    handoff.preflight = preflight;
    handoff.assertReady = preflight;
    handoff.channel = CHANNEL_OWNER_DM;
    return handoff;
}

function createDefaultSecureCredentialHandoff(options = {}) {
    const env = options.env || process.env;
    if (!handoffEnabled(env)) return null;
    return createOwnerDmSecureCredentialHandoff(options);
}

module.exports = {
    CHANNEL_OWNER_DM,
    DEFAULT_OWNER_USER_ID,
    createDefaultSecureCredentialHandoff,
    createOwnerDmSecureCredentialHandoff,
    credentialMessage,
    handoffEnabled,
    resolveOwnerUserId,
    resolveConfiguredOwnerChatId
};
