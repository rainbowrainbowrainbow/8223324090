#!/usr/bin/env node
'use strict';

// Operator only: no startup, migrations, scheduler, retries or customer-facing surface.
const crypto = require('node:crypto');
const MAX_TARGETS = 3;
const COHORT = Object.freeze([
    { channel: 'facebook', createdAt: '2026-09-20 15:12:32.92626' },
    { channel: 'facebook', createdAt: '2026-09-20 16:00:15.952587' },
    { channel: 'instagram', createdAt: '2026-09-20 17:31:00.791277' },
]);
const SAFE_CODES = new Set([
    'PROFILE_CONTEXT_REQUIRED', 'PROFILE_ID_INVALID', 'PROFILE_CONFIG_MISSING',
    'PROFILE_ID_MISMATCH', 'PROFILE_TOKEN_INVALID', 'PROFILE_OBJECT_UNAVAILABLE',
    'PROFILE_REQUEST_INVALID', 'PROFILE_ACCESS_DENIED', 'PROFILE_TIMEOUT',
    'PROFILE_RESPONSE_TOO_LARGE', 'PROFILE_UNAVAILABLE', 'PROFILE_NAME_EMPTY',
]);
function fail(code) { throw Object.assign(new Error(code), { safeCode: code }); }
function validateOptions(options) {
    if (typeof options.businessContext !== 'string' || !/^[a-z][a-z0-9_]{2,63}$/.test(options.businessContext)) fail('BUSINESS_REQUIRED');
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_TARGETS) fail('LIMIT_INVALID');
    if (options.apply !== undefined && typeof options.apply !== 'boolean') fail('MODE_INVALID');
    if (options.apply && options.inspectOnly) fail('MODE_CONFLICT');
    if (options.expectedScopeDigest && !/^[a-f0-9]{64}$/.test(options.expectedScopeDigest)) fail('SCOPE_DIGEST_INVALID');
    if (options.apply && !options.expectedScopeDigest) fail('APPLY_REQUIRES_SCOPE_DIGEST');
    if (options.cohort) {
        if (options.cohort !== 'diagnosis-2026-09-21' || options.businessContext !== 'event_genix'
            || options.targets || options.limit !== 3) fail('COHORT_INVALID');
        return COHORT;
    }
    if (!Array.isArray(options.targets) || !options.targets.length || options.targets.length !== options.limit) fail('EXACT_TARGETS_REQUIRED');
    const seen = new Set();
    return options.targets.map(target => {
        if (!target || !['facebook', 'instagram'].includes(target.channel)
            || typeof target.conversationId !== 'string' || !/^[1-9][0-9]{0,9}$/.test(target.conversationId)
            || typeof target.createdAt !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,6})?$/.test(target.createdAt)
            || seen.has(target.conversationId)) fail('TARGET_INVALID');
        seen.add(target.conversationId);
        return { channel: target.channel, conversationId: target.conversationId, createdAt: target.createdAt };
    });
}

const COLUMNS = `id::text AS id, channel, external_id AS "externalId", customer_name AS "customerName",
    COALESCE(business_context, 'event_genix') AS "businessContext", created_at::text AS "createdAt",
    updated_at::text AS "updatedAt"`;

async function resolveScope(client, options) {
    const selectors = validateOptions(options);
    const targets = [];
    for (const selector of selectors) {
        // Native timestamp text is intentional: never parse this column with Date/pg timestamp conversion.
        const values = [options.businessContext, selector.channel, selector.createdAt];
        const idGuard = selector.conversationId ? ' AND id::text = $4' : '';
        if (selector.conversationId) values.push(selector.conversationId);
        const result = await client.query({
            text: `SELECT ${COLUMNS} FROM conversations WHERE COALESCE(business_context, 'event_genix') = $1
                AND channel = $2 AND created_at::text = $3${idGuard} LIMIT 2`, values, query_timeout: 3000,
        });
        if (result.rows.length !== 1) fail('SCOPE_NOT_UNIQUE_OR_MISSING');
        const row = result.rows[0];
        if (row.businessContext !== options.businessContext || row.channel !== selector.channel || row.createdAt !== selector.createdAt
            || !/^[1-9][0-9]*$/.test(row.id) || typeof row.externalId !== 'string' || !/^[0-9]{1,64}$/.test(row.externalId)
            || (selector.conversationId && row.id !== selector.conversationId)) fail('SCOPE_INVALID');
        targets.push({ ...row });
    }
    if (new Set(targets.map(row => row.id)).size !== targets.length) fail('DUPLICATE_TARGET');
    return targets;
}

async function inspectProvenance(client, target, pageId) {
    // Retrieve only identity fields. Never load message text, attachments or entire webhook payloads.
    const result = await client.query({ text: `SELECT external_message_id AS "messageId",
        COALESCE(meta #>> '{rawEvent,sender,id}', meta #>> '{rawEvent,entry,0,messaging,0,sender,id}') AS sender,
        COALESCE(meta #>> '{rawEvent,recipient,id}', meta #>> '{rawEvent,entry,0,messaging,0,recipient,id}') AS recipient,
        COALESCE(meta #>> '{rawEvent,message,mid}', meta #>> '{rawEvent,entry,0,messaging,0,message,mid}') AS "webhookMessageId",
        COALESCE(meta #>> '{rawEvent,message,is_echo}', meta #>> '{rawEvent,entry,0,messaging,0,message,is_echo}', 'false') AS echo
        FROM conversation_messages WHERE conversation_id = $1 AND direction = 'inbound'
        ORDER BY created_at, id LIMIT 20`, values: [target.id], query_timeout: 3000 });
    const rows = result.rows;
    return {
        sampledInbound: rows.length, sampleLimit: 20,
        senderPresent: rows.length > 0 && rows.every(row => Boolean(row.sender)),
        senderMatchesExternalId: rows.length > 0 && rows.every(row => row.sender === target.externalId),
        recipientPresent: rows.length > 0 && rows.every(row => Boolean(row.recipient)),
        recipientMatchesConfiguredPage: Boolean(pageId) && rows.length > 0 && rows.every(row => row.recipient === pageId),
        messageIdPresent: rows.length > 0 && rows.every(row => Boolean(row.messageId && row.webhookMessageId)),
        messageIdMatches: rows.length > 0 && rows.every(row => Boolean(row.messageId) && row.messageId === row.webhookMessageId),
        noEcho: rows.length > 0 && rows.every(row => row.echo === 'false'),
    };
}

async function reread(client, target) {
    const result = await client.query({ text: `SELECT ${COLUMNS} FROM conversations WHERE id = $1
        AND channel = $2 AND COALESCE(business_context, 'event_genix') = $3`,
    values: [target.id, target.channel, target.businessContext], query_timeout: 3000 });
    return result.rows[0];
}

async function runRepair(client, options, dependencies = {}) {
    const targets = await resolveScope(client, options);
    const { needsProfileName, lookupMetaName, updateMetaName } = require('../services/omni-facebook-profile');
    const resolveRuntime = dependencies.resolveRuntime || require('../services/omni-accounts').resolveOmniRuntimeConfig;
    const lookup = dependencies.lookup || lookupMetaName;
    const prepared = [];
    for (const target of targets) {
        const runtime = await resolveRuntime(target.channel, { businessContext: target.businessContext, strict: true, ownershipClient: client });
        const provenance = await inspectProvenance(client, target, runtime.pageId);
        prepared.push({ target, runtime, provenance });
    }
    // Pin exact internal IDs, external IDs, native timestamps and Page bindings without publishing them.
    const scopeDigest = crypto.createHash('sha256').update(JSON.stringify(prepared.map(({ target, runtime }) => [
        target.businessContext, target.channel, target.id, target.externalId, target.createdAt, runtime.pageId || null,
    ]))).digest('hex');
    if (options.expectedScopeDigest && options.expectedScopeDigest !== scopeDigest) fail('SCOPE_DIGEST_MISMATCH');
    const report = { mode: options.inspectOnly ? 'inspect-only' : options.apply ? 'apply' : 'dry-run', scopeDigest, selected: targets.length,
        lookupAttempts: 0, maxProfileGets: targets.length, ready: 0, applied: 0, unavailable: 0, skipped: 0, results: [] };
    // Serial, one lookup per target, no automatic retry. Adapter enforces 3 seconds / 64 KiB.
    for (let index = 0; index < prepared.length; index++) {
        const { target, runtime, provenance } = prepared[index];
        const item = { slot: index + 1, channel: target.channel, provenance };
        report.results.push(item);
        if (options.inspectOnly) { item.code = 'INSPECTED'; report.skipped++; continue; }
        if (!needsProfileName(target.customerName)) { item.code = 'NAME_ALREADY_SET'; report.skipped++; continue; }
        if (!runtime.pageId || !(runtime.pageToken || runtime.token)) {
            item.code = 'PROFILE_CONFIG_MISSING'; report.unavailable++; continue;
        }
        // For Facebook this is a Page-scoped user ID. A mismatch must not be repaired by guessing another ID.
        if (!provenance.senderMatchesExternalId || !provenance.recipientPresent || !provenance.messageIdMatches
            || !provenance.noEcho || (target.channel === 'facebook' && !provenance.recipientMatchesConfiguredPage)) {
            item.code = 'PROVENANCE_UNCONFIRMED'; report.unavailable++; continue;
        }
        report.lookupAttempts++;
        let profile;
        try { profile = await lookup(target, { ownershipClient: client }); }
        catch { profile = { success: false, code: 'PROFILE_UNAVAILABLE' }; }
        if (!profile.success) {
            item.code = SAFE_CODES.has(profile.code) ? profile.code : 'PROFILE_UNAVAILABLE'; report.unavailable++; continue;
        }
        if (profile.profileId !== target.externalId || needsProfileName(profile.name)) {
            item.code = profile.profileId !== target.externalId ? 'PROFILE_ID_MISMATCH' : 'PROFILE_NAME_EMPTY';
            report.unavailable++; continue;
        }
        const current = await reread(client, target);
        const currentRuntime = await resolveRuntime(target.channel, { businessContext: target.businessContext, strict: true, ownershipClient: client });
        if (!current || current.externalId !== target.externalId || current.channel !== target.channel
            || current.businessContext !== target.businessContext || current.createdAt !== target.createdAt
            || current.updatedAt !== target.updatedAt || !needsProfileName(current.customerName)
            || currentRuntime.pageId !== runtime.pageId
            || (currentRuntime.pageToken || currentRuntime.token) !== (runtime.pageToken || runtime.token)) {
            item.code = 'CONCURRENT_CHANGE'; report.skipped++; continue;
        }
        if (!options.apply) { item.code = 'READY'; report.ready++; continue; }
        const applied = await updateMetaName(client, target, profile, target);
        item.code = applied ? 'APPLIED' : 'CONCURRENT_CHANGE';
        if (applied) report.applied++; else report.skipped++;
    }
    return report;
}

function parseArgs(args) {
    const options = {};
    const valueFlags = { '--business-context': 'businessContext', '--cohort': 'cohort', '--limit': 'limit', '--expected-scope-digest': 'expectedScopeDigest' };
    const seen = new Set();
    for (let i = 0; i < args.length; i++) {
        const flag = args[i];
        if (seen.has(flag)) fail('DUPLICATE_ARGUMENT');
        seen.add(flag);
        if (flag === '--apply') options.apply = true;
        else if (flag === '--dry-run') options.apply = false;
        else if (flag === '--scope-stdin') options.scopeStdin = true;
        else if (flag === '--inspect-only') options.inspectOnly = true;
        else if (valueFlags[flag] && args[i + 1] && !args[i + 1].startsWith('--')) options[valueFlags[flag]] = args[++i];
        else fail('ARGUMENT_INVALID');
    }
    if (seen.has('--apply') && seen.has('--dry-run')) fail('MODE_CONFLICT');
    if (options.scopeStdin && options.cohort) fail('SCOPE_CONFLICT');
    options.limit = /^\d+$/.test(options.limit || '') ? Number(options.limit) : NaN;
    return options;
}

async function main(args = process.argv.slice(2)) {
    let client;
    try {
        const options = parseArgs(args);
        if (options.scopeStdin) {
            // Only exact target selectors, never tokens or profile values. Do not echo input/errors.
            const input = require('node:fs').readFileSync(0, 'utf8');
            if (Buffer.byteLength(input) > 4096) fail('SCOPE_INPUT_TOO_LARGE');
            options.targets = JSON.parse(input.replace(/^\uFEFF/, ''));
        }
        validateOptions(options);
        const connectionString = options.apply ? process.env.META_NAMES_APPLY_DATABASE_URL : process.env.PRODUCTION_READONLY_DATABASE_URL;
        if (!connectionString) fail(options.apply ? 'APPLY_DATABASE_URL_REQUIRED' : 'READONLY_DATABASE_URL_REQUIRED');
        if (!process.env.OMNI_CONNECTION_SECRET_KEY && !process.env.JWT_SECRET) fail('CONNECTION_KEY_REQUIRED');
        process.env.LOG_LEVEL = 'error';
        const { Client } = require('pg');
        client = new Client({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 5000,
            options: options.apply ? '-c lock_timeout=3000' : '-c default_transaction_read_only=on' });
        await client.connect();
        await client.query("SET DateStyle TO 'ISO, YMD'");
        if (!options.apply) {
            await client.query('BEGIN READ ONLY');
            const state = await client.query('SHOW transaction_read_only');
            if (state.rows[0].transaction_read_only !== 'on') fail('READONLY_REQUIRED');
        }
        const report = await runRepair(client, options);
        if (!options.apply) await client.query('ROLLBACK');
        console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        // No driver/provider messages, payloads, names, URLs or IDs in output.
        console.error(JSON.stringify({ error: error.safeCode || 'REPAIR_FAILED', partialApplyPossible: args.includes('--apply') }));
        process.exitCode = 1;
    } finally {
        if (client) await client.end().catch(() => {});
    }
}

if (require.main === module) main();
module.exports = { runRepair, resolveScope, inspectProvenance, parseArgs, validateOptions, main };
