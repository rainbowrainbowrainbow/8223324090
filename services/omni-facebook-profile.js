'use strict';

const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('OmniMetaProfile');
const pending = new Map();
const retryAfter = new Map();
const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_PENDING = 16;
const MAX_RETRY_ENTRIES = 1000;

function needsProfileName(name) {
    return typeof name !== 'string' || !name.trim() || name.trim().toLowerCase() === 'unknown';
}

// Shared by inbound enrichment and the bounded operator repair. Never log the result.
async function lookupMetaName(conversation, options = {}) {
    const { channel, externalId, businessContext } = conversation;
    if (!['facebook', 'instagram'].includes(channel) || typeof businessContext !== 'string'
        || !/^[a-z][a-z0-9_]{2,63}$/.test(businessContext) || typeof externalId !== 'string'
        || !/^[0-9]{1,64}$/.test(externalId)) return { success: false, code: 'PROFILE_ID_INVALID' };
    const adapter = channel === 'facebook' ? require('./omni-facebook') : require('./omni-instagram');
    const fields = channel === 'facebook' ? ['first_name', 'last_name'] : ['name', 'username'];
    const result = await adapter.getUserProfile(externalId, fields, { businessContext,
        ...(options.ownershipClient && { ownershipClient: options.ownershipClient }) });
    if (!result.success) return { success: false, code: result.code || 'PROFILE_UNAVAILABLE' };
    if (result.profile?.id !== externalId) return { success: false, code: 'PROFILE_ID_MISMATCH' };
    const candidate = channel === 'facebook'
        ? [result.profile.firstName, result.profile.lastName]
            .filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean).join(' ')
        : (needsProfileName(result.profile.name) ? result.profile.username : result.profile.name);
    const name = typeof candidate === 'string' ? candidate.trim().slice(0, 255) : '';
    if (needsProfileName(name)) return { success: false, code: 'PROFILE_NAME_EMPTY' };
    return { success: true, name, profileId: result.profile.id };
}

async function updateMetaName(client, conversation, result, snapshot) {
    const { id, externalId, businessContext, channel } = conversation;
    if (!['facebook', 'instagram'].includes(channel) || !result.success || result.profileId !== externalId
        || needsProfileName(result.name)) return false;
    const values = [result.name, id, externalId, businessContext, channel];
    let guard = '';
    if (snapshot) {
        guard = ' AND created_at::text = $6 AND updated_at::text IS NOT DISTINCT FROM $7';
        values.push(snapshot.createdAt, snapshot.updatedAt);
    }
    const updated = await client.query({
        text: "UPDATE conversations SET customer_name = $1, updated_at = NOW() "
            + "WHERE id = $2 AND channel = $5 AND external_id = $3 "
            + "AND COALESCE(business_context, 'event_genix') = $4 "
            + "AND (customer_name IS NULL OR BTRIM(customer_name) = '' "
            + "OR LOWER(BTRIM(customer_name)) = 'unknown')" + guard + ' RETURNING id',
        values,
        query_timeout: 3000,
    });
    return updated.rows.length > 0;
}

// Best effort after message persistence. No network or DB failure escapes to the webhook.
function enrichMetaConversation(conversation, businessContext) {
    if (!['facebook', 'instagram'].includes(conversation?.channel) || !needsProfileName(conversation.customerName)
        || typeof businessContext !== 'string' || !/^[a-z][a-z0-9_]{2,63}$/.test(businessContext)
        || conversation.businessContext !== businessContext
        || !/^[0-9]+$/.test(String(conversation.id || ''))
        || !/^[0-9]{1,64}$/.test(String(conversation.externalId || ''))) return Promise.resolve(null);

    // Keep the validated identity stable while the provider request is in flight.
    const { id, channel } = conversation;
    const externalId = String(conversation.externalId);
    const key = JSON.stringify([businessContext, channel, String(id), externalId]);
    if (pending.has(key)) return pending.get(key);
    const now = Date.now();
    for (const [entry, expires] of retryAfter) {
        if (expires <= now) retryAfter.delete(entry);
    }
    if (retryAfter.has(key) || pending.size >= MAX_PENDING) return Promise.resolve(null);

    const task = Promise.resolve().then(async () => {
        const identity = { id, channel, externalId, businessContext };
        const result = await lookupMetaName(identity);
        if (!result.success) {
            log.warn('Meta conversation name unavailable', {
                businessContext,
                channel,
                code: result.code || 'PROFILE_UNAVAILABLE',
                nextAction: result.code === 'PROFILE_ACCESS_DENIED'
                    ? (channel === 'facebook'
                        ? 'Check pages_messaging and Business Asset User Profile Access in Meta App Review.'
                        : 'Check Instagram messaging profile access in Meta App Review.')
                    : 'Check the scoped profile lookup diagnostic; retry occurs on a later inbound message.',
            });
            return null;
        }
        // The conditional update preserves names assigned while the API request was in flight.
        const updated = await updateMetaName(pool, identity, result);
        return updated ? { id, businessContext } : null;
    }).catch(() => {
        // Provider errors can contain tokens, PSIDs or profile data. Never log raw errors.
        log.warn('Meta conversation name unavailable', { businessContext, channel, code: 'PROFILE_ENRICHMENT_FAILED' });
        return null;
    }).finally(() => {
        pending.delete(key);
        if (retryAfter.size >= MAX_RETRY_ENTRIES) retryAfter.delete(retryAfter.keys().next().value);
        retryAfter.set(key, Date.now() + RETRY_DELAY_MS);
    });
    pending.set(key, task);
    return task;
}

// Preserve the Facebook-only entry point for existing callers.
function enrichFacebookConversation(conversation, businessContext) {
    return conversation?.channel === 'facebook'
        ? enrichMetaConversation(conversation, businessContext)
        : Promise.resolve(null);
}

module.exports = { enrichFacebookConversation, enrichMetaConversation, needsProfileName, lookupMetaName, updateMetaName };
