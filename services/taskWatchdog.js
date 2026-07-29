'use strict';

const { rescheduleTask } = require('./taskReschedule');

const DEFAULT_OWNER_SCOPE = Object.freeze({
    3: { crmOwnerUserId: 3, displayName: 'Наталія' },
    4: { crmOwnerUserId: 4, displayName: 'Сергій' }
});

const DEFAULT_POLICY = Object.freeze({
    timezone: 'Europe/Kyiv',
    quietHours: { start: '20:00', end: '09:00' },
    weekendsEscalationOnlyUrgent: true,
    minReminderCooldownHours: 4,
    maxSelfRemindersPerTaskPerDay: 2,
    maxEscalationsPerTaskPerDay: 1,
    maxNotificationsPerOwnerPerDay: 10,
    staleAfterHours: 24,
    approachingDueWithinHours: 2,
    firstReminderHours: {
        low: 24,
        normal: 4,
        high: 1,
        urgent: 1
    },
    secondReminderHours: {
        low: 24,
        normal: 4,
        high: 2,
        urgent: 2
    },
    escalationHours: {
        low: 24,
        normal: 24,
        high: 2,
        urgent: 2
    },
    noDueDateFirstReminderHours: {
        low: 48,
        normal: 24,
        high: 4,
        urgent: 1
    },
    newTaskAlarmWindowHours: 6
});

const ACTIVE_STATUSES_EXCLUDED = new Set(['done', 'completed', 'cancelled', 'canceled', 'archived', 'resolved', 'closed']);
const HIGH_PRIORITIES = new Set(['high', 'urgent', 'critical', 'важливо', 'терміново']);
const NORMAL_PRIORITIES = new Set(['normal', 'medium', 'середній']);
const LOW_PRIORITIES = new Set(['low', 'низький']);

const REASON_CODES = Object.freeze({
    OWNER_MISSING: 'OWNER_MISSING',
    OWNER_NOT_ALLOWED: 'OWNER_NOT_ALLOWED',
    TELEGRAM_ID_USED_AS_OWNER_BLOCKED: 'TELEGRAM_ID_USED_AS_OWNER_BLOCKED',
    ACCOUNT_USER_NOT_OWNER: 'ACCOUNT_USER_NOT_OWNER',
    NOTIFICATION_TARGET_MISSING: 'NOTIFICATION_TARGET_MISSING',
    STATUS_EXCLUDED: 'STATUS_EXCLUDED',
    QUIET_HOURS: 'QUIET_HOURS',
    COOLDOWN_ACTIVE: 'COOLDOWN_ACTIVE',
    DAILY_CAP_REACHED: 'DAILY_CAP_REACHED',
    WATCHDOG_NOT_ENABLED: 'WATCHDOG_NOT_ENABLED',
    NEEDS_SCHEMA_OR_USAGE_SIGNAL: 'NEEDS_SCHEMA_OR_USAGE_SIGNAL',
    ACK_FORBIDDEN_NOT_OWNER: 'ACK_FORBIDDEN_NOT_OWNER',
    CALLBACK_DATA_UNSAFE: 'CALLBACK_DATA_UNSAFE',
    DUPLICATE_TASK_ID_SUPPRESSED: 'DUPLICATE_TASK_ID_SUPPRESSED',
    LIVE_ACTIVATION_REQUIRES_APPROVAL: 'LIVE_ACTIVATION_REQUIRES_APPROVAL',
    NOTIFICATION_MODE_NOT_ALLOWED: 'NOTIFICATION_MODE_NOT_ALLOWED',
    PERSISTENCE_PREVIEW_NOT_APPLIED: 'PERSISTENCE_PREVIEW_NOT_APPLIED',
    DB_QUERY_FAILED: 'DB_QUERY_FAILED',
    TASK_NOT_FOUND: 'TASK_NOT_FOUND',
    CRM_WRITE_REQUIRES_APPROVAL: 'CRM_WRITE_REQUIRES_APPROVAL',
    ROT_RISK_MANUAL_REVIEW: 'ROT_RISK_MANUAL_REVIEW'
});

const AUTO_RESCHEDULE_DEFAULTS = Object.freeze({
    ownerScope: [4],
    workHours: '09:00-23:00',
    maxAutoReschedules: 2,
    maxTaskAgeDays: 7,
    packetId: 'EG-TASK-WATCHDOG-AUTO-RESCHEDULE-20260628-01',
    timezone: 'Europe/Kyiv'
});

const AUTO_RESCHEDULE_BLOCK_LABELS = new Set([
    'do_not_auto_reschedule',
    'watchdog:no-auto-reschedule',
    'manual_only',
    'watchdog:manual-review',
    'problem_reported'
]);

const AUTO_RESCHEDULE_SENSITIVE_TERMS = [
    'complaint', 'refund', 'legal', 'payment', 'vip', 'conflict', 'client_critical', 'booking_today',
    'скарг', 'повернен', 'юрид', 'правов', 'оплат', 'платеж', 'vip', 'віп', 'конфлікт',
    'критич', 'клієнт', 'клиент', 'бронювання сьогодні', 'бронь сегодня', 'сьогодні брон', 'сегодня брон'
];

function normalizePositiveInt(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizePositiveIntegerString(value) {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    }
    if (typeof value === 'bigint') {
        return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? String(value) : null;
    }
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const normalized = trimmed.replace(/^0+(?=\d)/, '');
    const asNumber = Number(normalized);
    return Number.isSafeInteger(asNumber) && asNumber > 0 ? String(asNumber) : null;
}

function sanitizeTelegramText(value, { maxLength = 160 } = {}) {
    const source = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
        ? String(value)
        : '';
    let sanitized = source
        .replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!sanitized) sanitized = 'Без назви';
    sanitized = sanitized
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/`/g, '&#96;');
    const limit = normalizePositiveInt(maxLength) || 160;
    if (Buffer.byteLength(sanitized, 'utf8') <= limit) return sanitized;
    const ellipsis = '…';
    let output = '';
    for (const char of sanitized) {
        if (Buffer.byteLength(output + char + ellipsis, 'utf8') > limit) break;
        output += char;
    }
    return output ? `${output}${ellipsis}` : ellipsis;
}

function formatTaskTitleForTelegram(title) {
    return sanitizeTelegramText(title, { maxLength: 120 });
}

function buildTaskWatchdogAckCallbackData(taskIdValue) {
    const normalized = normalizePositiveIntegerString(taskIdValue);
    if (!normalized) return null;
    const callbackData = `tw_ack:${normalized}`;
    return Buffer.byteLength(callbackData, 'utf8') <= 64 ? callbackData : null;
}

function parseTaskWatchdogCallbackData(callbackData) {
    if (typeof callbackData !== 'string') return { ok: false, reasonCode: REASON_CODES.CALLBACK_DATA_UNSAFE };
    if (Buffer.byteLength(callbackData, 'utf8') > 64) return { ok: false, reasonCode: REASON_CODES.CALLBACK_DATA_UNSAFE };
    if (/[<>{}\[\]"'`&\s\u0000-\u001F\u007F-\u009F]/.test(callbackData)) {
        return { ok: false, reasonCode: REASON_CODES.CALLBACK_DATA_UNSAFE };
    }
    const match = callbackData.match(/^tw_ack:([1-9]\d{0,15})$/);
    if (!match) return { ok: false, reasonCode: REASON_CODES.CALLBACK_DATA_UNSAFE };
    const normalized = normalizePositiveIntegerString(match[1]);
    if (!normalized) return { ok: false, reasonCode: REASON_CODES.CALLBACK_DATA_UNSAFE };
    return { ok: true, action: 'ack', taskId: Number(normalized) };
}

function toDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function hoursBetween(start, end) {
    const from = toDate(start);
    const to = toDate(end);
    if (!from || !to) return null;
    return Math.max(0, (to.getTime() - from.getTime()) / 36e5);
}

function roundHours(value) {
    return value == null ? null : Math.round(value * 10) / 10;
}

function normalizeStatus(status) {
    return String(status || 'todo').trim().toLowerCase() || 'todo';
}

function normalizePriority(priority) {
    const value = String(priority || 'normal').trim().toLowerCase();
    if (HIGH_PRIORITIES.has(value)) return value === 'critical' ? 'urgent' : value;
    if (LOW_PRIORITIES.has(value)) return 'low';
    if (NORMAL_PRIORITIES.has(value)) return 'normal';
    return value || 'normal';
}

function priorityBucket(priority) {
    const normalized = normalizePriority(priority);
    if (normalized === 'urgent' || normalized === 'high') return normalized;
    if (normalized === 'low') return 'low';
    return 'normal';
}

function normalizeOwnerScope(ownerScope = DEFAULT_OWNER_SCOPE) {
    if (ownerScope instanceof Map) {
        return new Map([...ownerScope.entries()].map(([id, value]) => [id, {
            crmOwnerUserId: id,
            displayName: value?.displayName || value?.name || value?.username || `CRM user #${id}`
        }]));
    }
    const entries = Array.isArray(ownerScope)
        ? ownerScope.map(id => [id, { crmOwnerUserId: id }])
        : Object.entries(ownerScope || DEFAULT_OWNER_SCOPE);
    const result = new Map();
    for (const [key, value] of entries) {
        const id = normalizePositiveInt(value?.crmOwnerUserId || value?.id || key);
        if (!id) continue;
        result.set(id, {
            crmOwnerUserId: id,
            displayName: value?.displayName || value?.name || value?.username || `CRM user #${id}`
        });
    }
    return result;
}

function normalizeNotificationTargets(notificationTargets = {}) {
    const result = new Map();
    for (const [key, value] of Object.entries(notificationTargets || {})) {
        const crmUserId = normalizePositiveInt(value?.crmUserId || value?.crmOwnerUserId || key);
        if (!crmUserId) continue;
        const telegramUserId = normalizePositiveInt(value?.telegramUserId || value?.telegram_user_id);
        const telegramChatId = value?.telegramChatId ?? value?.telegram_chat_id ?? null;
        result.set(crmUserId, {
            crmUserId,
            channel: value?.channel || 'telegram',
            telegramUserId,
            telegramChatId,
            channelUserIdOrChatIdRedactedOrNull: telegramChatId || telegramUserId ? '[redacted-present]' : null,
            watchdogEnabled: value?.watchdogEnabled === true || value?.enabled === true
        });
    }
    return result;
}

function telegramNamespaceIds(notificationTargetMap) {
    const ids = new Set();
    for (const target of notificationTargetMap.values()) {
        if (target.telegramUserId) ids.add(target.telegramUserId);
        const chatAsInt = normalizePositiveInt(target.telegramChatId);
        if (chatAsInt) ids.add(chatAsInt);
    }
    return ids;
}

function taskId(task = {}) {
    return task.id ?? task.task_id ?? task.taskId ?? null;
}

function taskOwnerId(task = {}) {
    return normalizePositiveInt(task.ownerUserId ?? task.owner_user_id);
}

function taskAccountUserId(task = {}) {
    return normalizePositiveInt(task.accountUserId ?? task.account_user_id);
}

function taskTitle(task = {}) {
    const rawTitle = task.title ?? task.name;
    if (rawTitle == null || String(rawTitle).trim() === '') return `Задача #${taskId(task) || ''}`.trim();
    return String(rawTitle).trim();
}

function taskCreatedAt(task = {}) {
    return toDate(task.createdAt ?? task.created_at ?? task.created);
}

function taskUpdatedAt(task = {}) {
    return toDate(task.updatedAt ?? task.updated_at ?? task.last_activity_at ?? task.lastActivityAt ?? taskCreatedAt(task));
}

function taskDueAt(task = {}) {
    return toDate(task.dueAt ?? task.due_at ?? task.deadline ?? task.date ?? task.remind_at ?? task.remindAt);
}

function taskLastReminderAt(task = {}) {
    return toDate(task.lastReminderAt ?? task.last_reminder_at ?? task.last_notified_at ?? task.lastNotifiedAt);
}

function taskLastOwnerActionAt(task = {}) {
    return toDate(task.lastOwnerActionAt ?? task.last_owner_action_at ?? task.owner_last_action_at ?? task.last_action_at ?? task.updated_at ?? task.updatedAt);
}

function taskSnoozedUntil(task = {}) {
    return toDate(task.snoozedUntil ?? task.snoozed_until);
}

function taskAckState(task = {}) {
    const state = String(task.watchdogState || task.watchdog_state || '').trim().toLowerCase();
    const ackAt = toDate(task.acknowledgedAt ?? task.acknowledged_at ?? task.watchdog_acknowledged_at);
    return state === 'acknowledged' || !!ackAt;
}

function taskLabels(task = {}) {
    const raw = task.labels ?? task.tags ?? task.taskLabels ?? task.task_labels ?? [];
    if (Array.isArray(raw)) return raw.map(item => String(item || '').trim()).filter(Boolean);
    if (typeof raw === 'string') return raw.split(/[;,]/).map(item => item.trim()).filter(Boolean);
    return [];
}

function taskOriginalDueAt(task = {}) {
    return toDate(task.originalDueAt ?? task.original_due_at ?? task.firstDueAt ?? task.first_due_at ?? taskDueAt(task));
}

function taskAutoRescheduleCount(task = {}) {
    const parsed = Number.parseInt(task.autoRescheduleCount ?? task.auto_reschedule_count ?? task.watchdogAutoRescheduleCount ?? task.watchdog_auto_reschedule_count ?? 0, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function taskLastAutoRescheduledAt(task = {}) {
    return toDate(task.lastAutoRescheduledAt ?? task.last_auto_rescheduled_at ?? task.watchdogAutoRescheduledAt ?? task.watchdog_auto_rescheduled_at);
}

function taskSnoozeUntilForAutoReschedule(task = {}) {
    return toDate(task.snoozeUntil ?? task.snooze_until ?? task.snoozedUntil ?? task.snoozed_until);
}

function getZonedDateParts(dateValue = new Date(), timezone = AUTO_RESCHEDULE_DEFAULTS.timezone) {
    const date = toDate(dateValue) || new Date(dateValue);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date).reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});
    return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: parts.weekday, hour: Number(parts.hour), minute: Number(parts.minute), ymd: `${parts.year}-${parts.month}-${parts.day}` };
}

function addDaysToYmd(ymd, days) {
    const [year, month, day] = String(ymd).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + Number(days || 0), 12, 0, 0)).toISOString().slice(0, 10);
}

function compareYmd(left, right) {
    return String(left).localeCompare(String(right));
}

function ymdDiffDays(startYmd, endYmd) {
    const [sy, sm, sd] = String(startYmd).split('-').map(Number);
    const [ey, em, ed] = String(endYmd).split('-').map(Number);
    return Math.round((Date.UTC(ey, em - 1, ed, 12, 0, 0) - Date.UTC(sy, sm - 1, sd, 12, 0, 0)) / 864e5);
}

function isWeekendYmd(ymd, timezone = AUTO_RESCHEDULE_DEFAULTS.timezone) {
    const [year, month, day] = String(ymd).split('-').map(Number);
    const parts = getZonedDateParts(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)), timezone);
    return parts.weekday === 'Sat' || parts.weekday === 'Sun';
}

function nextWorkingYmd(fromYmd, timezone = AUTO_RESCHEDULE_DEFAULTS.timezone) {
    let candidate = addDaysToYmd(fromYmd, 1);
    while (isWeekendYmd(candidate, timezone)) candidate = addDaysToYmd(candidate, 1);
    return candidate;
}

function zonedLocalIso(ymd, hm, timezone = AUTO_RESCHEDULE_DEFAULTS.timezone) {
    const [year, month, day] = String(ymd).split('-').map(Number);
    const [hour, minute] = String(hm || '09:30').split(':').map(Number);
    let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    for (let i = 0; i < 4; i += 1) {
        const parts = getZonedDateParts(new Date(utcMs), timezone);
        const diffMinutes = (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Date.UTC(year, month - 1, day, hour, minute)) / 60000;
        if (diffMinutes === 0) break;
        utcMs -= diffMinutes * 60000;
    }
    const offsetMinutes = Math.round((Date.UTC(year, month - 1, day, hour, minute, 0) - utcMs) / 60000);
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    return `${ymd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function normalizeAutoRescheduleOwnerScope(options = {}) {
    const source = options.ownerScope ?? options.ownerIds ?? options.ownerUserIds ?? AUTO_RESCHEDULE_DEFAULTS.ownerScope;
    if (source instanceof Map) return [...source.keys()].map(normalizePositiveInt).filter(Boolean);
    if (Array.isArray(source)) return [...new Set(source.map(normalizePositiveInt).filter(Boolean))];
    return [...normalizeOwnerScope(source).keys()].sort((a, b) => a - b);
}

function autoRescheduleFailClosed(options = {}) {
    if (options.dryRun === false) return REASON_CODES.LIVE_ACTIVATION_REQUIRES_APPROVAL;
    if (options.allowWrite === true || options.execute === true) return REASON_CODES.CRM_WRITE_REQUIRES_APPROVAL;
    if (options.notificationMode === 'send') return REASON_CODES.LIVE_ACTIVATION_REQUIRES_APPROVAL;
    return null;
}

function hasAutoRescheduleBlockLabel(labels = []) {
    return labels.some(label => AUTO_RESCHEDULE_BLOCK_LABELS.has(String(label).trim().toLowerCase()));
}

function hasSensitiveAutoRescheduleSignal(task = {}, labels = []) {
    const haystack = `${taskTitle(task)} ${labels.join(' ')}`.toLowerCase();
    return AUTO_RESCHEDULE_SENSITIVE_TERMS.some(term => haystack.includes(term));
}

function autoRescheduleReason(task = {}, dueYmd, todayYmd) {
    const state = String(task.watchdogState || task.watchdog_state || task.ownerResponseState || task.owner_response_state || '').trim().toLowerCase();
    if (state === 'acknowledged_unfinished' || state === 'acked_unfinished' || task.acknowledgedUnfinished === true || task.acknowledged_unfinished === true) {
        return { reason: 'acknowledged_unfinished', policy: 'next_business_day_acknowledged_unfinished', time: '11:00' };
    }
    if (state === 'no_owner_response' || task.noOwnerResponse === true || task.no_owner_response === true) {
        return { reason: 'no_owner_response', policy: 'next_business_day_no_owner_response', time: '09:30' };
    }
    if (compareYmd(dueYmd, todayYmd) < 0) return { reason: 'overdue_previous_day', policy: 'next_business_day_overdue_previous_day', time: '09:00' };
    return { reason: 'missed_today', policy: 'next_business_day_missed_today', time: '09:30' };
}

function ownerUsesTaskManager(ownerId, options = {}, target = null) {
    const hasExplicitOwnerList = Object.prototype.hasOwnProperty.call(options, 'enabledOwnerIds')
        || Object.prototype.hasOwnProperty.call(options, 'activeOwnerIds');
    const explicitEnabled = options.enabledOwnerIds || options.activeOwnerIds || [];
    if (explicitEnabled.map(Number).includes(ownerId)) return { enabled: true, source: 'explicit_owner_list' };
    if (hasExplicitOwnerList && target?.watchdogEnabled === true) return { enabled: true, source: 'notification_target_enabled' };
    const usageSignals = options.usageSignals || {};
    const actorIds = usageSignals.recentTaskManagerActorIds || options.recentTaskManagerActorIds || [];
    if (actorIds.map(Number).includes(ownerId)) return { enabled: true, source: 'recent_task_manager_usage' };
    if (options.requireActiveUsageSignal === false) return { enabled: true, source: 'phase1_test_override' };
    return { enabled: false, source: 'missing_safe_usage_signal' };
}

function getKyivParts(now = new Date(), timezone = DEFAULT_POLICY.timezone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23'
    }).formatToParts(now).reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});
    return {
        minutes: Number(parts.hour) * 60 + Number(parts.minute),
        weekday: parts.weekday
    };
}

function timeToMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

function isQuietHours(now = new Date(), policy = DEFAULT_POLICY) {
    const start = timeToMinutes(policy.quietHours?.start || DEFAULT_POLICY.quietHours.start);
    const end = timeToMinutes(policy.quietHours?.end || DEFAULT_POLICY.quietHours.end);
    const { minutes } = getKyivParts(now, policy.timezone || DEFAULT_POLICY.timezone);
    if (start == null || end == null) return false;
    if (start > end) return minutes >= start || minutes < end;
    return minutes >= start && minutes < end;
}

function isWeekend(now = new Date(), policy = DEFAULT_POLICY) {
    const { weekday } = getKyivParts(now, policy.timezone || DEFAULT_POLICY.timezone);
    return weekday === 'Sat' || weekday === 'Sun';
}

function addHours(date, hours) {
    const d = toDate(date);
    if (!d) return null;
    return new Date(d.getTime() + Number(hours || 0) * 36e5);
}

function reminderPolicyFor(task = {}, policy = DEFAULT_POLICY) {
    const bucket = priorityBucket(task.priority);
    return {
        bucket,
        firstReminderHours: policy.firstReminderHours?.[bucket] ?? DEFAULT_POLICY.firstReminderHours[bucket] ?? 4,
        secondReminderHours: policy.secondReminderHours?.[bucket] ?? DEFAULT_POLICY.secondReminderHours[bucket] ?? 4,
        escalationHours: policy.escalationHours?.[bucket] ?? DEFAULT_POLICY.escalationHours[bucket] ?? 24,
        noDueDateFirstReminderHours: policy.noDueDateFirstReminderHours?.[bucket] ?? DEFAULT_POLICY.noDueDateFirstReminderHours[bucket] ?? 24
    };
}

function effectiveFirstReminderAt(task = {}, now = new Date(), policy = DEFAULT_POLICY) {
    const dueAt = taskDueAt(task);
    const createdAt = taskCreatedAt(task) || taskUpdatedAt(task) || now;
    const p = reminderPolicyFor(task, policy);
    if (dueAt) return addHours(dueAt, p.firstReminderHours);
    return addHours(createdAt, p.noDueDateFirstReminderHours);
}

function applyAntiSpam(task, ownerId, proposedAction, reasonCodes, options = {}) {
    const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
    const now = toDate(options.now) || new Date();
    if (!proposedAction || proposedAction === 'none') return proposedAction;

    if (isQuietHours(now, policy)) {
        reasonCodes.push(REASON_CODES.QUIET_HOURS);
        return 'suppressed';
    }

    const lastReminderAt = taskLastReminderAt(task);
    const cooldownHours = policy.minReminderCooldownHours ?? DEFAULT_POLICY.minReminderCooldownHours;
    if (lastReminderAt && hoursBetween(lastReminderAt, now) < cooldownHours) {
        reasonCodes.push(REASON_CODES.COOLDOWN_ACTIVE);
        return 'suppressed';
    }

    const meta = options.dailyCounters || {};
    const taskKey = String(taskId(task) || 'unknown');
    const ownerKey = String(ownerId || 'unknown');
    const selfReminderCount = Number(meta.selfRemindersByTask?.[taskKey] || task.selfRemindersToday || task.self_reminders_today || 0);
    const escalationCount = Number(meta.escalationsByTask?.[taskKey] || task.escalationsToday || task.escalations_today || 0);
    const ownerNotificationCount = Number(meta.notificationsByOwner?.[ownerKey] || 0);

    if (proposedAction === 'first_reminder' || proposedAction === 'second_reminder') {
        if (selfReminderCount >= (policy.maxSelfRemindersPerTaskPerDay ?? DEFAULT_POLICY.maxSelfRemindersPerTaskPerDay)) {
            reasonCodes.push(REASON_CODES.DAILY_CAP_REACHED);
            return 'suppressed';
        }
    }
    if (proposedAction === 'escalate') {
        if (escalationCount >= (policy.maxEscalationsPerTaskPerDay ?? DEFAULT_POLICY.maxEscalationsPerTaskPerDay)) {
            reasonCodes.push(REASON_CODES.DAILY_CAP_REACHED);
            return 'suppressed';
        }
        if (policy.weekendsEscalationOnlyUrgent !== false && isWeekend(now, policy) && priorityBucket(task.priority) !== 'urgent') {
            reasonCodes.push(REASON_CODES.QUIET_HOURS);
            return 'suppressed';
        }
    }
    if (ownerNotificationCount >= (policy.maxNotificationsPerOwnerPerDay ?? DEFAULT_POLICY.maxNotificationsPerOwnerPerDay)) {
        reasonCodes.push(REASON_CODES.DAILY_CAP_REACHED);
        return 'suppressed';
    }
    return proposedAction;
}

function classifyTask(task = {}, options = {}) {
    const now = toDate(options.now) || new Date();
    const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
    const ownerScope = normalizeOwnerScope(options.ownerScope || DEFAULT_OWNER_SCOPE);
    const targets = normalizeNotificationTargets(options.notificationTargets || {});
    const telegramIds = telegramNamespaceIds(targets);
    const reasonCodes = [];
    const ownerId = taskOwnerId(task);
    const accountUserId = taskAccountUserId(task);
    const status = normalizeStatus(task.status);
    const dueAt = taskDueAt(task);
    const createdAt = taskCreatedAt(task);
    const updatedAt = taskUpdatedAt(task);
    const lastReminderAt = taskLastReminderAt(task);
    const lastOwnerActionAt = taskLastOwnerActionAt(task);
    const ownerInfo = ownerId ? ownerScope.get(ownerId) : null;
    const target = ownerId ? targets.get(ownerId) : null;

    if (!ownerId) reasonCodes.push(REASON_CODES.OWNER_MISSING);
    if (ownerId && !ownerInfo) {
        reasonCodes.push(REASON_CODES.OWNER_NOT_ALLOWED);
        if (telegramIds.has(ownerId)) reasonCodes.push(REASON_CODES.TELEGRAM_ID_USED_AS_OWNER_BLOCKED);
    }
    if (ownerId && accountUserId && accountUserId !== ownerId) reasonCodes.push(REASON_CODES.ACCOUNT_USER_NOT_OWNER);
    if (ACTIVE_STATUSES_EXCLUDED.has(status)) reasonCodes.push(REASON_CODES.STATUS_EXCLUDED);

    const activeUsage = ownerId && ownerInfo ? ownerUsesTaskManager(ownerId, options, target) : { enabled: false };
    if (ownerId && ownerInfo && !activeUsage.enabled) {
        reasonCodes.push(REASON_CODES.WATCHDOG_NOT_ENABLED, REASON_CODES.NEEDS_SCHEMA_OR_USAGE_SIGNAL);
    }
    if (ownerId && ownerInfo && activeUsage.enabled && !target) reasonCodes.push(REASON_CODES.NOTIFICATION_TARGET_MISSING);

    let watchdogState = 'ok';
    let proposedAction = 'none';

    if (!ownerId || !ownerInfo || ACTIVE_STATUSES_EXCLUDED.has(status)) {
        watchdogState = ACTIVE_STATUSES_EXCLUDED.has(status) ? 'resolved' : 'excluded';
    } else if (!activeUsage.enabled || !target) {
        watchdogState = 'excluded';
    } else if (taskAckState(task)) {
        watchdogState = 'acknowledged';
    } else if (taskSnoozedUntil(task) && taskSnoozedUntil(task).getTime() > now.getTime()) {
        watchdogState = 'snoozed';
    } else {
        const ageHours = hoursBetween(createdAt || updatedAt || now, now) || 0;
        const staleHours = hoursBetween(lastOwnerActionAt || updatedAt || createdAt || now, now) || 0;
        const overdueHours = dueAt && dueAt.getTime() < now.getTime() ? hoursBetween(dueAt, now) : null;
        const firstReminderAt = effectiveFirstReminderAt(task, now, policy);
        const reminderHasHappened = !!lastReminderAt;
        const ownerActionAfterReminder = lastReminderAt && lastOwnerActionAt && lastOwnerActionAt.getTime() > lastReminderAt.getTime();
        const p = reminderPolicyFor(task, policy);

        if (lastReminderAt && lastReminderAt.getTime() > now.getTime()) {
            watchdogState = 'reminded_once';
            proposedAction = 'suppressed';
            reasonCodes.push(REASON_CODES.COOLDOWN_ACTIVE);
        } else if (reminderHasHappened && !ownerActionAfterReminder && hoursBetween(lastReminderAt, now) >= p.secondReminderHours + p.escalationHours) {
            watchdogState = 'escalation_pending';
            proposedAction = 'escalate';
        } else if (reminderHasHappened && !ownerActionAfterReminder && hoursBetween(lastReminderAt, now) >= p.secondReminderHours) {
            watchdogState = 'ignored_after_reminder';
            proposedAction = 'second_reminder';
        } else if (reminderHasHappened) {
            watchdogState = 'reminded_once';
        } else if (firstReminderAt && firstReminderAt.getTime() <= now.getTime()) {
            watchdogState = overdueHours != null ? 'overdue' : 'stale';
            proposedAction = 'first_reminder';
        } else if (overdueHours != null) {
            watchdogState = 'overdue';
        } else if (dueAt && hoursBetween(now, dueAt) <= policy.approachingDueWithinHours) {
            watchdogState = 'approaching_due';
        } else if (!dueAt && staleHours >= policy.staleAfterHours) {
            watchdogState = 'stale';
        } else if (ageHours >= policy.staleAfterHours && staleHours >= policy.staleAfterHours) {
            watchdogState = 'stale';
        }
    }

    proposedAction = applyAntiSpam(task, ownerId, proposedAction, reasonCodes, options);

    return {
        taskId: taskId(task),
        title: taskTitle(task),
        ownerUserId: ownerId,
        ownerName: ownerInfo?.displayName || task.ownerName || task.owner_name || null,
        status,
        priority: normalizePriority(task.priority),
        createdAt: createdAt ? createdAt.toISOString() : null,
        dueAt: dueAt ? dueAt.toISOString() : null,
        updatedAt: updatedAt ? updatedAt.toISOString() : null,
        ageHours: roundHours(hoursBetween(createdAt || updatedAt, now)),
        overdueHours: dueAt && dueAt.getTime() < now.getTime() ? roundHours(hoursBetween(dueAt, now)) : null,
        staleHours: roundHours(hoursBetween(lastOwnerActionAt || updatedAt || createdAt, now)),
        watchdogState,
        proposedAction,
        proposedRecipient: target ? {
            crmUserId: ownerId,
            channel: target.channel,
            channelUserIdOrChatIdRedactedOrNull: target.channelUserIdOrChatIdRedactedOrNull
        } : {
            crmUserId: ownerId || null,
            channel: 'telegram',
            channelUserIdOrChatIdRedactedOrNull: null
        },
        reasonCodes: [...new Set(reasonCodes)]
    };
}

function buildNewTaskAlarmCandidate(task = {}, options = {}) {
    const now = toDate(options.now) || new Date();
    const classified = classifyTask(task, options);
    if (classified.watchdogState === 'excluded' || classified.reasonCodes.includes(REASON_CODES.NOTIFICATION_TARGET_MISSING)) {
        return { candidate: null, classification: classified };
    }
    const createdAt = taskCreatedAt(task);
    const priority = priorityBucket(task.priority);
    const callbackData = buildTaskWatchdogAckCallbackData(classified.taskId);
    if (!callbackData) {
        classified.reasonCodes = [...new Set([...(classified.reasonCodes || []), REASON_CODES.CALLBACK_DATA_UNSAFE])];
        return { candidate: null, classification: classified };
    }
    const isRecent = createdAt ? hoursBetween(createdAt, now) <= ((options.policy || {}).newTaskAlarmWindowHours ?? DEFAULT_POLICY.newTaskAlarmWindowHours) : true;
    const important = priority === 'high' || priority === 'urgent';
    if (!isRecent || !important) return { candidate: null, classification: classified };
    return {
        candidate: {
            kind: 'new_task_alarm',
            taskId: classified.taskId,
            title: classified.title,
            watchdogState: classified.watchdogState === 'ok' ? 'new_task_alarm' : classified.watchdogState,
            ownerUserId: classified.ownerUserId,
            recipientCrmUserId: classified.ownerUserId,
            channel: 'telegram',
            text: `🚨 Нова важлива задача: ${formatTaskTitleForTelegram(classified.title)}`,
            buttons: [
                { label: 'Бачив ✅', action: 'task_watchdog_ack', taskId: classified.taskId, callbackData }
            ],
            dryRun: true
        },
        classification: classified
    };
}

function taskWatchdogDigestCandidates(reportOrCandidates = {}) {
    if (Array.isArray(reportOrCandidates)) return reportOrCandidates;
    if (Array.isArray(reportOrCandidates.notificationCandidates)) return reportOrCandidates.notificationCandidates;
    if (Array.isArray(reportOrCandidates.candidates)) return reportOrCandidates.candidates;
    return [];
}

function truncateTelegramHtmlMessage(value, { maxLength = 3500 } = {}) {
    const source = typeof value === 'string' ? value : '';
    const limit = normalizePositiveInt(maxLength) || 3500;
    if (Buffer.byteLength(source, 'utf8') <= limit) return source;
    const ellipsis = '…';
    let output = '';
    for (const char of source) {
        if (Buffer.byteLength(output + char + ellipsis, 'utf8') > limit) break;
        output += char;
    }
    return output ? `${output}${ellipsis}` : ellipsis;
}

function digestStateLabel(watchdogState) {
    const normalized = String(watchdogState || '').trim().toLowerCase();
    if (normalized === 'new_task_alarm') return 'нова / сьогодні';
    if (normalized === 'overdue') return 'прострочена';
    if (normalized === 'stale') return 'зависла';
    if (normalized === 'approaching_due') return 'дедлайн близько';
    if (normalized === 'ignored_after_reminder') return 'ігнор після нагадування';
    if (normalized === 'escalation_pending') return 'потрібна ескалація';
    if (normalized === 'reminded_once') return 'нагадували раніше';
    return normalized || 'потребує уваги';
}

function digestOwnerName(ownerUserId, candidate = {}, ownerScope = DEFAULT_OWNER_SCOPE) {
    const scope = normalizeOwnerScope(ownerScope);
    return candidate.ownerName || candidate.owner_name || scope.get(ownerUserId)?.displayName || `CRM user #${ownerUserId}`;
}

function buildTaskWatchdogOwnerDigest(reportOrCandidates = {}, options = {}) {
    const maxItems = normalizePositiveInt(options.maxItems) || 10;
    const requestedOwnerId = normalizePositiveInt(options.ownerUserId);
    const candidates = taskWatchdogDigestCandidates(reportOrCandidates)
        .filter(Boolean)
        .filter(candidate => {
            const ownerId = normalizePositiveInt(candidate.ownerUserId ?? candidate.owner_user_id ?? candidate.recipientCrmUserId);
            return requestedOwnerId ? ownerId === requestedOwnerId : true;
        });
    const grouped = buildTaskWatchdogOwnerDigests({ notificationCandidates: candidates }, { ...options, maxItems });
    return grouped[0] || null;
}

function buildTaskWatchdogOwnerDigests(report = {}, options = {}) {
    const ownerScope = normalizeOwnerScope(options.ownerScope || DEFAULT_OWNER_SCOPE);
    const maxItems = normalizePositiveInt(options.maxItems) || 10;
    const candidates = taskWatchdogDigestCandidates(report);
    const groups = new Map();

    for (const candidate of candidates) {
        const ownerUserId = normalizePositiveInt(candidate?.ownerUserId ?? candidate?.owner_user_id ?? candidate?.recipientCrmUserId);
        if (!ownerUserId || !ownerScope.has(ownerUserId)) continue;
        if (!groups.has(ownerUserId)) groups.set(ownerUserId, []);
        groups.get(ownerUserId).push(candidate);
    }

    const digests = [];
    for (const [ownerUserId, ownerCandidates] of [...groups.entries()].sort(([a], [b]) => a - b)) {
        const seenTaskIds = new Set();
        const reasonCodes = [];
        const tasks = [];
        let ownerName = digestOwnerName(ownerUserId, ownerCandidates[0], ownerScope);

        for (const candidate of ownerCandidates) {
            const normalizedTaskIdString = normalizePositiveIntegerString(candidate.taskId ?? candidate.task_id ?? candidate.id);
            if (!normalizedTaskIdString) {
                reasonCodes.push(REASON_CODES.CALLBACK_DATA_UNSAFE);
                tasks.push({
                    taskId: null,
                    title: formatTaskTitleForTelegram(candidate.title || candidate.text || 'Задача'),
                    watchdogState: candidate.watchdogState || candidate.kind || 'needs_attention',
                    callbackData: null,
                    reasonCodes: [REASON_CODES.CALLBACK_DATA_UNSAFE]
                });
                continue;
            }
            if (seenTaskIds.has(normalizedTaskIdString)) {
                reasonCodes.push(REASON_CODES.DUPLICATE_TASK_ID_SUPPRESSED);
                continue;
            }
            seenTaskIds.add(normalizedTaskIdString);
            const taskIdValue = Number(normalizedTaskIdString);
            const rawCallbackData = candidate.callbackData
                || candidate.callback_data
                || candidate.buttons?.find(button => button?.callbackData || button?.callback_data)?.callbackData
                || candidate.buttons?.find(button => button?.callbackData || button?.callback_data)?.callback_data
                || buildTaskWatchdogAckCallbackData(taskIdValue);
            const parsedCallback = parseTaskWatchdogCallbackData(rawCallbackData);
            const callbackData = parsedCallback.ok && parsedCallback.taskId === taskIdValue
                ? rawCallbackData
                : null;
            const itemReasonCodes = [];
            if (!callbackData) {
                reasonCodes.push(REASON_CODES.CALLBACK_DATA_UNSAFE);
                itemReasonCodes.push(REASON_CODES.CALLBACK_DATA_UNSAFE);
            }
            tasks.push({
                taskId: taskIdValue,
                title: formatTaskTitleForTelegram(candidate.title || candidate.taskTitle || candidate.text || `Задача #${taskIdValue}`),
                watchdogState: candidate.watchdogState || candidate.kind || 'needs_attention',
                callbackData,
                reasonCodes: itemReasonCodes
            });
        }

        const visibleTasks = tasks.slice(0, maxItems);
        const remainingCount = Math.max(0, tasks.length - visibleTasks.length);
        const lines = [
            `👊 ${sanitizeTelegramText(ownerName, { maxLength: 80 })}, задачі чекають`,
            ''
        ];
        visibleTasks.forEach((item, index) => {
            const taskNumber = item.taskId ? `#${item.taskId}` : '#?';
            lines.push(`${index + 1}. ${taskNumber} — ${item.title}`);
            lines.push(`   Стан: ${sanitizeTelegramText(digestStateLabel(item.watchdogState), { maxLength: 80 })}`);
        });
        if (remainingCount > 0) lines.push(`+${remainingCount} ще`);
        lines.push('', 'Натисни “Бачив ✅” по задачах, які побачив.');

        digests.push({
            kind: 'owner_task_digest',
            ownerUserId,
            taskCount: tasks.length,
            tasks,
            text: truncateTelegramHtmlMessage(lines.join('\n'), { maxLength: normalizePositiveInt(options.maxTextLength) || 3500 }),
            buttons: visibleTasks
                .filter(item => item.callbackData)
                .map(item => [{ text: `Бачив ${item.taskId} ✅`, callback_data: item.callbackData }]),
            liveSideEffects: false,
            reasonCodes: [...new Set(reasonCodes)],
            remainingCount
        });
    }

    return digests;
}

function buildBlockedAutoRescheduleTask(task = {}, reasonCode) {
    const ownerId = taskOwnerId(task);
    const dueAt = taskDueAt(task);
    const labels = taskLabels(task);
    const manualReview = [REASON_CODES.ROT_RISK_MANUAL_REVIEW, 'SENSITIVE_OR_CLIENT_CRITICAL_MANUAL_REVIEW', 'PROBLEM_REPORTED_MANUAL_REVIEW', 'MANUAL_ONLY'].includes(reasonCode);
    return {
        taskId: taskId(task),
        ownerUserId: ownerId,
        title: sanitizeTelegramText(taskTitle(task), { maxLength: 160 }),
        currentStatus: normalizeStatus(task.status),
        currentDueAt: dueAt ? dueAt.toISOString() : null,
        labels,
        reasonCode,
        manualReview,
        proposedAddLabels: manualReview ? ['watchdog:manual-review', ...(reasonCode === REASON_CODES.ROT_RISK_MANUAL_REVIEW ? ['rot_risk'] : []), 'needs_manager_attention'] : [],
        crmWriteRequired: false,
        approvalRequired: true,
        liveSideEffects: false
    };
}

function buildTaskWatchdogAutoRescheduleCandidate(task = {}, options = {}) {
    const failReason = autoRescheduleFailClosed(options);
    if (failReason) return { ok: false, blocked: true, reasonCode: failReason, dryRun: true, liveSideEffects: false, proposedChange: null };
    const timezone = options.timeZone || options.timezone || AUTO_RESCHEDULE_DEFAULTS.timezone;
    const now = toDate(options.now) || new Date();
    const today = getZonedDateParts(now, timezone).ymd;
    const ownerScope = normalizeAutoRescheduleOwnerScope(options);
    const ownerId = taskOwnerId(task);
    const status = normalizeStatus(task.status);
    const dueAt = taskDueAt(task);
    const dueYmd = dueAt ? getZonedDateParts(dueAt, timezone).ymd : null;
    const labels = taskLabels(task);
    const lowerLabels = labels.map(label => label.toLowerCase());
    const originalDueAt = taskOriginalDueAt(task);
    const originalDueYmd = originalDueAt ? getZonedDateParts(originalDueAt, timezone).ymd : dueYmd;
    const maxAutoReschedules = normalizePositiveInt(options.maxAutoReschedules ?? options.policy?.maxAutoReschedules) || AUTO_RESCHEDULE_DEFAULTS.maxAutoReschedules;
    const maxTaskAgeDays = normalizePositiveInt(options.maxTaskAgeDays ?? options.policy?.maxTaskAgeDays) || AUTO_RESCHEDULE_DEFAULTS.maxTaskAgeDays;
    if (!ownerId) return { ok: false, blocked: true, skipped: true, reasonCode: REASON_CODES.OWNER_MISSING, task: buildBlockedAutoRescheduleTask(task, REASON_CODES.OWNER_MISSING) };
    if (!ownerScope.includes(ownerId)) {
        const reasonCode = ownerId === 9 ? REASON_CODES.TELEGRAM_ID_USED_AS_OWNER_BLOCKED : REASON_CODES.OWNER_NOT_ALLOWED;
        return { ok: false, blocked: true, skipped: true, reasonCode, task: buildBlockedAutoRescheduleTask(task, reasonCode) };
    }
    if (ACTIVE_STATUSES_EXCLUDED.has(status)) return { ok: false, blocked: true, reasonCode: REASON_CODES.STATUS_EXCLUDED, task: buildBlockedAutoRescheduleTask(task, REASON_CODES.STATUS_EXCLUDED) };
    if (!dueAt || !dueYmd || compareYmd(dueYmd, today) > 0) return { ok: false, blocked: true, skipped: true, reasonCode: 'DUE_DATE_NOT_ELIGIBLE', task: buildBlockedAutoRescheduleTask(task, 'DUE_DATE_NOT_ELIGIBLE') };
    const snoozeUntil = taskSnoozeUntilForAutoReschedule(task);
    if (snoozeUntil && snoozeUntil.getTime() > now.getTime()) return { ok: false, blocked: true, reasonCode: 'SNOOZE_ACTIVE', task: buildBlockedAutoRescheduleTask(task, 'SNOOZE_ACTIVE') };
    if (task.problemReported === true || task.problem_reported === true || lowerLabels.includes('problem_reported')) return { ok: false, blocked: true, reasonCode: 'PROBLEM_REPORTED_MANUAL_REVIEW', task: buildBlockedAutoRescheduleTask(task, 'PROBLEM_REPORTED_MANUAL_REVIEW') };
    if (hasAutoRescheduleBlockLabel(labels)) return { ok: false, blocked: true, reasonCode: 'MANUAL_ONLY', task: buildBlockedAutoRescheduleTask(task, 'MANUAL_ONLY') };
    if (hasSensitiveAutoRescheduleSignal(task, labels)) return { ok: false, blocked: true, reasonCode: 'SENSITIVE_OR_CLIENT_CRITICAL_MANUAL_REVIEW', task: buildBlockedAutoRescheduleTask(task, 'SENSITIVE_OR_CLIENT_CRITICAL_MANUAL_REVIEW') };
    const lastAuto = taskLastAutoRescheduledAt(task);
    if (lastAuto && getZonedDateParts(lastAuto, timezone).ymd === today) return { ok: false, blocked: true, reasonCode: 'ALREADY_AUTO_RESCHEDULED_TODAY', task: buildBlockedAutoRescheduleTask(task, 'ALREADY_AUTO_RESCHEDULED_TODAY') };
    if (taskAutoRescheduleCount(task) >= maxAutoReschedules) return { ok: false, blocked: true, reasonCode: 'AUTO_RESCHEDULE_LIMIT_REACHED', task: buildBlockedAutoRescheduleTask(task, 'AUTO_RESCHEDULE_LIMIT_REACHED') };
    if (originalDueYmd && ymdDiffDays(originalDueYmd, today) > maxTaskAgeDays) return { ok: false, blocked: true, reasonCode: REASON_CODES.ROT_RISK_MANUAL_REVIEW, task: buildBlockedAutoRescheduleTask(task, REASON_CODES.ROT_RISK_MANUAL_REVIEW) };
    const reason = autoRescheduleReason(task, dueYmd, today);
    const proposedDueAt = zonedLocalIso(nextWorkingYmd(today, timezone), reason.time, timezone);
    const baseLabels = ['watchdog', 'watchdog:auto-reschedule-candidate', 'crm_write_pending_approval', 'rollout_serhii', `owner_${ownerId}`, reason.reason];
    if (reason.reason === 'overdue_previous_day' && ymdDiffDays(dueYmd, today) >= 1) baseLabels.push('risk_medium');
    const proposedAddLabels = [...new Set(baseLabels.filter(label => !lowerLabels.includes(label.toLowerCase())))];
    const currentDueAt = task.dueAt ?? task.due_at ?? task.deadline ?? task.date ?? task.remind_at ?? task.remindAt ?? (dueAt ? dueAt.toISOString() : null);
    const taskIdValue = taskId(task);
    const watchdogRunId = options.watchdogRunId || today;
    const idempotencyKeySeed = `${taskIdValue}:${currentDueAt}:${reason.policy}:${watchdogRunId}`;
    const proposedChange = {
        taskId: taskIdValue,
        ownerUserId: ownerId,
        title: sanitizeTelegramText(taskTitle(task), { maxLength: 160 }),
        currentStatus: status,
        currentDueAt,
        proposedDueAt,
        proposedAddLabels,
        reason: reason.reason,
        policy: reason.policy,
        idempotencyKeySeed,
        crmWriteRequired: true,
        readbackRequired: true,
        approvalRequired: true,
        fieldDiff: { dueAt: { from: currentDueAt, to: proposedDueAt }, tags: { add: proposedAddLabels }, audit: { action: 'task_watchdog_auto_reschedule_planned', dryRun: true, idempotencyKeySeed } }
    };
    return { ok: true, eligible: true, dryRun: true, liveSideEffects: false, proposedChange };
}

function buildTaskWatchdogAutoRescheduleBatch(tasks = [], options = {}) {
    const timezone = options.timeZone || options.timezone || AUTO_RESCHEDULE_DEFAULTS.timezone;
    const now = toDate(options.now) || new Date();
    const generatedAt = now.toISOString();
    const ownerScope = normalizeAutoRescheduleOwnerScope(options);
    const ownerUserId = normalizePositiveInt(options.ownerUserId) || ownerScope[0] || 4;
    const maxAutoReschedules = normalizePositiveInt(options.maxAutoReschedules ?? options.policy?.maxAutoReschedules) || AUTO_RESCHEDULE_DEFAULTS.maxAutoReschedules;
    const maxTaskAgeDays = normalizePositiveInt(options.maxTaskAgeDays ?? options.policy?.maxTaskAgeDays) || AUTO_RESCHEDULE_DEFAULTS.maxTaskAgeDays;
    const failReason = autoRescheduleFailClosed(options);
    if (failReason) return { ok: false, blocked: true, reasonCode: failReason, reasonCodes: [failReason], mode: 'task_watchdog_auto_reschedule_batch', dryRun: true, liveSideEffects: false, generatedAt, ownerUserId, ownerScope, proposedChanges: [], blockedTasks: [], safety: { crmWrites: 0, telegramSends: 0, cronGatewayDeploy: false, secretReads: 0 } };
    const proposedChanges = [];
    const blockedTasks = [];
    let active = 0;
    let manualReview = 0;
    for (const item of tasks || []) {
        if (!ACTIVE_STATUSES_EXCLUDED.has(normalizeStatus(item?.status))) active += 1;
        const candidate = buildTaskWatchdogAutoRescheduleCandidate(item, { ...options, now, timeZone: timezone, ownerScope, maxAutoReschedules, maxTaskAgeDays });
        if (candidate.ok && candidate.proposedChange) proposedChanges.push(candidate.proposedChange);
        else if (candidate.task) {
            blockedTasks.push(candidate.task);
            if (candidate.task.manualReview) manualReview += 1;
        }
    }
    const packetId = options.packetId || AUTO_RESCHEDULE_DEFAULTS.packetId;
    const fields = ['dueAt', 'tags', 'audit'];
    return {
        ok: true,
        mode: 'task_watchdog_auto_reschedule_batch',
        dryRun: true,
        liveSideEffects: false,
        generatedAt,
        ownerUserId,
        ownerScope,
        policy: { workHours: AUTO_RESCHEDULE_DEFAULTS.workHours, maxAutoReschedules, maxTaskAgeDays, timeZone: timezone },
        summary: { scanned: Array.isArray(tasks) ? tasks.length : 0, active, eligible: proposedChanges.length, blocked: blockedTasks.length, manualReview, maxWrites: proposedChanges.length },
        proposedChanges,
        blockedTasks,
        approvalPacket: {
            packetId,
            approvalString: `APPROVE CRM/BOT CHANGE ${packetId} OWNER=${ownerUserId} MAX_TASKS=${proposedChanges.length} FIELDS=dueAt,tags,audit AUTO_RESCHEDULE_COUNT_MAX=${maxAutoReschedules}`,
            fields,
            maxTasks: proposedChanges.length,
            perTaskFieldDiffs: proposedChanges.map(change => ({ taskId: change.taskId, fieldDiff: change.fieldDiff })),
            rollbackNotes: proposedChanges.map(change => `Task ${change.taskId}: restore dueAt to ${change.currentDueAt || 'NULL'} and remove labels added by this approval if CRM write is later applied.`)
        },
        safety: { crmWrites: 0, telegramSends: 0, cronGatewayDeploy: false, secretReads: 0 }
    };
}

function taskWatchdogAutoRescheduleApprovalString({ packetId, ownerUserId, maxTasks, maxAutoReschedules }) {
    return `APPROVE CRM/BOT CHANGE ${packetId} OWNER=${ownerUserId} MAX_TASKS=${maxTasks} FIELDS=dueAt,tags,audit AUTO_RESCHEDULE_COUNT_MAX=${maxAutoReschedules}`;
}

function datePartFromDueAt(dueAt) {
    return typeof dueAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dueAt) ? dueAt.slice(0, 10) : null;
}

function proposedChangesFromBatchOrPlan(batchOrPlan = {}) {
    if (Array.isArray(batchOrPlan.proposedChanges)) return batchOrPlan.proposedChanges;
    if (Array.isArray(batchOrPlan.operations)) {
        return batchOrPlan.operations
            .filter(operation => operation?.operation === 'update_task_due_and_watchdog_meta')
            .map(operation => ({
                taskId: operation.taskId,
                ownerUserId: operation.ownerUserId,
                currentDueAt: operation.expectedCurrentDueAt,
                proposedDueAt: operation.set?.deadline,
                proposedAddLabels: operation.set?.control_meta_patch?.watchdog?.labels || [],
                reason: operation.set?.control_meta_patch?.watchdog?.autoReschedule?.reason,
                policy: operation.set?.control_meta_patch?.watchdog?.autoReschedule?.policy,
                idempotencyKeySeed: operation.idempotencyKeySeed,
                currentStatus: 'todo'
            }));
    }
    return [];
}

function buildTaskWatchdogAutoRescheduleMutationPlan(batch = {}, options = {}) {
    const proposedChanges = proposedChangesFromBatchOrPlan(batch);
    const ownerUserId = normalizePositiveInt(options.ownerUserId ?? batch.ownerUserId) || 4;
    const maxAutoReschedules = normalizePositiveInt(options.maxAutoReschedules ?? batch.policy?.maxAutoReschedules) || AUTO_RESCHEDULE_DEFAULTS.maxAutoReschedules;
    const packetId = options.packetId || batch.approvalPacket?.packetId || AUTO_RESCHEDULE_DEFAULTS.packetId;
    const generatedAt = options.generatedAt || batch.generatedAt || (toDate(options.now) || new Date()).toISOString();
    const fields = ['dueAt', 'tags', 'audit'];
    const eligibleChanges = ownerUserId === 4 ? proposedChanges.filter(change => normalizePositiveInt(change.ownerUserId) === 4) : [];
    const skippedProposed = proposedChanges.length - eligibleChanges.length;
    const operations = [];
    const readbackPlan = [];
    const rollbackPlan = [];

    for (const change of eligibleChanges) {
        const labels = Array.isArray(change.proposedAddLabels) ? [...new Set(change.proposedAddLabels.map(label => String(label || '').trim()).filter(Boolean))] : [];
        const controlMetaPatch = {
            watchdog: {
                labels,
                autoReschedule: {
                    reason: change.reason,
                    policy: change.policy,
                    plannedAt: generatedAt,
                    autoRescheduleCountIncrement: 1,
                    idempotencyKeySeed: change.idempotencyKeySeed
                }
            }
        };
        const updateOperation = {
            operation: 'update_task_due_and_watchdog_meta',
            taskId: change.taskId,
            ownerUserId: change.ownerUserId,
            expectedCurrentDueAt: change.currentDueAt || null,
            expectedStatusNotIn: ['done', 'cancelled', 'archived'],
            set: {
                deadline: change.proposedDueAt,
                date: datePartFromDueAt(change.proposedDueAt),
                snoozed_until: null,
                remind_at: null,
                control_meta_patch: controlMetaPatch
            },
            where: {
                id: change.taskId,
                owner_user_id: change.ownerUserId,
                business_context: 'event_genix'
            },
            idempotencyKeySeed: change.idempotencyKeySeed,
            readbackRequired: true,
            rollback: {
                deadline: change.currentDueAt || null,
                removeControlMetaLabels: labels
            }
        };
        const auditOperation = {
            operation: 'insert_task_action_history',
            taskId: change.taskId,
            actionType: 'task_rescheduled',
            sourceSurface: 'task_watchdog',
            oldValue: { deadline: change.currentDueAt || null },
            newValue: { deadline: change.proposedDueAt, date: datePartFromDueAt(change.proposedDueAt), control_meta_patch: controlMetaPatch },
            meta: {
                packetId,
                ownerUserId: change.ownerUserId,
                idempotencyKeySeed: change.idempotencyKeySeed,
                dryRun: true,
                labels,
                sourceSurface: 'task_watchdog',
                fields
            },
            summary: 'Task auto-reschedule planned by Task Watchdog'
        };
        operations.push(updateOperation, auditOperation);
        readbackPlan.push({ taskId: change.taskId, ownerUserId: change.ownerUserId, expectedDeadline: change.proposedDueAt, expectedDate: datePartFromDueAt(change.proposedDueAt), expectedControlMetaLabels: labels });
        rollbackPlan.push({ taskId: change.taskId, ownerUserId: change.ownerUserId, deadline: change.currentDueAt || null, removeControlMetaLabels: labels });
    }

    const approvalString = taskWatchdogAutoRescheduleApprovalString({ packetId, ownerUserId, maxTasks: eligibleChanges.length, maxAutoReschedules });
    return {
        ok: true,
        mode: 'task_watchdog_auto_reschedule_mutation_plan',
        dryRun: true,
        liveSideEffects: false,
        ownerUserId,
        packetId,
        approvalRequired: true,
        approved: false,
        approvalPacket: { packetId, approvalString, fields, maxTasks: eligibleChanges.length, autoRescheduleCountMax: maxAutoReschedules },
        approvalString,
        summary: { proposed: eligibleChanges.length, plannedUpdates: eligibleChanges.length, plannedAuditEvents: eligibleChanges.length, blocked: (batch.blockedTasks?.length || 0) + skippedProposed },
        operations,
        readbackPlan,
        rollbackPlan,
        safety: { crmWrites: 0, telegramSends: 0, cronGatewayDeploy: false, secretReads: 0 }
    };
}

function validateTaskWatchdogAutoRescheduleApproval(batchOrPlan = {}, options = {}) {
    const plan = batchOrPlan.mode === 'task_watchdog_auto_reschedule_mutation_plan'
        ? batchOrPlan
        : buildTaskWatchdogAutoRescheduleMutationPlan(batchOrPlan, options);
    const packetId = plan.packetId || plan.approvalPacket?.packetId || AUTO_RESCHEDULE_DEFAULTS.packetId;
    const ownerUserId = normalizePositiveInt(plan.ownerUserId);
    const maxTasks = normalizePositiveInt(plan.approvalPacket?.maxTasks ?? plan.summary?.proposed ?? 0) || 0;
    const maxAutoReschedules = normalizePositiveInt(plan.approvalPacket?.autoRescheduleCountMax ?? options.maxAutoReschedules ?? AUTO_RESCHEDULE_DEFAULTS.maxAutoReschedules) || AUTO_RESCHEDULE_DEFAULTS.maxAutoReschedules;
    const fields = plan.approvalPacket?.fields || ['dueAt', 'tags', 'audit'];
    const expectedApprovalString = taskWatchdogAutoRescheduleApprovalString({ packetId, ownerUserId, maxTasks, maxAutoReschedules });
    const reasonCodes = [];
    if (ownerUserId !== 4) reasonCodes.push('APPROVAL_OWNER_NOT_ALLOWED');
    if (maxTasks !== (plan.operations || []).filter(operation => operation.operation === 'update_task_due_and_watchdog_meta').length) reasonCodes.push('APPROVAL_MAX_TASKS_MISMATCH');
    if (fields.join(',') !== 'dueAt,tags,audit') reasonCodes.push('APPROVAL_FIELDS_MISMATCH');
    if (maxAutoReschedules !== AUTO_RESCHEDULE_DEFAULTS.maxAutoReschedules) reasonCodes.push('APPROVAL_AUTO_RESCHEDULE_COUNT_MAX_MISMATCH');
    if (options.approvalString !== expectedApprovalString) reasonCodes.push('APPROVAL_STRING_MISMATCH');
    return {
        ok: reasonCodes.length === 0,
        approved: reasonCodes.length === 0,
        expectedApprovalString,
        providedApprovalString: options.approvalString || null,
        ownerUserId,
        maxTasks,
        fields,
        autoRescheduleCountMax: maxAutoReschedules,
        reasonCodes,
        reasonCode: reasonCodes[0] || null
    };
}

function mergeWatchdogMetaForReadback(controlMeta = {}, patchValue = {}) {
    const base = controlMeta && typeof controlMeta === 'object' && !Array.isArray(controlMeta) ? controlMeta : {};
    const watchdogBase = base.watchdog && typeof base.watchdog === 'object' && !Array.isArray(base.watchdog) ? base.watchdog : {};
    return { ...base, watchdog: { ...watchdogBase, ...(patchValue.watchdog || {}) } };
}

async function applyTaskWatchdogAutoRescheduleMutationPlan(pool, batchOrPlan = {}, options = {}) {
    const plan = batchOrPlan.mode === 'task_watchdog_auto_reschedule_mutation_plan'
        ? batchOrPlan
        : buildTaskWatchdogAutoRescheduleMutationPlan(batchOrPlan, options);
    const approval = validateTaskWatchdogAutoRescheduleApproval(plan, options);
    const baseReceipt = {
        mode: 'task_watchdog_auto_reschedule_mutation_apply',
        dryRun: options.dryRun !== false,
        liveSideEffects: false,
        ownerUserId: plan.ownerUserId,
        packetId: plan.packetId,
        queryCount: 0,
        approval
    };
    if (options.allowWrite !== true || options.execute !== true || options.dryRun !== false) {
        return { ...baseReceipt, ok: false, blocked: true, reasonCode: REASON_CODES.CRM_WRITE_REQUIRES_APPROVAL, reasonCodes: [REASON_CODES.CRM_WRITE_REQUIRES_APPROVAL], applied: 0 };
    }
    if (!approval.ok) {
        return { ...baseReceipt, ok: false, blocked: true, reasonCode: REASON_CODES.CRM_WRITE_REQUIRES_APPROVAL, reasonCodes: [REASON_CODES.CRM_WRITE_REQUIRES_APPROVAL, ...approval.reasonCodes], applied: 0 };
    }
    if (!pool || typeof pool.query !== 'function') {
        return { ...baseReceipt, ok: false, blocked: true, reasonCode: 'POOL_QUERY_MISSING', reasonCodes: ['POOL_QUERY_MISSING'], applied: 0 };
    }

    const queryLog = [];
    const trackQueryable = queryable => ({
        query: async (text, values) => {
            queryLog.push({ text, values });
            return queryable.query(text, values);
        },
        ...(typeof queryable.release === 'function' ? { release: () => queryable.release() } : {})
    });
    const trackedPool = typeof pool.connect === 'function'
        ? {
            connect: async () => trackQueryable(await pool.connect()),
            query: async (text, values) => {
                queryLog.push({ text, values });
                return pool.query(text, values);
            }
        }
        : trackQueryable(pool);
    const failReceipt = (error, appliedCount) => {
        const reasonCode = error?.code === 'TASK_NOT_VISIBLE'
            ? REASON_CODES.TASK_NOT_FOUND
            : (error?.code || 'TASK_WATCHDOG_RESCHEDULE_FAILED');
        return {
            ...baseReceipt,
            ok: false,
            blocked: true,
            failed: true,
            reasonCode,
            reasonCodes: [reasonCode],
            queryCount: queryLog.length,
            queryLog,
            applied: appliedCount
        };
    };
    const updates = plan.operations.filter(operation => operation.operation === 'update_task_due_and_watchdog_meta');
    const auditsByTask = new Map(plan.operations.filter(operation => operation.operation === 'insert_task_action_history').map(operation => [operation.taskId, operation]));
    const applied = [];

    for (const operation of updates) {
        const audit = auditsByTask.get(operation.taskId);
        try {
            const result = await rescheduleTask(
                operation.taskId,
                operation.set.deadline,
                { username: 'task_watchdog', name: 'Task Watchdog', role: 'creator' },
                {
                    pool: trackedPool,
                    businessScope: operation.where?.business_context || 'event_genix',
                    sourceSurface: 'task_watchdog',
                    route: 'task_watchdog_auto_reschedule',
                    reason: operation.set.control_meta_patch?.watchdog?.reason || 'watchdog_auto_reschedule',
                    actorType: 'system',
                    idempotencyKey: operation.idempotencyKeySeed,
                    requireIdempotency: true,
                    expectedOwnerUserId: operation.ownerUserId,
                    controlMetaPatch: operation.set.control_meta_patch,
                    summary: audit?.summary || 'Task auto-rescheduled by Task Watchdog',
                    meta: {
                        ...(audit?.meta || {}),
                        packetId: plan.packetId,
                        watchdogApproved: true
                    }
                }
            );
            applied.push({
                taskId: operation.taskId,
                ownerUserId: operation.ownerUserId,
                deadline: result.task.deadline,
                postponementCount: result.task.postponementCount,
                idempotent: result.idempotent === true
            });
        } catch (error) {
            return failReceipt(error, applied.length);
        }
    }

    return {
        ...baseReceipt,
        ok: true,
        blocked: false,
        dryRun: false,
        liveSideEffects: true,
        reasonCodes: [],
        applied: applied.length,
        appliedTasks: applied,
        queryCount: queryLog.length,
        queryLog,
        safety: { crmWrites: queryLog.filter(item => /^\s*(UPDATE|INSERT)/i.test(item.text)).length, telegramSends: 0, cronGatewayDeploy: false, secretReads: 0 }
    };
}

function buildDryRunReport(tasks = [], options = {}) {
    const now = toDate(options.now) || new Date();
    const ownerScope = normalizeOwnerScope(options.ownerScope || DEFAULT_OWNER_SCOPE);
    const ownerScopeArray = [...ownerScope.keys()].sort((a, b) => a - b);
    const taskRows = [];
    const notificationCandidates = [];
    const totals = {
        scanned: 0,
        excluded: 0,
        ok: 0,
        overdue: 0,
        stale: 0,
        reminderCandidates: 0,
        escalationCandidates: 0,
        skippedDueToIdentity: 0
    };

    const candidateTaskIds = new Set();

    for (const task of tasks || []) {
        totals.scanned += 1;
        const row = classifyTask(task, { ...options, now });
        const stableTaskId = buildTaskWatchdogAckCallbackData(row.taskId)?.slice('tw_ack:'.length) || null;
        const alreadyCountedCandidate = stableTaskId ? candidateTaskIds.has(stableTaskId) : false;
        if (alreadyCountedCandidate) {
            row.reasonCodes = [...new Set([...(row.reasonCodes || []), REASON_CODES.DUPLICATE_TASK_ID_SUPPRESSED])];
        }
        taskRows.push(row);
        if (row.watchdogState === 'excluded' || row.watchdogState === 'resolved') totals.excluded += 1;
        if (row.watchdogState === 'ok') totals.ok += 1;
        if (row.watchdogState === 'overdue') totals.overdue += 1;
        if (row.watchdogState === 'stale') totals.stale += 1;
        if (!alreadyCountedCandidate && (row.proposedAction === 'first_reminder' || row.proposedAction === 'second_reminder')) totals.reminderCandidates += 1;
        if (!alreadyCountedCandidate && row.proposedAction === 'escalate') totals.escalationCandidates += 1;
        if (row.reasonCodes.includes(REASON_CODES.OWNER_NOT_ALLOWED) || row.reasonCodes.includes(REASON_CODES.TELEGRAM_ID_USED_AS_OWNER_BLOCKED)) {
            totals.skippedDueToIdentity += 1;
        }
        const { candidate: alarm, classification: alarmClassification } = alreadyCountedCandidate
            ? { candidate: null, classification: row }
            : buildNewTaskAlarmCandidate(task, { ...options, now });
        if (alarm) {
            notificationCandidates.push(alarm);
            if (stableTaskId) candidateTaskIds.add(stableTaskId);
        } else if (stableTaskId && (row.proposedAction === 'first_reminder' || row.proposedAction === 'second_reminder' || row.proposedAction === 'escalate')) {
            candidateTaskIds.add(stableTaskId);
        } else if (alarmClassification?.reasonCodes?.includes(REASON_CODES.CALLBACK_DATA_UNSAFE)) {
            row.reasonCodes = [...new Set([...(row.reasonCodes || []), REASON_CODES.CALLBACK_DATA_UNSAFE])];
        }
    }

    return {
        generatedAt: now.toISOString(),
        dryRun: true,
        ownerScope: ownerScopeArray,
        totals,
        tasks: taskRows,
        notificationCandidates,
        liveSideEffects: false
    };
}

function ackActorIdFromArgs(actor) {
    return normalizePositiveInt(actor?.crmUserId ?? actor?.actorCrmUserId ?? actor?.actor_user_id ?? actor?.actorUserId ?? actor);
}

function hasExistingAck(task = {}, actorCrmUserId, options = {}) {
    if (!actorCrmUserId) return false;
    const directAckActor = normalizePositiveInt(
        task.watchdogAcknowledgedBy ?? task.watchdog_acknowledged_by ?? task.acknowledgedBy ?? task.acknowledged_by
    );
    if (taskAckState(task) && (!directAckActor || directAckActor === actorCrmUserId)) return true;
    const events = [
        ...(Array.isArray(task.watchdogAckEvents) ? task.watchdogAckEvents : []),
        ...(Array.isArray(task.watchdog_ack_events) ? task.watchdog_ack_events : []),
        ...(Array.isArray(options.ackEvents) ? options.ackEvents : []),
        ...(Array.isArray(options.existingAckEvents) ? options.existingAckEvents : [])
    ];
    const currentTaskId = normalizePositiveIntegerString(taskId(task));
    return events.some(event => {
        const actionType = event?.actionType || event?.action_type || event?.type;
        const eventTaskId = normalizePositiveIntegerString(event?.taskId ?? event?.task_id);
        const eventActorId = normalizePositiveInt(event?.actorUserId ?? event?.actor_user_id ?? event?.actorCrmUserId);
        return actionType === 'task_watchdog_acknowledged'
            && eventTaskId === currentTaskId
            && eventActorId === actorCrmUserId;
    });
}

function acknowledgeTaskSeen(input = {}, actor = null, options = {}) {
    const normalizedInput = input && input.task ? input : { task: input, actor, ...options };
    const task = normalizedInput.task || {};
    const actorCrmUserId = normalizePositiveInt(
        normalizedInput.actorCrmUserId ?? normalizedInput.actor_user_id ?? normalizedInput.actorUserId
    ) || ackActorIdFromArgs(normalizedInput.actor);
    const ownerId = taskOwnerId(task);
    const now = toDate(normalizedInput.now) || new Date();
    const ownerScope = normalizeOwnerScope(normalizedInput.ownerScope || DEFAULT_OWNER_SCOPE);
    if (!ownerId || !ownerScope.has(ownerId)) {
        return { ok: false, state: 'excluded', reasonCode: ownerId ? REASON_CODES.OWNER_NOT_ALLOWED : REASON_CODES.OWNER_MISSING };
    }
    if (actorCrmUserId !== ownerId && normalizedInput.allowManagerOverride !== true) {
        return { ok: false, state: 'unchanged', reasonCode: REASON_CODES.ACK_FORBIDDEN_NOT_OWNER };
    }
    const callbackData = buildTaskWatchdogAckCallbackData(taskId(task));
    if (!callbackData) {
        return { ok: false, state: 'unchanged', reasonCode: REASON_CODES.CALLBACK_DATA_UNSAFE };
    }
    if (hasExistingAck(task, actorCrmUserId, normalizedInput)) {
        return {
            ok: true,
            state: 'acknowledged',
            idempotent: true,
            alreadyAcknowledged: true,
            taskId: taskId(task),
            ownerUserId: ownerId,
            actorCrmUserId,
            event: null
        };
    }
    return {
        ok: true,
        state: 'acknowledged',
        idempotent: false,
        alreadyAcknowledged: false,
        taskId: taskId(task),
        ownerUserId: ownerId,
        actorCrmUserId,
        acknowledgedAt: now.toISOString(),
        event: {
            actionType: 'task_watchdog_acknowledged',
            taskId: taskId(task),
            actorUserId: actorCrmUserId,
            meta: { callbackDataShape: callbackData }
        }
    };
}

function normalizeLimit(value, fallback = 500) {
    const parsed = normalizePositiveInt(value);
    if (!parsed) return fallback;
    return Math.min(parsed, 1000);
}

function buildWatchdogTaskQuery(ownerIds, options = {}) {
    const ids = ownerIds.map(Number).filter(Boolean);
    const includeResolved = options.includeResolved === true;
    const limit = normalizeLimit(options.limit, 500);
    const resolvedFilter = includeResolved ? '' : `
              AND COALESCE(t.status, 'todo') NOT IN ('done','completed','cancelled','canceled','archived','resolved','closed')`;
    return {
        text: `
            SELECT t.id, t.title, t.status, t.priority, t.created_at, t.updated_at,
                   t.date, t.deadline, t.remind_at, t.snoozed_until, t.last_notified_at,
                   t.owner_user_id, t.assigned_to, t.owner, t.business_context,
                   u.name AS owner_name, u.username AS owner_username, u.telegram_chat_id, u.telegram_username,
                   last_owner_action.last_owner_action_at
            FROM tasks t
            LEFT JOIN users u ON u.id = t.owner_user_id
            LEFT JOIN LATERAL (
                SELECT MAX(created_at) AS last_owner_action_at
                FROM task_action_history h
                WHERE h.task_id = t.id
                  AND h.actor_user_id = t.owner_user_id
            ) last_owner_action ON TRUE
            WHERE t.owner_user_id = ANY($1::int[])${resolvedFilter}
            ORDER BY COALESCE(t.deadline, t.remind_at, t.updated_at, t.created_at) ASC NULLS LAST
            LIMIT $2
        `,
        values: [ids, limit]
    };
}

function buildWatchdogNotificationTargetsQuery(ownerIds) {
    const ids = ownerIds.map(Number).filter(Boolean);
    return {
        text: `
            SELECT id, name, username, telegram_chat_id, telegram_username
            FROM users
            WHERE id = ANY($1::int[])
        `,
        values: [ids]
    };
}

function rowsToNotificationTargets(rows = {}) {
    const targets = {};
    for (const row of rows || []) {
        const ownerId = normalizePositiveInt(row.owner_user_id || row.ownerUserId || row.id);
        if (!ownerId || targets[ownerId]) continue;
        if (row.telegram_chat_id || row.telegramChatId || row.telegram_username || row.telegramUsername) {
            targets[ownerId] = {
                crmUserId: ownerId,
                channel: 'telegram',
                telegramChatId: row.telegram_chat_id || row.telegramChatId || null,
                telegramUsername: row.telegram_username || row.telegramUsername || null,
                watchdogEnabled: true
            };
        }
    }
    return targets;
}

async function buildTaskWatchdogDryRunFromDb(pool, options = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool.query is required');
    const ownerScope = normalizeOwnerScope(options.ownerScope || DEFAULT_OWNER_SCOPE);
    const requestedOwner = normalizePositiveInt(options.ownerUserId);
    const ownerIds = requestedOwner ? [requestedOwner] : [...ownerScope.keys()];
    const invalidOwner = ownerIds.find(id => !ownerScope.has(id));
    if (invalidOwner) {
        return buildDryRunReport([{ id: null, title: `owner ${invalidOwner}`, owner_user_id: invalidOwner }], options);
    }
    const query = buildWatchdogTaskQuery(ownerIds, options);
    const result = await pool.query(query.text, query.values);
    const dbTargets = rowsToNotificationTargets(result.rows);
    return buildDryRunReport(result.rows, {
        ...options,
        ownerScope,
        notificationTargets: { ...dbTargets, ...(options.notificationTargets || {}) },
        activeOwnerIds: options.activeOwnerIds || ownerIds
    });
}

function selectTaskWatchdogOwnerIds(options = {}) {
    const ownerScope = normalizeOwnerScope(options.ownerScope || DEFAULT_OWNER_SCOPE);
    const requestedOwner = normalizePositiveInt(options.ownerUserId);
    if (requestedOwner) {
        return { ownerScope, ownerIds: [requestedOwner], invalidOwnerIds: ownerScope.has(requestedOwner) ? [] : [requestedOwner] };
    }
    const activeOwnerIds = Array.isArray(options.activeOwnerIds)
        ? options.activeOwnerIds.map(normalizePositiveInt).filter(Boolean)
        : [];
    const ownerIds = activeOwnerIds.length > 0 ? activeOwnerIds : [...ownerScope.keys()];
    const invalidOwnerIds = ownerIds.filter(id => !ownerScope.has(id));
    return { ownerScope, ownerIds: [...new Set(ownerIds.filter(id => ownerScope.has(id)))], invalidOwnerIds };
}

function summarizeTaskWatchdogCycle(report = {}) {
    const tasks = Array.isArray(report.tasks) ? report.tasks : [];
    const notificationCandidates = Array.isArray(report.notificationCandidates) ? report.notificationCandidates : [];
    const duplicateSuppressed = tasks.filter(row => row.reasonCodes?.includes(REASON_CODES.DUPLICATE_TASK_ID_SUPPRESSED)).length;
    const skippedDueToIdentity = tasks.filter(row => row.reasonCodes?.includes(REASON_CODES.OWNER_NOT_ALLOWED)
        || row.reasonCodes?.includes(REASON_CODES.TELEGRAM_ID_USED_AS_OWNER_BLOCKED)).length;
    const skippedDueToMissingTarget = tasks.filter(row => row.reasonCodes?.includes(REASON_CODES.NOTIFICATION_TARGET_MISSING)).length;
    return {
        tasksScanned: report.totals?.scanned || tasks.length,
        candidatesPlanned: notificationCandidates.length,
        duplicateSuppressed,
        skippedDueToIdentity,
        skippedDueToMissingTarget
    };
}

function buildTaskWatchdogStateSchemaSql() {
    return `
CREATE TABLE IF NOT EXISTS task_watchdog_events (
    id BIGSERIAL PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    task_id BIGINT NOT NULL,
    owner_user_id INTEGER NOT NULL,
    actor_user_id INTEGER,
    action_type TEXT NOT NULL,
    notification_mode TEXT NOT NULL DEFAULT 'plan',
    dry_run BOOLEAN NOT NULL DEFAULT TRUE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_watchdog_events_task_owner
    ON task_watchdog_events(task_id, owner_user_id, action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_watchdog_events_owner_created
    ON task_watchdog_events(owner_user_id, created_at DESC);
`;
}

async function ensureTaskWatchdogStateSchema(pool, options = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool.query is required');
    if (options.allowSchemaWrite !== true) {
        return { ok: false, skipped: true, reasonCode: REASON_CODES.PERSISTENCE_PREVIEW_NOT_APPLIED };
    }
    await pool.query(buildTaskWatchdogStateSchemaSql());
    return { ok: true, liveSideEffects: false };
}

function buildTaskWatchdogEventIdempotencyKey(event = {}) {
    const task = normalizePositiveIntegerString(event.taskId ?? event.task_id);
    const owner = normalizePositiveInt(event.ownerUserId ?? event.owner_user_id);
    const action = String(event.actionType || event.action_type || event.kind || 'planned').trim().toLowerCase();
    const bucket = String(event.bucket || event.generatedAt || event.createdAt || '').slice(0, 10) || 'current';
    if (!task || !owner || !action) return null;
    return `task_watchdog:${action}:${owner}:${task}:${bucket}`;
}

async function persistTaskWatchdogEvent(pool, event = {}, options = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool.query is required');
    if (options.allowWrite !== true) {
        return { ok: false, skipped: true, reasonCode: REASON_CODES.PERSISTENCE_PREVIEW_NOT_APPLIED };
    }
    const idempotencyKey = event.idempotencyKey || buildTaskWatchdogEventIdempotencyKey(event);
    if (!idempotencyKey) return { ok: false, reasonCode: REASON_CODES.CALLBACK_DATA_UNSAFE };
    const query = {
        text: `
            INSERT INTO task_watchdog_events
                (idempotency_key, task_id, owner_user_id, actor_user_id, action_type, notification_mode, dry_run, payload)
            VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7::jsonb)
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id, idempotency_key
        `,
        values: [
            idempotencyKey,
            normalizePositiveInt(event.taskId ?? event.task_id),
            normalizePositiveInt(event.ownerUserId ?? event.owner_user_id),
            normalizePositiveInt(event.actorUserId ?? event.actor_user_id),
            event.actionType || event.action_type || event.kind || 'planned',
            'plan',
            JSON.stringify(event.payload || event)
        ]
    };
    const result = await pool.query(query.text, query.values);
    return { ok: true, idempotent: result.rowCount === 0, idempotencyKey, liveSideEffects: false };
}

async function loadTaskWatchdogState(pool, options = {}) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool.query is required');
    const ownerIds = Array.isArray(options.ownerIds) ? options.ownerIds.map(normalizePositiveInt).filter(Boolean) : [];
    const query = {
        text: `
            SELECT idempotency_key, task_id, owner_user_id, actor_user_id, action_type, notification_mode, dry_run, created_at
            FROM task_watchdog_events
            WHERE ($1::int[] IS NULL OR owner_user_id = ANY($1::int[]))
            ORDER BY created_at DESC
            LIMIT $2
        `,
        values: [ownerIds.length ? ownerIds : null, normalizeLimit(options.limit, 100)]
    };
    const result = await pool.query(query.text, query.values);
    return { ok: true, rows: result.rows || [], liveSideEffects: false };
}

function buildTaskWatchdogAckTaskQuery(taskIdValue) {
    const normalizedTaskId = normalizePositiveIntegerString(taskIdValue);
    if (!normalizedTaskId) return null;
    return {
        text: `
            SELECT id, title, status, owner_user_id, NULL::integer AS account_user_id,
                   control_meta->'watchdog'->>'state' AS watchdog_state,
                   NULLIF(control_meta->'watchdog'->>'acknowledgedAt', '')::timestamptz AS watchdog_acknowledged_at,
                   NULLIF(control_meta->'watchdog'->>'acknowledgedBy', '')::int AS watchdog_acknowledged_by,
                   updated_at, created_at
            FROM tasks
            WHERE id = $1
            LIMIT 1
        `,
        values: [Number(normalizedTaskId)]
    };
}

async function handleTaskWatchdogAck(pool, options = {}) {
    const parsed = parseTaskWatchdogCallbackData(options.callbackData);
    const dryRun = options.dryRun !== false;
    const allowWrite = options.allowWrite === true;
    const actorCrmUserId = normalizePositiveInt(options.actorCrmUserId ?? options.actor_user_id ?? options.actorUserId) || null;
    const base = {
        ok: false,
        dryRun,
        liveSideEffects: false,
        action: parsed.action || 'ack',
        taskId: parsed.taskId || null,
        actorCrmUserId
    };
    if (!parsed.ok) return { ...base, reasonCode: REASON_CODES.CALLBACK_DATA_UNSAFE };
    if (!pool || typeof pool.query !== 'function') throw new Error('pool.query is required');

    const query = buildTaskWatchdogAckTaskQuery(parsed.taskId);
    if (!query) return { ...base, taskId: parsed.taskId, reasonCode: REASON_CODES.CALLBACK_DATA_UNSAFE };

    let result;
    try {
        result = await pool.query(query.text, query.values);
    } catch (error) {
        return { ...base, taskId: parsed.taskId, reasonCode: REASON_CODES.DB_QUERY_FAILED, errorMessage: error.message };
    }
    const task = (result.rows || [])[0];
    if (!task) return { ...base, taskId: parsed.taskId, reasonCode: REASON_CODES.TASK_NOT_FOUND };

    const ownerUserId = taskOwnerId(task);
    const ownerScope = normalizeOwnerScope(options.ownerScope || DEFAULT_OWNER_SCOPE);
    const receiptBase = { ...base, taskId: parsed.taskId, ownerUserId };
    if (!ownerUserId || !ownerScope.has(ownerUserId)) {
        return { ...receiptBase, reasonCode: ownerUserId ? REASON_CODES.OWNER_NOT_ALLOWED : REASON_CODES.OWNER_MISSING };
    }
    if (receiptBase.actorCrmUserId !== ownerUserId && options.allowManagerOverride !== true) {
        return { ...receiptBase, reasonCode: REASON_CODES.ACK_FORBIDDEN_NOT_OWNER };
    }

    const ack = acknowledgeTaskSeen({
        task,
        actorCrmUserId: receiptBase.actorCrmUserId,
        now: options.now,
        ownerScope,
        allowManagerOverride: options.allowManagerOverride === true,
        existingAckEvents: options.existingAckEvents
    });
    if (!ack.ok) return { ...receiptBase, reasonCode: ack.reasonCode };

    if (!allowWrite) {
        return {
            ok: true,
            dryRun,
            liveSideEffects: false,
            action: 'ack',
            taskId: parsed.taskId,
            ownerUserId,
            actorCrmUserId: receiptBase.actorCrmUserId,
            idempotent: ack.idempotent === true,
            persistence: { applied: false, reasonCode: REASON_CODES.PERSISTENCE_PREVIEW_NOT_APPLIED }
        };
    }

    const persistence = await persistTaskWatchdogEvent(pool, {
        idempotencyKey: `task_watchdog:ack:${ownerUserId}:${parsed.taskId}:${receiptBase.actorCrmUserId}`,
        taskId: parsed.taskId,
        ownerUserId,
        actorUserId: receiptBase.actorCrmUserId,
        actionType: 'task_watchdog_acknowledged',
        payload: {
            source: 'task_watchdog_callback',
            callbackDataShape: 'tw_ack:<taskId>',
            dryRun
        }
    }, { allowWrite: true });

    return {
        ok: persistence.ok === true,
        dryRun,
        liveSideEffects: false,
        action: 'ack',
        taskId: parsed.taskId,
        ownerUserId,
        actorCrmUserId: receiptBase.actorCrmUserId,
        idempotent: persistence.idempotent === true,
        persistence: {
            applied: persistence.ok === true && persistence.idempotent !== true,
            idempotent: persistence.idempotent === true,
            idempotencyKey: persistence.idempotencyKey
        }
    };
}

async function runTaskWatchdogCycle(pool, options = {}) {
    const now = toDate(options.now) || new Date();
    const notificationMode = options.notificationMode || 'plan';
    const dryRun = options.dryRun !== false;
    const generatedAt = now.toISOString();
    if (!dryRun || notificationMode !== 'plan') {
        return {
            ok: false,
            blocked: true,
            reasonCode: REASON_CODES.LIVE_ACTIVATION_REQUIRES_APPROVAL,
            reasonCodes: [
                REASON_CODES.LIVE_ACTIVATION_REQUIRES_APPROVAL,
                ...(notificationMode !== 'plan' ? [REASON_CODES.NOTIFICATION_MODE_NOT_ALLOWED] : [])
            ],
            dryRun,
            liveSideEffects: false,
            generatedAt,
            mode: 'task_watchdog_cycle'
        };
    }
    if (!pool || typeof pool.query !== 'function') throw new Error('pool.query is required');
    const { ownerScope, ownerIds, invalidOwnerIds } = selectTaskWatchdogOwnerIds(options);
    if (invalidOwnerIds.length > 0 || ownerIds.length === 0) {
        const reasonCodes = [REASON_CODES.OWNER_NOT_ALLOWED];
        const report = buildDryRunReport(invalidOwnerIds.map(id => ({ id: null, title: `owner ${id}`, owner_user_id: id })), {
            ...options,
            now,
            ownerScope,
            activeOwnerIds: ownerIds
        });
        return {
            ok: false,
            blocked: true,
            dryRun: true,
            liveSideEffects: false,
            generatedAt,
            mode: 'task_watchdog_cycle',
            ownerScope: ownerIds,
            report,
            notificationCandidates: [],
            ackRequiredCount: 0,
            blockers: reasonCodes,
            reasonCodes,
            receipt: summarizeTaskWatchdogCycle(report)
        };
    }

    try {
        const targetQuery = buildWatchdogNotificationTargetsQuery(ownerIds);
        const taskQuery = buildWatchdogTaskQuery(ownerIds, options);
        const [targetResult, taskResult] = await Promise.all([
            pool.query(targetQuery.text, targetQuery.values),
            pool.query(taskQuery.text, taskQuery.values)
        ]);
        const dbTargets = {
            ...rowsToNotificationTargets(targetResult.rows),
            ...rowsToNotificationTargets(taskResult.rows)
        };
        const report = buildDryRunReport(taskResult.rows, {
            ...options,
            now,
            ownerScope,
            notificationTargets: { ...dbTargets, ...(options.notificationTargets || {}) },
            activeOwnerIds: options.activeOwnerIds || ownerIds
        });
        const blockers = [];
        if (options.persistPreview === true) blockers.push(REASON_CODES.PERSISTENCE_PREVIEW_NOT_APPLIED);
        const reasonCodes = [...new Set([
            ...blockers,
            ...report.tasks.flatMap(row => row.reasonCodes || [])
        ])];
        const notificationCandidates = report.notificationCandidates;
        const ownerDigests = options.groupByOwner === true
            ? buildTaskWatchdogOwnerDigests(report, { ...options, ownerScope })
            : [];
        return {
            ok: true,
            dryRun: true,
            liveSideEffects: false,
            generatedAt,
            mode: 'task_watchdog_cycle',
            ownerScope: ownerIds,
            report,
            notificationCandidates,
            ownerDigests,
            ackRequiredCount: notificationCandidates.filter(item => item.buttons?.some(button => button.action === 'task_watchdog_ack')).length,
            blockers,
            reasonCodes,
            receipt: summarizeTaskWatchdogCycle(report)
        };
    } catch (error) {
        return {
            ok: false,
            blocked: true,
            dryRun: true,
            liveSideEffects: false,
            generatedAt,
            mode: 'task_watchdog_cycle',
            ownerScope: ownerIds,
            report: null,
            notificationCandidates: [],
            ackRequiredCount: 0,
            blockers: [REASON_CODES.DB_QUERY_FAILED],
            reasonCodes: [REASON_CODES.DB_QUERY_FAILED],
            errorMessage: error.message,
            receipt: {
                tasksScanned: 0,
                candidatesPlanned: 0,
                duplicateSuppressed: 0,
                skippedDueToIdentity: 0,
                skippedDueToMissingTarget: 0
            }
        };
    }
}

async function runTaskWatchdogScheduler(pool, options = {}) {
    const dryRun = options.dryRun !== false;
    const enabled = options.enabled === true;
    const notificationMode = options.notificationMode || 'plan';
    const generatedAt = (toDate(options.now) || new Date()).toISOString();
    if (!enabled) {
        return {
            generatedAt,
            dryRun: true,
            enabled: false,
            status: 'disabled',
            reasonCode: 'WATCHDOG_SCHEDULER_DISABLED_BY_DEFAULT',
            liveSideEffects: false
        };
    }
    if (!dryRun || notificationMode !== 'plan') {
        return {
            ok: false,
            blocked: true,
            generatedAt,
            dryRun,
            enabled: true,
            status: 'blocked',
            reasonCode: REASON_CODES.LIVE_ACTIVATION_REQUIRES_APPROVAL,
            reasonCodes: [
                REASON_CODES.LIVE_ACTIVATION_REQUIRES_APPROVAL,
                ...(notificationMode !== 'plan' ? [REASON_CODES.NOTIFICATION_MODE_NOT_ALLOWED] : [])
            ],
            liveSideEffects: false
        };
    }
    const report = await buildTaskWatchdogDryRunFromDb(pool, { ...options, dryRun: true, notificationMode: 'plan' });
    return { ...report, dryRun: true, enabled: true, liveSideEffects: false };
}

module.exports = {
    DEFAULT_OWNER_SCOPE,
    DEFAULT_POLICY,
    REASON_CODES,
    acknowledgeTaskSeen,
    applyTaskWatchdogAutoRescheduleMutationPlan,
    buildDryRunReport,
    buildNewTaskAlarmCandidate,
    buildTaskWatchdogAckCallbackData,
    buildTaskWatchdogAckTaskQuery,
    buildTaskWatchdogAutoRescheduleBatch,
    buildTaskWatchdogAutoRescheduleCandidate,
    buildTaskWatchdogAutoRescheduleMutationPlan,
    buildTaskWatchdogDryRunFromDb,
    buildTaskWatchdogOwnerDigest,
    buildTaskWatchdogOwnerDigests,
    buildTaskWatchdogStateSchemaSql,
    buildWatchdogNotificationTargetsQuery,
    buildWatchdogTaskQuery,
    classifyTask,
    ensureTaskWatchdogStateSchema,
    formatTaskTitleForTelegram,
    handleTaskWatchdogAck,
    loadTaskWatchdogState,
    normalizeNotificationTargets,
    normalizeOwnerScope,
    normalizePositiveInt,
    ownerUsesTaskManager,
    parseTaskWatchdogCallbackData,
    persistTaskWatchdogEvent,
    runTaskWatchdogCycle,
    runTaskWatchdogScheduler,
    sanitizeTelegramText,
    validateTaskWatchdogAutoRescheduleApproval
};
