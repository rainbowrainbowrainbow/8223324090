'use strict';

const DEFAULT_APPROVED_OWNER_IDS = Object.freeze([4, 3, 40, 13, 1]);
const OWNER16_BLOCK_CODE = 'OWNER16_IDENTITY_SENDER_AUDIT_REQUIRED';
const DEFAULT_WORKER_ID = 'event-genix-railway-outbox-worker';
const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_EVENTS = 5;
const MAX_EVENTS_HARD_CAP = 10;
const DEFAULT_LOCK_SECONDS = 120;
const DEFAULT_LOOP_INTERVAL_SECONDS = 60;
const VALID_MODES = new Set(['read_only', 'dry_run', 'live_once', 'live_loop']);
const LIVE_MODES = new Set(['live_once', 'live_loop']);
const SUPPORTED_EVENT_TYPES = new Set([
    'task_created',
    'task_assigned',
    'task_reminder_due',
    'task_overdue',
    'task_updated'
]);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function textOrNull(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text || null;
}

function boolEnv(value) {
    if (value === undefined || value === null || value === '') return false;
    const normalized = String(value).trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return false;
}

function positiveInteger(value, fallback = null) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCliArgs(argv = []) {
    const parsed = {};
    for (const arg of argv) {
        if (!arg.startsWith('--')) continue;
        const [rawKey, ...rawValue] = arg.slice(2).split('=');
        const key = rawKey.replace(/-([a-z])/g, (_, chr) => chr.toUpperCase());
        parsed[key] = rawValue.length ? rawValue.join('=') : '1';
    }
    return parsed;
}

function parseOwnerIdList(value, fallback = DEFAULT_APPROVED_OWNER_IDS) {
    const source = textOrNull(value);
    const rawItems = source ? source.split(/[\s,;]+/) : fallback;
    const ids = [];
    for (const item of rawItems) {
        const parsed = positiveInteger(item, null);
        if (parsed && !ids.includes(parsed)) ids.push(parsed);
    }
    return ids;
}

function sameNumberSet(left = [], right = []) {
    if (left.length !== right.length) return false;
    const set = new Set(left.map(Number));
    return right.every(value => set.has(Number(value)));
}

function normalizeTelegramTarget(value) {
    const source = textOrNull(value);
    if (!source) return null;
    const chatId = source.startsWith('telegram:') ? source.slice('telegram:'.length) : source;
    if (!textOrNull(chatId)) return null;
    return {
        channel: 'telegram',
        chatId: textOrNull(chatId),
        target: `telegram:${textOrNull(chatId)}`
    };
}

function parseOwnerTargets(env = {}) {
    const targets = new Map();
    const jsonText = textOrNull(env.HERMES_OUTBOX_OWNER_TARGETS_JSON);
    if (jsonText) {
        try {
            const parsed = JSON.parse(jsonText);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                for (const [ownerIdText, targetValue] of Object.entries(parsed)) {
                    const ownerId = positiveInteger(ownerIdText, null);
                    const target = normalizeTelegramTarget(
                        typeof targetValue === 'object' && targetValue !== null
                            ? (targetValue.target || targetValue.chatId || targetValue.chat_id)
                            : targetValue
                    );
                    if (ownerId && target) targets.set(ownerId, target);
                }
            }
        } catch (_) {}
    }

    const flatText = textOrNull(env.HERMES_OUTBOX_OWNER_TARGETS);
    if (flatText) {
        for (const pair of flatText.split(/[\s,;]+/)) {
            const [ownerIdText, ...rawTarget] = pair.split(/[=:]/);
            const ownerId = positiveInteger(ownerIdText, null);
            const targetText = rawTarget.join(':');
            const target = normalizeTelegramTarget(targetText);
            if (ownerId && target) targets.set(ownerId, target);
        }
    }

    if (boolEnv(env.HERMES_OUTBOX_USE_KLESHNYA_BRIDGE_CHAT_ID)) {
        const bridgeTarget = normalizeTelegramTarget(env.KLESHNYA_BRIDGE_CHAT_ID);
        if (bridgeTarget) {
            for (const ownerId of DEFAULT_APPROVED_OWNER_IDS) {
                if (!targets.has(ownerId)) targets.set(ownerId, bridgeTarget);
            }
        }
    }

    return targets;
}

function buildConfig(env = process.env, cliArgs = {}) {
    const mode = textOrNull(cliArgs.mode || env.HERMES_OUTBOX_WORKER_MODE) || 'read_only';
    if (!VALID_MODES.has(mode)) {
        return {
            ok: false,
            mode,
            reasonCode: 'INVALID_MODE',
            message: `Invalid worker mode: ${mode}`
        };
    }

    const ownerAllowlist = parseOwnerIdList(
        cliArgs.ownerIds || env.HERMES_OUTBOX_HOURLY_BATCH_OWNER_USER_IDS,
        DEFAULT_APPROVED_OWNER_IDS
    );
    const maxEvents = Math.min(
        positiveInteger(cliArgs.maxEvents || env.HERMES_OUTBOX_WORKER_MAX_EVENTS, DEFAULT_MAX_EVENTS),
        MAX_EVENTS_HARD_CAP
    );
    const limit = Math.max(
        maxEvents,
        positiveInteger(cliArgs.limit || env.HERMES_OUTBOX_WORKER_LIMIT, DEFAULT_LIMIT)
    );

    return {
        ok: true,
        mode,
        workerId: textOrNull(cliArgs.workerId || env.HERMES_OUTBOX_WORKER_ID) || DEFAULT_WORKER_ID,
        ownerAllowlist,
        ownerAllowlistExact: sameNumberSet(ownerAllowlist, DEFAULT_APPROVED_OWNER_IDS),
        ownerTargets: parseOwnerTargets(env),
        allowSend: boolEnv(cliArgs.allowSend || env.HERMES_OUTBOX_ALLOW_SEND),
        allowCrmMutation: boolEnv(cliArgs.allowCrmMutation || env.HERMES_OUTBOX_ALLOW_CRM_MUTATION),
        confirmSend: boolEnv(cliArgs.confirmSend || env.HERMES_OUTBOX_CONFIRM_SEND),
        localCronPausedConfirmed: boolEnv(cliArgs.localCronPausedConfirmed || env.HERMES_OUTBOX_LOCAL_CRON_PAUSED_CONFIRMED),
        sendButtons: boolEnv(cliArgs.sendButtons || env.HERMES_OUTBOX_SEND_BUTTONS),
        telegramBotTokenPresent: Boolean(textOrNull(env.TELEGRAM_BOT_TOKEN)),
        limit,
        maxEvents,
        lockSeconds: positiveInteger(cliArgs.lockSeconds || env.HERMES_OUTBOX_LOCK_SECONDS, DEFAULT_LOCK_SECONDS),
        loopIntervalSeconds: positiveInteger(
            cliArgs.loopIntervalSeconds || env.HERMES_OUTBOX_LOOP_INTERVAL_SECONDS,
            DEFAULT_LOOP_INTERVAL_SECONDS
        ),
        maxEventsHardCap: MAX_EVENTS_HARD_CAP
    };
}

function eventPayload(event = {}) {
    const payload = event.payload || event.payload_json || event.payloadJson || {};
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

function eventIdOf(event = {}) {
    return textOrNull(event.eventId || event.event_id);
}

function taskIdOf(event = {}) {
    return positiveInteger(event.taskId ?? event.task_id ?? eventPayload(event).taskId, null);
}

function ownerUserIdOf(event = {}) {
    return positiveInteger(event.ownerUserId ?? event.owner_user_id ?? eventPayload(event).ownerUserId, null);
}

function eventTypeOf(event = {}) {
    return textOrNull(event.eventType || event.event_type);
}

function compactTitle(value) {
    const text = textOrNull(value) || 'Без назви';
    return text.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').slice(0, 160);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatTaskMessage(event = {}) {
    const payload = eventPayload(event);
    const taskId = taskIdOf(event);
    const title = compactTitle(payload.title || event.title);
    const ownerLabel = compactTitle(payload.ownerLabel || `owner ${ownerUserIdOf(event) || 'unknown'}`);
    const dueAt = textOrNull(payload.dueAt || payload.deadline || payload.date);
    const priority = compactTitle(payload.priority || event.priority || 'normal');
    const crmUrl = textOrNull(payload.crmUrl);
    const lines = [
        '📋 <b>Нова задача в CRM</b>',
        '',
        `<b>${taskId ? `#${taskId} — ` : ''}${escapeHtml(title)}</b>`,
        `Для: ${escapeHtml(ownerLabel)}`,
        `Пріоритет: ${escapeHtml(priority)}`
    ];
    if (dueAt) lines.push(`До: ${escapeHtml(dueAt)}`);
    if (crmUrl) lines.push('', escapeHtml(crmUrl));
    return lines.join('\n');
}

function classifyEvent(event = {}, config) {
    const eventId = eventIdOf(event);
    const ownerUserId = ownerUserIdOf(event);
    const eventType = eventTypeOf(event);
    const blockers = [];

    if (!eventId) blockers.push('EVENT_ID_MISSING');
    if (!ownerUserId) blockers.push('OWNER_USER_ID_MISSING');
    if (ownerUserId === 16) blockers.push(OWNER16_BLOCK_CODE);
    if (ownerUserId && !config.ownerAllowlist.includes(ownerUserId)) blockers.push('OWNER_NOT_IN_APPROVED_ALLOWLIST');
    if (!eventType || !SUPPORTED_EVENT_TYPES.has(eventType)) blockers.push('EVENT_TYPE_NOT_SUPPORTED');

    const target = ownerUserId ? config.ownerTargets.get(ownerUserId) || null : null;
    if (!target) blockers.push('TELEGRAM_TARGET_MISSING');

    return {
        eventId,
        taskId: taskIdOf(event),
        ownerUserId,
        eventType,
        target,
        blockers,
        ready: blockers.length === 0,
        messagePreview: formatTaskMessage(event)
    };
}

function liveGateBlockers(config) {
    const blockers = [];
    if (!LIVE_MODES.has(config.mode)) return blockers;
    if (!config.ownerAllowlistExact) blockers.push('OWNER_ALLOWLIST_NOT_EXACTLY_APPROVED_SET');
    if (config.ownerAllowlist.includes(16)) blockers.push(OWNER16_BLOCK_CODE);
    if (!config.localCronPausedConfirmed) blockers.push('LOCAL_CRON_PAUSED_CONFIRMATION_MISSING');
    if (!config.allowSend) blockers.push('HERMES_OUTBOX_ALLOW_SEND_REQUIRED');
    if (!config.allowCrmMutation) blockers.push('HERMES_OUTBOX_ALLOW_CRM_MUTATION_REQUIRED');
    if (!config.confirmSend) blockers.push('HERMES_OUTBOX_CONFIRM_SEND_REQUIRED');
    if (!config.telegramBotTokenPresent) blockers.push('TELEGRAM_BOT_TOKEN_MISSING');
    if (config.sendButtons) blockers.push('SERVER_CALLBACK_BUTTON_STATE_NOT_IMPLEMENTED');
    for (const ownerId of config.ownerAllowlist) {
        if (!config.ownerTargets.has(ownerId)) blockers.push(`TELEGRAM_TARGET_MISSING_OWNER_${ownerId}`);
    }
    return blockers;
}

function defaultDependencies(env = process.env) {
    const service = require('../services/notificationOutbox');
    const db = require('../db');
    return {
        listNotificationOutboxEvents: service.listNotificationOutboxEvents,
        getNotificationOutboxStats: service.getNotificationOutboxStats,
        claimNotificationOutboxEvent: service.claimNotificationOutboxEvent,
        ackNotificationOutboxEvent: service.ackNotificationOutboxEvent,
        failNotificationOutboxEvent: service.failNotificationOutboxEvent,
        sendTelegramMessage: (chatId, text, options = {}) => sendTelegramMessage(chatId, text, { ...options, env }),
        close: async () => {
            if (db?.pool?.end) await db.pool.end();
        }
    };
}

async function fetchCandidateEvents(deps, config) {
    const result = await deps.listNotificationOutboxEvents({ status: 'pending', limit: config.limit });
    if (Array.isArray(result)) return result;
    return result?.events || result?.items || [];
}

async function sendTelegramMessage(chatId, text, options = {}) {
    const env = options.env || process.env;
    const token = textOrNull(env.TELEGRAM_BOT_TOKEN);
    if (!token) {
        return { ok: false, errorCode: 'TELEGRAM_BOT_TOKEN_MISSING' };
    }
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        return { ok: false, errorCode: 'FETCH_IMPL_MISSING' };
    }
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        })
    });
    let body = null;
    try {
        body = await response.json();
    } catch (_) {
        body = null;
    }
    return {
        ok: Boolean(response.ok && body?.ok),
        status: response.status,
        messageId: body?.result?.message_id || null,
        errorCode: body?.error_code || null,
        description: body?.description || null
    };
}

async function runOnce(options = {}) {
    const env = options.env || process.env;
    const cliArgs = options.cliArgs || {};
    const config = options.config || buildConfig(env, cliArgs);
    if (!config.ok) {
        return {
            ok: false,
            status: 'BLOCKED_CONFIG',
            reasonCode: config.reasonCode,
            message: config.message,
            send_attempted: false,
            crm_mutation_attempted: false
        };
    }
    const deps = options.deps || defaultDependencies(env);
    const summary = {
        ok: true,
        status: 'OK',
        mode: config.mode,
        workerId: config.workerId,
        ownerAllowlist: config.ownerAllowlist,
        owner16HardBlocked: !config.ownerAllowlist.includes(16),
        maxEvents: config.maxEvents,
        fetched: 0,
        ready_count: 0,
        blocked_count: 0,
        processed_count: 0,
        sent_count: 0,
        failed_count: 0,
        send_attempted: false,
        crm_mutation_attempted: false,
        stats: null,
        liveGateBlockers: liveGateBlockers(config),
        ready: [],
        blocked: [],
        processed: []
    };

    if (options.includeStats && typeof deps.getNotificationOutboxStats === 'function') {
        try {
            const stats = await deps.getNotificationOutboxStats();
            summary.stats = stats?.stats || stats || null;
        } catch (err) {
            summary.stats_error = err.code || err.message || 'STATS_FAILED';
        }
    }

    let events = [];
    try {
        events = await fetchCandidateEvents(deps, config);
    } catch (err) {
        summary.ok = false;
        summary.status = 'BLOCKED_SOURCE_UNAVAILABLE';
        summary.source_error_code = err.code || err.reasonCode || 'SOURCE_UNAVAILABLE';
        summary.source_error_message = err.message || '';
        return summary;
    }
    summary.fetched = events.length;
    const classifications = events.map(event => ({ event, plan: classifyEvent(event, config) }));
    summary.ready = classifications.filter(item => item.plan.ready).map(item => ({
        eventId: item.plan.eventId,
        taskId: item.plan.taskId,
        ownerUserId: item.plan.ownerUserId,
        eventType: item.plan.eventType,
        targetConfigured: Boolean(item.plan.target)
    }));
    summary.blocked = classifications.filter(item => !item.plan.ready).map(item => ({
        eventId: item.plan.eventId,
        taskId: item.plan.taskId,
        ownerUserId: item.plan.ownerUserId,
        eventType: item.plan.eventType,
        blockers: item.plan.blockers
    }));
    summary.ready_count = summary.ready.length;
    summary.blocked_count = summary.blocked.length;

    if (config.mode === 'read_only' || config.mode === 'dry_run') {
        summary.status = config.mode === 'read_only' ? 'READ_ONLY_PLAN' : 'DRY_RUN_PLAN';
        return summary;
    }

    if (summary.liveGateBlockers.length) {
        summary.ok = false;
        summary.status = 'BLOCKED_LIVE_GATES';
        return summary;
    }

    for (const item of classifications.filter(candidate => candidate.plan.ready).slice(0, config.maxEvents)) {
        const { plan } = item;
        const processed = {
            eventId: plan.eventId,
            taskId: plan.taskId,
            ownerUserId: plan.ownerUserId,
            targetConfigured: Boolean(plan.target),
            status: 'pending'
        };
        try {
            summary.crm_mutation_attempted = true;
            await deps.claimNotificationOutboxEvent(plan.eventId, {
                workerId: config.workerId,
                lockSeconds: config.lockSeconds
            });
            summary.send_attempted = true;
            const sent = await deps.sendTelegramMessage(plan.target.chatId, plan.messagePreview, { event: item.event, config });
            if (sent?.ok) {
                await deps.ackNotificationOutboxEvent(plan.eventId, {
                    workerId: config.workerId,
                    channel: 'telegram',
                    target: plan.target.target,
                    sentAt: new Date().toISOString()
                });
                processed.status = 'sent_acked';
                processed.messageId = sent.messageId || null;
                summary.sent_count += 1;
            } else {
                await deps.failNotificationOutboxEvent(plan.eventId, {
                    workerId: config.workerId,
                    errorCode: sent?.errorCode || 'TELEGRAM_SEND_FAILED',
                    errorMessage: sent?.description || 'Telegram send failed',
                    retryable: true
                });
                processed.status = 'send_failed_marked_retryable';
                processed.errorCode = sent?.errorCode || 'TELEGRAM_SEND_FAILED';
                summary.failed_count += 1;
            }
        } catch (err) {
            processed.status = 'worker_error';
            processed.errorCode = err.code || err.reasonCode || 'WORKER_ERROR';
            processed.message = err.message || 'Worker error';
            summary.failed_count += 1;
        }
        summary.processed.push(processed);
        summary.processed_count += 1;
    }

    summary.status = summary.failed_count ? 'LIVE_RUN_WITH_FAILURES' : 'LIVE_RUN_COMPLETE';
    summary.ok = summary.failed_count === 0;
    return summary;
}

async function runLoop(options = {}) {
    const env = options.env || process.env;
    const cliArgs = { ...(options.cliArgs || {}), mode: 'live_once' };
    const config = buildConfig(env, cliArgs);
    const deps = options.deps || defaultDependencies(env);
    const intervalMs = Math.max(1, config.loopIntervalSeconds) * 1000;
    const results = [];
    let stopping = false;
    const stop = () => { stopping = true; };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    while (!stopping) {
        const result = await runOnce({ env, cliArgs, config, deps, includeStats: options.includeStats });
        results.push(result);
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (options.once) break;
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return results;
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const cliArgs = parseCliArgs(argv);
    const mode = textOrNull(cliArgs.mode || env.HERMES_OUTBOX_WORKER_MODE) || 'read_only';
    const deps = defaultDependencies(env);
    try {
        if (mode === 'live_loop') {
            await runLoop({ env, cliArgs, deps, includeStats: boolEnv(cliArgs.includeStats || env.HERMES_OUTBOX_WORKER_INCLUDE_STATS) });
            return;
        }
        const result = await runOnce({
            env,
            cliArgs,
            deps,
            includeStats: boolEnv(cliArgs.includeStats || env.HERMES_OUTBOX_WORKER_INCLUDE_STATS)
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (!result.ok) process.exitCode = 1;
    } finally {
        if (deps.close) await deps.close();
    }
}

if (require.main === module) {
    main().catch(err => {
        process.stderr.write(`${JSON.stringify({ ok: false, status: 'WORKER_CRASH', errorCode: err.code || 'WORKER_CRASH', message: err.message })}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULT_APPROVED_OWNER_IDS,
    DEFAULT_WORKER_ID,
    MAX_EVENTS_HARD_CAP,
    OWNER16_BLOCK_CODE,
    buildConfig,
    classifyEvent,
    formatTaskMessage,
    liveGateBlockers,
    parseCliArgs,
    parseOwnerIdList,
    parseOwnerTargets,
    runLoop,
    runOnce,
    sendTelegramMessage
};
