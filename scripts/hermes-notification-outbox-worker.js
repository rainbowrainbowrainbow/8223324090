'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_APPROVED_OWNER_IDS = Object.freeze([4, 3, 40, 13, 1]);
const OWNER16_BLOCK_CODE = 'OWNER16_IDENTITY_SENDER_AUDIT_REQUIRED';
const DEFAULT_WORKER_ID = 'event-genix-railway-outbox-worker';
const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_EVENTS = 5;
const MAX_EVENTS_HARD_CAP = 10;
const DEFAULT_LOCK_SECONDS = 120;
const DEFAULT_LOOP_INTERVAL_SECONDS = 60;
const DEFAULT_BATCH_WINDOW_MINUTES = 60;
const DEFAULT_BATCH_MAX_ITEMS = 10;
const DEFAULT_BATCH_STATE_DIR = '.hermes/outbox-batch-state';
const DEFAULT_BATCH_DUPLICATE_GUARD_MINUTES = 120;
const MAX_BATCH_DUPLICATE_GUARD_MINUTES = 24 * 60;
const VALID_MODES = new Set(['read_only', 'dry_run', 'live_once', 'live_loop', 'read_only_loop', 'dry_run_loop']);
const LIVE_MODES = new Set(['live_once', 'live_loop']);
const LOOP_MODE_TO_ONCE_MODE = Object.freeze({
    live_loop: 'live_once',
    read_only_loop: 'read_only',
    dry_run_loop: 'dry_run'
});
const SUPPORTED_EVENT_TYPES = new Set([
    'task_created',
    'task_assigned',
    'task_reminder_due',
    'task_overdue',
    'task_updated'
]);
const BATCHABLE_EVENT_TYPES = new Set(['task_created', 'task_assigned']);
const BATCHABLE_PRIORITIES = new Set(['low', 'normal']);
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

function parseTextList(value) {
    const source = textOrNull(value);
    if (!source) return [];
    const items = [];
    for (const item of source.split(/[\s,;]+/)) {
        const text = textOrNull(item);
        if (text && !items.includes(text)) items.push(text);
    }
    return items;
}

function parseEventIdList(value) {
    return parseTextList(value).filter(item => item.length <= 240);
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

function parseOwnerTargetsDetailed(env = {}, options = {}) {
    const targets = new Map();
    let bridgeFallbackUsed = false;
    const bridgeFallbackRequested = boolEnv(env.HERMES_OUTBOX_USE_KLESHNYA_BRIDGE_CHAT_ID);
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

    if (bridgeFallbackRequested && options.allowBridgeFallback) {
        const bridgeTarget = normalizeTelegramTarget(env.KLESHNYA_BRIDGE_CHAT_ID);
        if (bridgeTarget) {
            for (const ownerId of DEFAULT_APPROVED_OWNER_IDS) {
                if (!targets.has(ownerId)) {
                    targets.set(ownerId, bridgeTarget);
                    bridgeFallbackUsed = true;
                }
            }
        }
    }

    return {
        targets,
        bridgeFallbackRequested,
        bridgeFallbackAllowed: Boolean(options.allowBridgeFallback),
        bridgeFallbackUsed
    };
}

function parseOwnerTargets(env = {}, options = {}) {
    return parseOwnerTargetsDetailed(env, options).targets;
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
    const activeOwnerSource = textOrNull(cliArgs.activeOwnerIds || env.HERMES_OUTBOX_ACTIVE_OWNER_USER_IDS);
    const activeOwnerIds = parseOwnerIdList(
        activeOwnerSource,
        ownerAllowlist
    );
    if (activeOwnerSource && !activeOwnerIds.length) {
        return {
            ok: false,
            mode,
            reasonCode: 'INVALID_ACTIVE_OWNER_IDS',
            message: 'HERMES_OUTBOX_ACTIVE_OWNER_USER_IDS/--active-owner-ids must contain at least one positive owner id'
        };
    }
    const explicitBatchOwnerIds = parseOwnerIdList(
        cliArgs.batchOwnerIds || env.HERMES_OUTBOX_BATCH_OWNER_USER_IDS,
        []
    );
    const batchOwnerIds = explicitBatchOwnerIds.length ? explicitBatchOwnerIds : ownerAllowlist;
    const maxEvents = Math.min(
        positiveInteger(cliArgs.maxEvents || env.HERMES_OUTBOX_WORKER_MAX_EVENTS, DEFAULT_MAX_EVENTS),
        MAX_EVENTS_HARD_CAP
    );
    const limit = Math.max(
        maxEvents,
        positiveInteger(cliArgs.limit || env.HERMES_OUTBOX_WORKER_LIMIT, DEFAULT_LIMIT)
    );

    const allowBridgeFallback = boolEnv(cliArgs.allowBridgeFallback || env.HERMES_OUTBOX_ALLOW_BRIDGE_FALLBACK);
    const ownerTargets = parseOwnerTargetsDetailed(env, { allowBridgeFallback });

    return {
        ok: true,
        mode,
        workerId: textOrNull(cliArgs.workerId || env.HERMES_OUTBOX_WORKER_ID) || DEFAULT_WORKER_ID,
        ownerAllowlist,
        ownerAllowlistExact: sameNumberSet(ownerAllowlist, DEFAULT_APPROVED_OWNER_IDS),
        activeOwnerIds,
        ownerTargets: ownerTargets.targets,
        bridgeFallbackRequested: ownerTargets.bridgeFallbackRequested,
        bridgeFallbackAllowed: ownerTargets.bridgeFallbackAllowed,
        bridgeFallbackUsed: ownerTargets.bridgeFallbackUsed,
        approvedEventIds: parseEventIdList(
            cliArgs.approvedEventIds || cliArgs.eventIds || cliArgs.eventId || env.HERMES_OUTBOX_APPROVED_EVENT_IDS || env.HERMES_OUTBOX_EVENT_IDS
        ),
        requireApprovedEventIds: boolEnv(cliArgs.requireApprovedEventIds || env.HERMES_OUTBOX_REQUIRE_APPROVED_EVENT_IDS),
        allowSend: boolEnv(cliArgs.allowSend || env.HERMES_OUTBOX_ALLOW_SEND),
        allowCrmMutation: boolEnv(cliArgs.allowCrmMutation || env.HERMES_OUTBOX_ALLOW_CRM_MUTATION),
        confirmSend: boolEnv(cliArgs.confirmSend || env.HERMES_OUTBOX_CONFIRM_SEND),
        localCronPausedConfirmed: boolEnv(cliArgs.localCronPausedConfirmed || env.HERMES_OUTBOX_LOCAL_CRON_PAUSED_CONFIRMED),
        sendButtons: boolEnv(cliArgs.sendButtons || env.HERMES_OUTBOX_SEND_BUTTONS),
        batchEnabled: boolEnv(cliArgs.batchEnabled || cliArgs.batchPlan || env.HERMES_OUTBOX_BATCH_ENABLED || env.HERMES_OUTBOX_BATCH_PLAN),
        batchOwnerIds,
        batchWindowMinutes: positiveInteger(
            cliArgs.batchWindowMinutes || env.HERMES_OUTBOX_BATCH_WINDOW_MINUTES,
            DEFAULT_BATCH_WINDOW_MINUTES
        ),
        batchMaxItems: Math.min(
            positiveInteger(cliArgs.batchMaxItems || env.HERMES_OUTBOX_BATCH_MAX_ITEMS, DEFAULT_BATCH_MAX_ITEMS),
            MAX_EVENTS_HARD_CAP
        ),
        batchForce: boolEnv(cliArgs.batchForce || env.HERMES_OUTBOX_BATCH_FORCE),
        batchStateDir: textOrNull(cliArgs.batchStateDir || env.HERMES_OUTBOX_BATCH_STATE_DIR) || DEFAULT_BATCH_STATE_DIR,
        batchDuplicateGuardMinutes: Math.min(
            positiveInteger(
                cliArgs.batchDuplicateGuardMinutes || env.HERMES_OUTBOX_BATCH_DUPLICATE_GUARD_MINUTES,
                DEFAULT_BATCH_DUPLICATE_GUARD_MINUTES
            ),
            MAX_BATCH_DUPLICATE_GUARD_MINUTES
        ),
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

function sanitizeForLog(value) {
    const text = String(value ?? '');
    return text
        .replace(/\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_TELEGRAM_BOT_TOKEN]')
        .replace(/bot[A-Za-z0-9:_-]{20,}/g, 'bot[REDACTED]')
        .replace(/((?:chat_id|chatId|chat_id\\?"?)\s*[=:]\s*\\?"?)-?\d{6,}/g, '$1[REDACTED_CHAT_ID]')
        .slice(0, 500);
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

function priorityOf(event = {}) {
    const payload = eventPayload(event);
    return compactTitle(payload.priority || event.priority || 'normal').toLowerCase();
}

function isBatchCandidate(event = {}, plan = {}, config = {}) {
    if (!config.batchEnabled) return false;
    if (!plan.ready) return false;
    if (!config.batchOwnerIds.includes(Number(plan.ownerUserId))) return false;
    if (!BATCHABLE_EVENT_TYPES.has(plan.eventType)) return false;
    return BATCHABLE_PRIORITIES.has(priorityOf(event));
}

function batchStatePath(config = {}, ownerUserId) {
    const safeOwner = String(ownerUserId || 'unknown').replace(/[^0-9A-Za-z_-]+/g, '_');
    return path.join(config.batchStateDir || DEFAULT_BATCH_STATE_DIR, `owner-${safeOwner}.json`);
}

function readBatchState(config = {}, ownerUserId) {
    try {
        const filePath = batchStatePath(config, ownerUserId);
        if (!fs.existsSync(filePath)) return {};
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
        return { stateReadError: true };
    }
}

function writeBatchState(config = {}, ownerUserId, patch = {}) {
    const filePath = batchStatePath(config, ownerUserId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const next = { ...readBatchState(config, ownerUserId), ...patch, ownerUserId, updatedAt: new Date().toISOString() };
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpPath, filePath);
    return next;
}

function parseDateOrNull(value) {
    const text = textOrNull(value);
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function roundMinutes(value) {
    return Math.round(value * 10) / 10;
}

function recentBatchAttemptGuard(config = {}, ownerUserId, eventIds = [], now = new Date()) {
    const state = readBatchState(config, ownerUserId);
    const requestedIds = eventIds.map(String).filter(Boolean);
    if (state.stateReadError) {
        return {
            active: true,
            reason: 'state_read_error_fail_closed',
            stateReadError: true,
            heldEventIds: requestedIds
        };
    }
    const lastAttemptAt = parseDateOrNull(state.lastSendAttemptAt);
    const lastAttemptEventIds = Array.isArray(state.lastSendAttemptEventIds)
        ? state.lastSendAttemptEventIds.map(String)
        : [];
    const heldEventIds = requestedIds.filter(eventId => lastAttemptEventIds.includes(eventId));
    if (!lastAttemptAt || heldEventIds.length === 0) {
        return { active: false };
    }
    const guardMinutes = Math.max(1, config.batchDuplicateGuardMinutes || DEFAULT_BATCH_DUPLICATE_GUARD_MINUTES);
    const elapsedMinutes = Math.max(0, (now.getTime() - lastAttemptAt.getTime()) / 60000);
    if (elapsedMinutes >= guardMinutes) {
        return {
            active: false,
            previousAttemptAt: state.lastSendAttemptAt,
            elapsedMinutes: roundMinutes(elapsedMinutes),
            guardMinutes
        };
    }
    return {
        active: true,
        reason: 'recent_send_attempt_duplicate_guard',
        heldEventIds,
        previousAttemptAt: state.lastSendAttemptAt,
        elapsedMinutes: roundMinutes(elapsedMinutes),
        guardMinutes
    };
}

function batchDue(config = {}, ownerUserId, now = new Date()) {
    const state = readBatchState(config, ownerUserId);
    if (state.stateReadError) return { due: false, reason: 'state_read_error_fail_closed', stateReadError: true };
    if (config.batchForce) return { due: true, reason: 'force' };
    const lastSentAt = parseDateOrNull(state.lastSentAt);
    if (!lastSentAt) return { due: true, reason: 'no_previous_batch', stateReadError: Boolean(state.stateReadError) };
    const elapsedMinutes = Math.max(0, (now.getTime() - lastSentAt.getTime()) / 60000);
    const windowMinutes = Math.max(1, config.batchWindowMinutes || DEFAULT_BATCH_WINDOW_MINUTES);
    return {
        due: elapsedMinutes >= windowMinutes,
        reason: elapsedMinutes >= windowMinutes ? 'window_elapsed' : 'window_not_due',
        elapsedMinutes: roundMinutes(elapsedMinutes),
        windowMinutes,
        lastSentAt: state.lastSentAt
    };
}

function groupBatchCandidates(batchCandidates = []) {
    const buckets = new Map();
    for (const item of batchCandidates) {
        const ownerKey = String(item.plan.ownerUserId || 'unknown');
        if (!buckets.has(ownerKey)) {
            buckets.set(ownerKey, {
                ownerUserId: item.plan.ownerUserId,
                target: item.plan.target,
                events: []
            });
        }
        buckets.get(ownerKey).events.push(item);
    }
    return [...buckets.values()];
}

function renderBatchMessage(bucket = {}, config = {}) {
    const ownerLabel = compactTitle(eventPayload(bucket.events?.[0]?.event || {}).ownerLabel || `owner ${bucket.ownerUserId || 'unknown'}`);
    const lines = ['📋 <b>Нові задачі за годину</b>', '', `Для: ${escapeHtml(ownerLabel)}`, ''];
    const selected = (bucket.events || []).slice(0, Math.max(1, config.batchMaxItems || DEFAULT_BATCH_MAX_ITEMS));
    selected.forEach((item, index) => {
        const payload = eventPayload(item.event);
        const taskId = item.plan.taskId || payload.taskId || '—';
        const title = compactTitle(payload.title || item.event.title);
        const dueAt = textOrNull(payload.dueAt || payload.deadline || payload.date);
        const priority = compactTitle(payload.priority || item.event.priority || 'normal');
        lines.push(`${index + 1}) #${escapeHtml(taskId)} — ${escapeHtml(title)}`);
        lines.push(`   ${dueAt ? `до: ${escapeHtml(dueAt)} · ` : ''}priority: ${escapeHtml(priority)}`);
        lines.push('');
    });
    const remaining = (bucket.events || []).length - selected.length;
    if (remaining > 0) {
        lines.push(`…і ще ${remaining} задач(і). Відкрий “Мій день” для повного списку.`, '');
    }
    lines.push('📋 Відкрити “Мій день” у CRM.');
    return lines.join('\n').trim();
}

function buildBatchPlan(batchCandidates = [], config = {}, options = {}) {
    const buckets = groupBatchCandidates(batchCandidates);
    return {
        enabled: Boolean(config.batchEnabled),
        ownerIds: config.batchOwnerIds || [],
        candidate_count: batchCandidates.length,
        batch_count: buckets.length,
        window_minutes: config.batchWindowMinutes,
        max_items: config.batchMaxItems,
        buckets: buckets.map(bucket => {
            const due = batchDue(config, bucket.ownerUserId, options.now || new Date());
            const selected = bucket.events.slice(0, Math.max(1, config.batchMaxItems || DEFAULT_BATCH_MAX_ITEMS));
            const duplicateGuard = recentBatchAttemptGuard(
                config,
                bucket.ownerUserId,
                selected.map(item => item.plan.eventId),
                options.now || new Date()
            );
            const result = {
                ownerUserId: bucket.ownerUserId,
                targetConfigured: Boolean(bucket.target),
                count: bucket.events.length,
                selected_count: selected.length,
                eventIds: selected.map(item => item.plan.eventId),
                taskIds: selected.map(item => item.plan.taskId),
                due,
                duplicateGuard: duplicateGuard.active ? duplicateGuard : undefined
            };
            if (options.includePreview) result.messagePreview = renderBatchMessage(bucket, config).slice(0, 1200);
            return result;
        })
    };
}

async function processBatchBuckets(summary, batchCandidates = [], deps, config = {}) {
    const buckets = groupBatchCandidates(batchCandidates);
    summary.batch_processed = [];
    for (const bucket of buckets) {
        const remainingBudget = Math.max(0, (config.maxEvents || DEFAULT_MAX_EVENTS) - summary.processed_count);
        if (remainingBudget <= 0) {
            summary.batch_processed.push({
                ownerUserId: bucket.ownerUserId,
                targetConfigured: Boolean(bucket.target),
                selected_count: 0,
                eventIds: [],
                taskIds: [],
                status: 'not_selected_max_events_reached'
            });
            continue;
        }
        const due = batchDue(config, bucket.ownerUserId);
        let selected = bucket.events.slice(0, Math.min(
            Math.max(1, config.batchMaxItems || DEFAULT_BATCH_MAX_ITEMS),
            remainingBudget
        ));
        const duplicateGuard = recentBatchAttemptGuard(
            config,
            bucket.ownerUserId,
            selected.map(item => item.plan.eventId)
        );
        const processed = {
            ownerUserId: bucket.ownerUserId,
            targetConfigured: Boolean(bucket.target),
            selected_count: selected.length,
            eventIds: selected.map(item => item.plan.eventId),
            taskIds: selected.map(item => item.plan.taskId),
            due,
            status: 'pending'
        };
        if (duplicateGuard.active) {
            const held = new Set(duplicateGuard.heldEventIds.map(String));
            selected = selected.filter(item => !held.has(String(item.plan.eventId)));
            processed.duplicateGuard = duplicateGuard;
            processed.heldEventIds = duplicateGuard.heldEventIds;
            processed.selected_count = selected.length;
            processed.eventIds = selected.map(item => item.plan.eventId);
            processed.taskIds = selected.map(item => item.plan.taskId);
            if (!selected.length) {
                processed.status = 'held_duplicate_guard';
                summary.batch_processed.push(processed);
                continue;
            }
        }
        if (!due.due) {
            processed.status = 'held_until_batch_window';
            summary.batch_processed.push(processed);
            continue;
        }
        if (!bucket.target) {
            processed.status = 'blocked_missing_target';
            summary.batch_processed.push(processed);
            continue;
        }
        const claimed = [];
        try {
            writeBatchState(config, bucket.ownerUserId, {
                lastSendAttemptAt: new Date().toISOString(),
                lastSendAttemptEventIds: selected.map(item => item.plan.eventId),
                lastSendAttemptTaskIds: selected.map(item => item.plan.taskId)
            });
            for (const item of selected) {
                summary.crm_mutation_attempted = true;
                await deps.claimNotificationOutboxEvent(item.plan.eventId, {
                    workerId: config.workerId,
                    lockSeconds: config.lockSeconds
                });
                claimed.push(item);
            }
            summary.send_attempted = true;
            const sent = await deps.sendTelegramMessage(bucket.target.chatId, renderBatchMessage({ ...bucket, events: selected }, config), {
                batch: true,
                config
            });
            if (sent?.ok) {
                const sentAt = new Date().toISOString();
                for (const item of claimed) {
                    await deps.ackNotificationOutboxEvent(item.plan.eventId, {
                        workerId: config.workerId,
                        channel: 'telegram',
                        target: bucket.target.target,
                        sentAt,
                        batch: true
                    });
                }
                writeBatchState(config, bucket.ownerUserId, {
                    lastSentAt: sentAt,
                    lastEventIds: claimed.map(item => item.plan.eventId),
                    lastTaskIds: claimed.map(item => item.plan.taskId),
                    lastMessageId: sent.messageId || null
                });
                processed.status = 'batch_sent_acked';
                processed.messageId = sent.messageId || null;
                summary.sent_count += claimed.length;
            } else {
                for (const item of claimed) {
                    await deps.failNotificationOutboxEvent(item.plan.eventId, {
                        workerId: config.workerId,
                        errorCode: sent?.errorCode || 'TELEGRAM_BATCH_SEND_FAILED',
                        errorMessage: sanitizeForLog(sent?.description || 'Telegram batch send failed'),
                        retryable: true
                    });
                }
                processed.status = 'batch_send_failed_marked_retryable';
                processed.errorCode = sent?.errorCode || 'TELEGRAM_BATCH_SEND_FAILED';
                summary.failed_count += claimed.length || selected.length;
            }
        } catch (err) {
            processed.status = 'batch_worker_error';
            processed.errorCode = err.code || err.reasonCode || 'BATCH_WORKER_ERROR';
            processed.message = sanitizeForLog(err.message || 'Batch worker error');
            summary.failed_count += Math.max(1, selected.length);
        }
        summary.batch_processed.push(processed);
        summary.processed_count += selected.length;
    }
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
    if (ownerUserId && Array.isArray(config.activeOwnerIds) && config.activeOwnerIds.length && !config.activeOwnerIds.includes(ownerUserId)) {
        blockers.push('OWNER_NOT_IN_ACTIVE_SCOPE');
    }
    if (!eventType || !SUPPORTED_EVENT_TYPES.has(eventType)) blockers.push('EVENT_TYPE_NOT_SUPPORTED');
    if (eventId && Array.isArray(config.approvedEventIds) && config.approvedEventIds.length && LIVE_MODES.has(config.mode) && !config.approvedEventIds.includes(eventId)) {
        blockers.push('EVENT_NOT_IN_APPROVED_LIVE_SELECTION');
    }

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
    if (Array.isArray(config.activeOwnerIds)) {
        for (const ownerId of config.activeOwnerIds) {
            if (ownerId === 16) blockers.push(OWNER16_BLOCK_CODE);
            if (!DEFAULT_APPROVED_OWNER_IDS.includes(ownerId)) blockers.push(`ACTIVE_OWNER_NOT_APPROVED_${ownerId}`);
        }
    }
    if (config.batchEnabled && Array.isArray(config.batchOwnerIds)) {
        for (const ownerId of config.batchOwnerIds) {
            if (ownerId === 16) blockers.push(OWNER16_BLOCK_CODE);
            if (!config.ownerAllowlist.includes(ownerId)) blockers.push(`BATCH_OWNER_NOT_IN_ALLOWLIST_${ownerId}`);
            if (Array.isArray(config.activeOwnerIds) && config.activeOwnerIds.length && !config.activeOwnerIds.includes(ownerId)) {
                blockers.push(`BATCH_OWNER_NOT_IN_ACTIVE_SCOPE_${ownerId}`);
            }
        }
    }
    if (config.requireApprovedEventIds && !config.approvedEventIds.length) blockers.push('APPROVED_EVENT_IDS_REQUIRED');
    if (config.approvedEventIds.length && config.mode === 'live_loop') blockers.push('APPROVED_EVENT_IDS_NOT_SUPPORTED_FOR_LIVE_LOOP');
    if (config.bridgeFallbackUsed) blockers.push('BRIDGE_FALLBACK_TARGETS_NOT_ALLOWED_FOR_LIVE');
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
        description: body?.description ? sanitizeForLog(body.description) : null
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
    const summary = {
        ok: true,
        status: 'OK',
        mode: config.mode,
        workerId: config.workerId,
        ownerAllowlist: config.ownerAllowlist,
        activeOwnerIds: config.activeOwnerIds,
        owner16HardBlocked: !config.ownerAllowlist.includes(16) && !config.activeOwnerIds.includes(16) && !config.batchOwnerIds.includes(16),
        batchEnabled: Boolean(config.batchEnabled),
        batchOwnerIds: config.batchOwnerIds,
        batchDuplicateGuardMinutes: config.batchDuplicateGuardMinutes,
        approvedEventIdsConfigured: Boolean(config.approvedEventIds.length),
        approvedEventIdsCount: config.approvedEventIds.length,
        maxEvents: config.maxEvents,
        fetched: 0,
        ready_count: 0,
        immediate_ready_count: 0,
        batch_candidate_count: 0,
        blocked_count: 0,
        processed_count: 0,
        sent_count: 0,
        failed_count: 0,
        send_attempted: false,
        crm_mutation_attempted: false,
        stats: null,
        liveGateBlockers: liveGateBlockers(config),
        batchPlan: null,
        ready: [],
        blocked: [],
        processed: []
    };

    if (summary.liveGateBlockers.length) {
        summary.ok = false;
        summary.status = 'BLOCKED_LIVE_GATES';
        return summary;
    }

    const deps = options.deps || defaultDependencies(env);

    if (options.includeStats && typeof deps.getNotificationOutboxStats === 'function') {
        try {
            const stats = await deps.getNotificationOutboxStats();
            summary.stats = stats?.stats || stats || null;
        } catch (err) {
            summary.stats_error = sanitizeForLog(err.code || err.message || 'STATS_FAILED');
        }
    }

    let events = [];
    try {
        events = await fetchCandidateEvents(deps, config);
    } catch (err) {
        summary.ok = false;
        summary.status = 'BLOCKED_SOURCE_UNAVAILABLE';
        summary.source_error_code = err.code || err.reasonCode || 'SOURCE_UNAVAILABLE';
        summary.source_error_message = sanitizeForLog(err.message || '');
        return summary;
    }
    summary.fetched = events.length;
    const classifications = events.map(event => ({ event, plan: classifyEvent(event, config) }));
    const batchCandidates = classifications.filter(item => isBatchCandidate(item.event, item.plan, config));
    const immediateClassifications = classifications.filter(item => item.plan.ready && !isBatchCandidate(item.event, item.plan, config));
    summary.ready = immediateClassifications.map(item => ({
        eventId: item.plan.eventId,
        taskId: item.plan.taskId,
        ownerUserId: item.plan.ownerUserId,
        eventType: item.plan.eventType,
        targetConfigured: Boolean(item.plan.target),
        deliveryPolicy: 'immediate'
    }));
    summary.blocked = classifications.filter(item => !item.plan.ready).map(item => ({
        eventId: item.plan.eventId,
        taskId: item.plan.taskId,
        ownerUserId: item.plan.ownerUserId,
        eventType: item.plan.eventType,
        blockers: item.plan.blockers
    }));
    summary.immediate_ready_count = summary.ready.length;
    summary.batch_candidate_count = batchCandidates.length;
    summary.ready_count = summary.immediate_ready_count + summary.batch_candidate_count;
    summary.batchPlan = buildBatchPlan(batchCandidates, config, { includePreview: options.includePreview });
    summary.blocked_count = summary.blocked.length;

    if (config.mode === 'read_only' || config.mode === 'dry_run') {
        summary.status = config.mode === 'read_only' ? 'READ_ONLY_PLAN' : 'DRY_RUN_PLAN';
        return summary;
    }

    // Immediate path runs first so high/urgent/non-batch events cannot be starved by a batch backlog.
    for (const item of immediateClassifications.slice(0, config.maxEvents)) {
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
                    errorMessage: sanitizeForLog(sent?.description || 'Telegram send failed'),
                    retryable: true
                });
                processed.status = 'send_failed_marked_retryable';
                processed.errorCode = sent?.errorCode || 'TELEGRAM_SEND_FAILED';
                summary.failed_count += 1;
            }
        } catch (err) {
            processed.status = 'worker_error';
            processed.errorCode = err.code || err.reasonCode || 'WORKER_ERROR';
            processed.message = sanitizeForLog(err.message || 'Worker error');
            summary.failed_count += 1;
        }
        summary.processed.push(processed);
        summary.processed_count += 1;
    }

    if (batchCandidates.length) {
        await processBatchBuckets(summary, batchCandidates, deps, config);
    }

    summary.status = summary.failed_count ? 'LIVE_RUN_WITH_FAILURES' : 'LIVE_RUN_COMPLETE';
    summary.ok = summary.failed_count === 0;
    return summary;
}

async function runLoop(options = {}) {
    const env = options.env || process.env;
    const requestedMode = textOrNull((options.cliArgs || {}).mode || env.HERMES_OUTBOX_WORKER_MODE) || 'read_only_loop';
    const cliArgs = { ...(options.cliArgs || {}), mode: LOOP_MODE_TO_ONCE_MODE[requestedMode] || requestedMode };
    const config = buildConfig(env, cliArgs);
    const deps = options.deps || defaultDependencies(env);
    const intervalMs = Math.max(1, config.ok ? config.loopIntervalSeconds : DEFAULT_LOOP_INTERVAL_SECONDS) * 1000;
    const results = [];
    let stopping = false;
    const stop = () => { stopping = true; };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    while (!stopping) {
        const result = await runOnce({ env, cliArgs, config, deps, includeStats: options.includeStats, includePreview: options.includePreview });
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
        if (LOOP_MODE_TO_ONCE_MODE[mode]) {
            await runLoop({
                env,
                cliArgs,
                deps,
                includeStats: boolEnv(cliArgs.includeStats || env.HERMES_OUTBOX_WORKER_INCLUDE_STATS),
                includePreview: boolEnv(cliArgs.includePreview || env.HERMES_OUTBOX_INCLUDE_PREVIEW)
            });
            return;
        }
        const result = await runOnce({
            env,
            cliArgs,
            deps,
            includeStats: boolEnv(cliArgs.includeStats || env.HERMES_OUTBOX_WORKER_INCLUDE_STATS),
            includePreview: boolEnv(cliArgs.includePreview || env.HERMES_OUTBOX_INCLUDE_PREVIEW)
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (!result.ok) process.exitCode = 1;
    } finally {
        if (deps.close) await deps.close();
    }
}

if (require.main === module) {
    main().catch(err => {
        process.stderr.write(`${JSON.stringify({ ok: false, status: 'WORKER_CRASH', errorCode: err.code || 'WORKER_CRASH', message: sanitizeForLog(err.message) })}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULT_APPROVED_OWNER_IDS,
    DEFAULT_BATCH_DUPLICATE_GUARD_MINUTES,
    DEFAULT_WORKER_ID,
    MAX_EVENTS_HARD_CAP,
    OWNER16_BLOCK_CODE,
    buildConfig,
    buildBatchPlan,
    classifyEvent,
    formatTaskMessage,
    isBatchCandidate,
    liveGateBlockers,
    parseCliArgs,
    parseOwnerIdList,
    parseOwnerTargets,
    runLoop,
    runOnce,
    sendTelegramMessage
};
