'use strict';

const { pool } = require('../db');
const { getUserProfile } = require('./omni-facebook');
const { createLogger } = require('../utils/logger');

const log = createLogger('OmniFacebookProfile');
const pending = new Map();
const retryAfter = new Map();
const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_PENDING = 16;
const MAX_RETRY_ENTRIES = 1000;

function needsProfileName(name) {
    return typeof name !== 'string' || !name.trim() || name.trim().toLowerCase() === 'unknown';
}

// Best effort after message persistence. No network or DB failure escapes to the webhook.
function enrichFacebookConversation(conversation, businessContext) {
    if (conversation?.channel !== 'facebook' || !needsProfileName(conversation.customerName)
        || typeof businessContext !== 'string' || !/^[a-z][a-z0-9_]{2,63}$/.test(businessContext)
        || conversation.businessContext !== businessContext
        || !/^[0-9]+$/.test(String(conversation.id || ''))
        || !/^[0-9]{1,64}$/.test(String(conversation.externalId || ''))) return Promise.resolve(null);

    const key = JSON.stringify([businessContext, conversation.id, conversation.externalId]);
    if (pending.has(key)) return pending.get(key);
    const now = Date.now();
    for (const [entry, expires] of retryAfter) {
        if (expires <= now) retryAfter.delete(entry);
    }
    if (retryAfter.has(key) || pending.size >= MAX_PENDING) return Promise.resolve(null);

    const task = Promise.resolve().then(async () => {
        const result = await getUserProfile(String(conversation.externalId), ['first_name', 'last_name'], { businessContext });
        if (!result.success) {
            log.warn('Facebook conversation name unavailable', {
                businessContext,
                code: result.code || 'PROFILE_UNAVAILABLE',
                nextAction: result.code === 'PROFILE_ACCESS_DENIED'
                    ? 'Check pages_messaging and Business Asset User Profile Access in Meta App Review.'
                    : 'Check Facebook profile lookup configuration; retry occurs on a later inbound message.',
            });
            return null;
        }
        const name = [result.profile?.firstName, result.profile?.lastName]
            .filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean)
            .join(' ').slice(0, 255);
        if (needsProfileName(name)) {
            log.warn('Facebook conversation name unavailable', { businessContext, code: 'PROFILE_NAME_EMPTY' });
            return null;
        }
        // The conditional update preserves names assigned while the API request was in flight.
        const updated = await pool.query({
            text: "UPDATE conversations SET customer_name = $1, updated_at = NOW() "
                + "WHERE id = $2 AND channel = 'facebook' AND external_id = $3 "
                + "AND COALESCE(business_context, 'event_genix') = $4 "
                + "AND (customer_name IS NULL OR BTRIM(customer_name) = '' "
                + "OR LOWER(BTRIM(customer_name)) = 'unknown') RETURNING id",
            values: [name, conversation.id, String(conversation.externalId), businessContext],
            query_timeout: 3000,
        });
        return updated.rows.length ? { id: conversation.id, businessContext } : null;
    }).catch(() => {
        // Provider errors can contain tokens, PSIDs or profile data. Never log raw errors.
        log.warn('Facebook conversation name unavailable', { businessContext, code: 'PROFILE_ENRICHMENT_FAILED' });
        return null;
    }).finally(() => {
        pending.delete(key);
        if (retryAfter.size >= MAX_RETRY_ENTRIES) retryAfter.delete(retryAfter.keys().next().value);
        retryAfter.set(key, Date.now() + RETRY_DELAY_MS);
    });
    pending.set(key, task);
    return task;
}

module.exports = { enrichFacebookConversation };
