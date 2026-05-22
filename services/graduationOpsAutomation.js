const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('GraduationOpsAutomation');

const SOURCE_ROSTER_MISSING = 'grad_roster_missing';
const SOURCE_PRINT_REMINDER = 'grad_print_reminder';
const SOURCE_CAPSULE_PREP = 'grad_capsule_prep';

const AUTOMATION_ROSTER = 'diploma_roster';
const AUTOMATION_PRINT = 'diploma_print_reminder';
const AUTOMATION_CAPSULE = 'capsule_prep';

const ACTIVE_TASK_SQL = "COALESCE(status, 'todo') NOT IN ('done','archived','cancelled')";
const LEADERSHIP_ROLES = ['creator', 'director', 'vice_director', 'senior_manager'];

function safeArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

function normalizeSelectedServices(value) {
    return safeArray(value)
        .map(item => {
            if (item && typeof item === 'object') {
                return {
                    ...item,
                    serviceId: item.serviceId ?? item.service_id ?? item.id ?? null,
                    name: item.name || item.serviceName || item.service_name || item.label || null,
                    sortOrder: item.sortOrder ?? item.sort_order ?? 0,
                    durationMin: item.durationMin ?? item.duration_min ?? item.duration ?? 0
                };
            }
            return { serviceId: item, name: null, sortOrder: 0, durationMin: 0 };
        })
        .filter(item => item.serviceId || item.name);
}

function serviceName(service = {}) {
    return String(service.name || service.serviceName || service.service_name || service.label || '').trim();
}

function hasDiplomaService(services = []) {
    return services.some(service => /диплом|diploma/i.test(serviceName(service)));
}

function hasCapsuleService(services = []) {
    return services.some(service => /капсул|capsule/i.test(serviceName(service)));
}

function isRosterReady(context = {}) {
    return Number(context.childrenCount || context.children_count || 0) > 0;
}

function addDays(dateText, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ''))) return null;
    const d = new Date(`${dateText}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function kyivOffsetMinutesAt(utcDate) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Europe/Kyiv',
            timeZoneName: 'shortOffset'
        }).formatToParts(utcDate);
        const token = parts.find(part => part.type === 'timeZoneName')?.value || 'GMT+2';
        const match = token.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
        if (!match) return 120;
        const sign = match[1] === '-' ? -1 : 1;
        const hours = parseInt(match[2], 10) || 0;
        const minutes = parseInt(match[3] || '0', 10) || 0;
        return sign * (hours * 60 + minutes);
    } catch {
        return 120;
    }
}

function makeKyivTimestamp(dateText, timeText = '10:00') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ''))) return null;
    const time = /^\d{2}:\d{2}$/.test(String(timeText || '')) ? timeText : '10:00';
    const [year, month, day] = dateText.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    const offset = kyivOffsetMinutesAt(approxUtc);
    return new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - offset * 60000).toISOString();
}

function computeReminderDate(eventDate) {
    return addDays(eventDate, -1);
}

function normalizeServiceTiming(value) {
    return safeArray(value).map(item => ({
        serviceId: item.serviceId ?? item.service_id ?? item.id ?? null,
        startTime: item.startTime || item.start_time || item.time || null,
        endTime: item.endTime || item.end_time || null,
        durationMin: item.durationMin ?? item.duration_min ?? item.duration ?? null
    }));
}

function timeTextToMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
}

function graduationSegmentKey(name, id, index) {
    const base = String(name || id || `segment-${index + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9а-яіїєґ]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return base || `segment-${index + 1}`;
}

function graduationSegmentColorToken(item = {}) {
    const name = String(item.name || item.title || '').toLowerCase();
    const kind = String(item.operationKind || item.operation_kind || '').toLowerCase();
    if (/welcome|вхід|зустр|велкам|welcome-zone/i.test(name) || kind === 'welcome') return 'welcome';
    if (/диплом|diploma/i.test(name) || kind === 'diploma') return 'diploma';
    if (/анім|animation|анімац/i.test(name) || kind === 'animation') return 'animation';
    if (/капсул|capsule/i.test(name) || kind === 'capsule_time') return 'capsule';
    if (/фото|photo/i.test(name)) return 'photo';
    if (/майстер|мк|workshop|master/i.test(name)) return 'workshop';
    return 'service';
}

function buildGraduationTimelineItems(services = [], serviceTiming = []) {
    const timingById = new Map(normalizeServiceTiming(serviceTiming)
        .filter(item => item.serviceId)
        .map(item => [String(item.serviceId), item]));
    return normalizeSelectedServices(services)
        .map((service, index) => {
            const id = service.serviceId ?? service.id ?? null;
            const timing = id ? timingById.get(String(id)) : null;
            const name = serviceName(service);
            return {
                id,
                name,
                sortOrder: Number(service.sortOrder ?? service.sort_order ?? index + 1) || index + 1,
                durationMin: Number(timing?.durationMin ?? service.durationMin ?? service.duration_min ?? service.duration ?? 0) || 0,
                startTime: timing?.startTime || null,
                endTime: timing?.endTime || null,
                timelineVisible: service.timelineVisible ?? service.timeline_visible ?? true,
                operationKind: service.operationKind || service.operation_kind || (
                    /диплом|diploma/i.test(name) ? 'diploma' : (/капсул|capsule/i.test(name) ? 'capsule_time' : 'service')
                )
            };
        })
        .filter(item => item.timelineVisible !== false)
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}

function buildGraduationSegments(services = [], serviceTiming = [], eventStartTime = null) {
    const baseMin = timeTextToMinutes(eventStartTime);
    let cursor = 0;
    return buildGraduationTimelineItems(services, serviceTiming)
        .map((item, index) => {
            const startMin = timeTextToMinutes(item.startTime);
            const endMin = timeTextToMinutes(item.endTime);
            let durationMin = Number(item.durationMin || 0) || 0;
            if (!durationMin && startMin !== null && endMin !== null) {
                durationMin = Math.max(0, endMin >= startMin ? endMin - startMin : (24 * 60 - startMin + endMin));
            }
            if (!durationMin) durationMin = 15;

            let startOffsetMin = cursor;
            if (baseMin !== null && startMin !== null) {
                const rawOffset = startMin >= baseMin ? startMin - baseMin : (24 * 60 - baseMin + startMin);
                startOffsetMin = Math.max(0, rawOffset);
            }
            cursor = Math.max(cursor, startOffsetMin + durationMin);

            const key = graduationSegmentKey(item.name, item.id, index);
            return {
                id: `seg_${item.id || index + 1}_${key}`.slice(0, 80),
                source: item.id ? 'package' : 'manual',
                key,
                serviceId: item.id || null,
                title: item.name || 'Складова випускного',
                startOffsetMin,
                durationMin,
                colorToken: graduationSegmentColorToken(item),
                lockedToPackage: false,
                notes: '',
                sortOrder: Number(item.sortOrder || index + 1) || index + 1,
                operationKind: item.operationKind || 'service',
                timelineVisible: item.timelineVisible !== false
            };
        })
        .filter(segment => segment.timelineVisible !== false)
        .sort((a, b) => Number(a.startOffsetMin || 0) - Number(b.startOffsetMin || 0));
}

async function buildGraduationSegmentsForQuote(query, quoteRow, serviceTimingOverride = null, eventStartTime = null) {
    const services = await hydrateSelectedServices(query, quoteRow.selected_services || [], quoteRow.package_id || null);
    const timing = serviceTimingOverride || quoteRow.service_timing || [];
    return buildGraduationSegments(services, timing, eventStartTime || quoteRow.event_start_time || null);
}

async function hydrateSelectedServices(query, selectedServices, packageId = null) {
    const normalized = normalizeSelectedServices(selectedServices);
    let ids = normalized.map(item => parseInt(item.serviceId, 10)).filter(Number.isInteger);
    if (!ids.length && packageId) {
        const packageRows = await query.query(
            `SELECT s.*
             FROM graduation_package_items pi
             JOIN graduation_services s ON s.id = pi.service_id
             WHERE pi.package_id = $1
             ORDER BY s.sort_order`,
            [packageId]
        );
        return packageRows.rows.map(row => ({
            serviceId: row.id,
            name: row.name,
            sortOrder: row.sort_order,
            durationMin: row.duration_min,
            category: row.category,
            timelineVisible: row.timeline_visible !== false,
            operationKind: row.operation_kind || null
        }));
    }

    if (!ids.length) return normalized;
    ids = [...new Set(ids)];
    const details = await query.query(
        `SELECT id, name, sort_order, duration_min, category, timeline_visible, operation_kind
         FROM graduation_services
         WHERE id = ANY($1::int[])`,
        [ids]
    );
    const detailById = new Map(details.rows.map(row => [String(row.id), row]));
    return normalized.map(item => {
        const row = detailById.get(String(item.serviceId));
        if (!row) return item;
        return {
            ...item,
            serviceId: row.id,
            name: row.name,
            sortOrder: row.sort_order,
            durationMin: row.duration_min,
            category: row.category,
            timelineVisible: row.timeline_visible !== false,
            operationKind: row.operation_kind || null
        };
    });
}

async function buildGraduationTimelineItemsForQuote(query, quoteRow, serviceTimingOverride = null) {
    const services = await hydrateSelectedServices(query, quoteRow.selected_services || [], quoteRow.package_id || null);
    const timing = serviceTimingOverride || quoteRow.service_timing || [];
    return buildGraduationTimelineItems(services, timing);
}

async function loadQuoteContext(query, quoteId) {
    const quoteResult = await query.query(
        `SELECT q.*, p.name AS child_pack_name, p.diploma_context_text, p.wording_mode,
                b.date AS booking_date, b.time AS booking_time, b.created_by AS booking_created_by,
                COUNT(c.id)::int AS children_count
         FROM graduation_quotes q
         LEFT JOIN graduation_child_packs p ON p.id = q.child_pack_id
         LEFT JOIN bookings b ON b.id = q.booking_id
         LEFT JOIN graduation_children c ON c.graduation_quote_id = q.id OR (q.child_pack_id IS NOT NULL AND c.child_pack_id = q.child_pack_id)
         WHERE q.id = $1
         GROUP BY q.id, p.id, b.id`,
        [quoteId]
    );
    const quote = quoteResult.rows[0];
    if (!quote) return null;
    const services = await hydrateSelectedServices(query, quote.selected_services || [], quote.package_id || null);
    return {
        quote,
        services,
        childrenCount: Number(quote.children_count || 0),
        eventDate: quote.booking_date || (quote.event_date ? String(quote.event_date).slice(0, 10) : null),
        eventTime: quote.booking_time || quote.event_start_time || '10:00',
        bookingId: quote.booking_id || null,
        managerUsername: quote.created_by || quote.booking_created_by || null
    };
}

async function resolveUserByUsername(query, username) {
    const raw = String(username || '').trim();
    if (!raw) return null;
    const result = await query.query(
        `SELECT id, username, name, role
         FROM users
         WHERE COALESCE(is_active, true) = true
           AND (username = $1 OR name = $1)
         ORDER BY id
         LIMIT 1`,
        [raw]
    );
    return result.rows[0] || null;
}

async function resolveFirstUserByRoles(query, roles) {
    const result = await query.query(
        `SELECT id, username, name, role
         FROM users
         WHERE COALESCE(is_active, true) = true
           AND role = ANY($1::text[])
         ORDER BY CASE role
            WHEN 'creator' THEN 0
            WHEN 'director' THEN 1
            WHEN 'vice_director' THEN 2
            WHEN 'senior_manager' THEN 3
            WHEN 'art_director' THEN 4
            ELSE 9 END,
            id
         LIMIT 1`,
        [roles]
    );
    return result.rows[0] || null;
}

async function leadershipObserverIds(query, ownerUserId = null) {
    const result = await query.query(
        `SELECT DISTINCT u.id
         FROM users u
         WHERE COALESCE(u.is_active, true) = true
           AND u.role = ANY($1::text[])
           AND ($2::int IS NULL OR u.id <> $2::int)
         ORDER BY u.id`,
        [LEADERSHIP_ROLES, ownerUserId || null]
    );
    return result.rows.map(row => row.id).filter(Boolean);
}

async function ensureTaskObservers(query, taskId, observerIds = [], actorUserId = null) {
    const uniqueIds = [...new Set(observerIds.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0))];
    for (const userId of uniqueIds) {
        await query.query(
            `INSERT INTO task_observers (task_id, user_id, access_level, added_by)
             VALUES ($1, $2, 'watch', $3)
             ON CONFLICT (task_id, user_id) DO UPDATE
             SET access_level = CASE
                    WHEN task_observers.access_level = 'full' THEN 'full'
                    WHEN task_observers.access_level = 'materials' THEN 'materials'
                    ELSE EXCLUDED.access_level
                 END,
                 added_by = COALESCE(task_observers.added_by, EXCLUDED.added_by)`,
            [taskId, userId, actorUserId || null]
        );
    }
}

async function findAutomationTask(query, sourceType, quoteId) {
    const result = await query.query(
        `SELECT *
         FROM tasks
         WHERE source_type = $1 AND source_id = $2
         ORDER BY CASE WHEN ${ACTIVE_TASK_SQL} THEN 0 ELSE 1 END, id DESC
         LIMIT 1`,
        [sourceType, String(quoteId)]
    );
    return result.rows[0] || null;
}

async function upsertAutomationState(query, quoteId, key, patch = {}) {
    const payload = patch.payload || {};
    const result = await query.query(
        `INSERT INTO graduation_automation_state (
            graduation_quote_id, booking_id, automation_key, state, task_id, scheduled_for,
            artifact_url, not_ready_reason, payload, last_notified_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
         ON CONFLICT (graduation_quote_id, automation_key) DO UPDATE
         SET booking_id = EXCLUDED.booking_id,
             state = EXCLUDED.state,
             task_id = EXCLUDED.task_id,
             scheduled_for = EXCLUDED.scheduled_for,
             artifact_url = EXCLUDED.artifact_url,
             not_ready_reason = EXCLUDED.not_ready_reason,
             payload = EXCLUDED.payload,
             last_notified_at = CASE
                WHEN EXCLUDED.last_notified_at IS NOT NULL THEN EXCLUDED.last_notified_at
                WHEN graduation_automation_state.scheduled_for IS DISTINCT FROM EXCLUDED.scheduled_for
                  OR graduation_automation_state.state = 'cancelled'
                THEN EXCLUDED.last_notified_at
                ELSE graduation_automation_state.last_notified_at
             END,
             updated_at = NOW()
         RETURNING *`,
        [
            quoteId,
            patch.bookingId || null,
            key,
            patch.state || 'active',
            patch.taskId || null,
            patch.scheduledFor || null,
            patch.artifactUrl || null,
            patch.notReadyReason || null,
            JSON.stringify(payload),
            patch.lastNotifiedAt || null
        ]
    );
    return result.rows[0];
}

function taskDateFromTimestamp(iso) {
    return iso ? String(iso).slice(0, 10) : null;
}

async function upsertControlledTask(query, sourceType, quoteId, data = {}) {
    const existing = await findAutomationTask(query, sourceType, quoteId);
    const controlMeta = {
        ...(data.controlMeta || {}),
        automationSource: sourceType,
        graduationQuoteId: quoteId,
        bookingId: data.bookingId || null,
        lifecycle: data.lifecycle || 'active'
    };
    const assignedTo = data.assignedTo || data.owner?.name || data.owner?.username || null;
    const ownerUserId = data.ownerUserId || data.owner?.id || null;
    const params = [
        data.title,
        data.description || null,
        data.date || null,
        data.priority || 'normal',
        assignedTo,
        assignedTo,
        ownerUserId,
        data.deadline || null,
        data.sourceEntityType || null,
        data.sourceEntityId || null,
        data.ownerRole || null,
        data.taskKind || 'action',
        data.workflowState || 'todo',
        data.remindAt || null,
        data.nextNotificationAt || null,
        data.relatedEntityType || 'graduation_quote',
        String(quoteId),
        data.sourceModule || 'graduation',
        data.controlMode || 'normal',
        data.criticalReason || null,
        JSON.stringify(controlMeta),
        data.packStatus || null
    ];

    if (existing) {
        const result = await query.query(
            `UPDATE tasks
             SET title = $1,
                 description = $2,
                 date = $3,
                 priority = $4,
                 assigned_to = $5,
                 owner = $6,
                 owner_user_id = $7,
                 deadline = $8,
                 source_entity_type = $9,
                 source_entity_id = $10,
                 owner_role = $11,
                 task_kind = $12,
                 workflow_state = CASE WHEN status IN ('done','archived','cancelled') THEN $13 ELSE COALESCE(NULLIF(workflow_state, 'done'), $13) END,
                 status = CASE WHEN status IN ('done','archived','cancelled') THEN 'todo' ELSE status END,
                 completed_at = CASE WHEN status IN ('done','archived','cancelled') THEN NULL ELSE completed_at END,
                 remind_at = $14,
                 next_notification_at = $15,
                 related_entity_type = $16,
                 related_entity_id = $17,
                 source_module = $18,
                 control_mode = $19,
                 critical_reason = $20,
                 control_meta = $21::jsonb,
                 pack_status = $22,
                 visibility = 'team',
                 task_mode = 'work',
                 task_type = 'human',
                 updated_at = NOW(),
                 archived_at = NULL,
                 archive_reason = NULL
             WHERE id = $23
             RETURNING *`,
            [...params, existing.id]
        );
        return result.rows[0];
    }

    const result = await query.query(
        `INSERT INTO tasks (
            title, description, date, priority, assigned_to, owner, owner_user_id, created_by,
            task_type, deadline, dependency_ids, control_policy, source_type, source_id,
            category, source_entity_type, source_entity_id, owner_role, type, task_mode,
            task_kind, visibility, workflow_state, remind_at, next_notification_at,
            related_entity_type, related_entity_id, source_module, control_mode, critical_reason,
            control_meta, pack_status
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,'graduation-ops',
            'human',$8,'{}',$9::jsonb,$10,$11,
            $12,$13,$14,$15,'auto','work',
            $16,'team',$17,$18,$19,
            $20,$21,$22,$23,$24,
            $25::jsonb,$26)
         RETURNING *`,
        [
            data.title,
            data.description || null,
            data.date || null,
            data.priority || 'normal',
            assignedTo,
            assignedTo,
            ownerUserId,
            data.deadline || null,
            JSON.stringify(data.controlPolicy || { reminder_minutes: [1440, 240, 60], escalation_after_minutes: 240 }),
            sourceType,
            String(quoteId),
            data.category || 'event',
            data.sourceEntityType || null,
            data.sourceEntityId || null,
            data.ownerRole || null,
            data.taskKind || 'action',
            data.workflowState || 'todo',
            data.remindAt || null,
            data.nextNotificationAt || null,
            data.relatedEntityType || 'graduation_quote',
            String(quoteId),
            data.sourceModule || 'graduation',
            data.controlMode || 'normal',
            data.criticalReason || null,
            JSON.stringify(controlMeta),
            data.packStatus || null
        ]
    );
    return result.rows[0];
}

async function completeAutomationTask(query, sourceType, quoteId, reason, packStatus = 'ready') {
    const existing = await findAutomationTask(query, sourceType, quoteId);
    if (!existing) return null;
    const result = await query.query(
        `UPDATE tasks
         SET status = 'done',
             workflow_state = 'done',
             completed_at = COALESCE(completed_at, NOW()),
             pack_status = COALESCE($3, pack_status),
             control_meta = COALESCE(control_meta, '{}'::jsonb) || jsonb_build_object('resolvedReason', $4::text, 'resolvedAt', NOW()),
             updated_at = NOW()
         WHERE source_type = $1
           AND source_id = $2
           AND ${ACTIVE_TASK_SQL}
         RETURNING *`,
        [sourceType, String(quoteId), packStatus || null, reason || 'resolved']
    );
    return result.rows[0] || existing;
}

async function cancelAutomationTask(query, sourceType, quoteId, reason) {
    const result = await query.query(
        `UPDATE tasks
         SET status = 'done',
             workflow_state = 'archived',
             completed_at = COALESCE(completed_at, NOW()),
             archived_at = COALESCE(archived_at, NOW()),
             archive_reason = $3,
             control_meta = COALESCE(control_meta, '{}'::jsonb) || jsonb_build_object('cancelReason', $3::text, 'cancelledAt', NOW()),
             updated_at = NOW()
         WHERE source_type = $1
           AND source_id = $2
           AND ${ACTIVE_TASK_SQL}
         RETURNING *`,
        [sourceType, String(quoteId), reason || 'automation no longer applies']
    );
    return result.rows[0] || null;
}

function quoteLabel(context) {
    return context.quote.quote_number || `#${context.quote.id}`;
}

function eventLabel(context) {
    const date = context.eventDate || 'дату ще не вказано';
    const time = context.eventTime || 'час ще не вказано';
    return `${date} ${time}`;
}

function sourceEntity(context) {
    return context.bookingId
        ? { sourceEntityType: 'booking', sourceEntityId: context.bookingId }
        : { sourceEntityType: null, sourceEntityId: null };
}

async function ensureMissingRosterTask(query, context, actor = {}) {
    const manager = await resolveUserByUsername(query, context.managerUsername);
    const source = sourceEntity(context);
    const task = await upsertControlledTask(query, SOURCE_ROSTER_MISSING, context.quote.id, {
        title: `Внести список дітей для дипломів ${quoteLabel(context)}`,
        description: [
            `У випускному ${quoteLabel(context)} є дипломи, але список дітей ще не заповнений.`,
            `Подія: ${eventLabel(context)}.`,
            'Потрібно внести або привʼязати список дітей, щоб PDF дипломів був готовий до друку.'
        ].join('\n'),
        date: context.eventDate || null,
        deadline: context.eventDate ? makeKyivTimestamp(context.eventDate, context.eventTime || '10:00') : null,
        priority: 'high',
        owner: manager,
        ownerUserId: manager?.id || null,
        assignedTo: manager?.name || manager?.username || context.managerUsername || 'Менеджер',
        ownerRole: 'manager',
        taskKind: 'checklist',
        workflowState: 'todo',
        category: 'event',
        controlMode: 'special_control',
        criticalReason: 'graduation_diploma_roster_missing',
        packStatus: 'draft',
        controlMeta: {
            reason: 'graduation_diploma_roster_missing',
            rosterReady: false,
            childrenCount: context.childrenCount,
            printArtifactUrl: `/api/graduation/quotes/${context.quote.id}/diplomas/export/pdf`
        },
        ...source
    });
    const observers = await leadershipObserverIds(query, task.owner_user_id || null);
    await ensureTaskObservers(query, task.id, observers, actor?.id || actor?.userId || null);
    await upsertAutomationState(query, context.quote.id, AUTOMATION_ROSTER, {
        bookingId: context.bookingId,
        state: 'active',
        taskId: task.id,
        notReadyReason: 'missing_roster',
        payload: { childrenCount: context.childrenCount, specialControl: true }
    });
    return task;
}

async function ensurePrintReminderTask(query, context, rosterReady, actor = {}) {
    const artDirector = await resolveFirstUserByRoles(query, ['art_director']);
    const reminderDate = computeReminderDate(context.eventDate);
    const reminderAt = reminderDate ? makeKyivTimestamp(reminderDate, '10:00') : null;
    const artifactUrl = `/api/graduation/quotes/${context.quote.id}/diplomas/export/pdf`;
    const readinessLine = rosterReady
        ? `PDF для друку: ${artifactUrl}`
        : 'PDF ще не готовий: бракує заповненого списку дітей.';
    const source = sourceEntity(context);
    const task = await upsertControlledTask(query, SOURCE_PRINT_REMINDER, context.quote.id, {
        title: `Друк дипломів для випускного ${quoteLabel(context)}`,
        description: [
            `За день до випускного потрібно перевірити та роздрукувати дипломи.`,
            `Подія: ${eventLabel(context)}.`,
            readinessLine
        ].join('\n'),
        date: reminderDate || context.eventDate || null,
        deadline: reminderAt,
        remindAt: reminderAt,
        nextNotificationAt: reminderAt,
        priority: rosterReady ? 'normal' : 'high',
        owner: artDirector,
        ownerUserId: artDirector?.id || null,
        assignedTo: artDirector?.name || artDirector?.username || 'Арт-директор',
        ownerRole: 'art_director',
        taskKind: 'reminder',
        workflowState: reminderDate ? 'scheduled' : 'todo',
        category: 'event',
        controlMode: rosterReady ? 'normal' : 'special_control',
        criticalReason: rosterReady ? null : 'graduation_diploma_print_not_ready',
        packStatus: rosterReady ? 'ready' : 'draft',
        controlMeta: {
            reason: 'graduation_diploma_print_reminder',
            rosterReady,
            childrenCount: context.childrenCount,
            artifactUrl,
            reminderDate
        },
        ...source
    });
    if (!rosterReady) {
        const observers = await leadershipObserverIds(query, task.owner_user_id || null);
        await ensureTaskObservers(query, task.id, observers, actor?.id || actor?.userId || null);
    }
    await upsertAutomationState(query, context.quote.id, AUTOMATION_PRINT, {
        bookingId: context.bookingId,
        state: reminderAt ? 'scheduled' : 'blocked',
        taskId: task.id,
        scheduledFor: reminderAt,
        artifactUrl: rosterReady ? artifactUrl : null,
        notReadyReason: rosterReady ? null : 'missing_roster',
        payload: { childrenCount: context.childrenCount, rosterReady, reminderDate }
    });
    return task;
}

async function ensureCapsulePrepTask(query, context, actor = {}) {
    const manager = await resolveUserByUsername(query, context.managerUsername);
    const source = sourceEntity(context);
    const deadlineDate = context.eventDate ? addDays(context.eventDate, -3) || context.eventDate : null;
    const deadlineAt = deadlineDate ? makeKyivTimestamp(deadlineDate, '12:00') : null;
    const task = await upsertControlledTask(query, SOURCE_CAPSULE_PREP, context.quote.id, {
        title: `Підготувати капсулу часу ${quoteLabel(context)}`,
        description: [
            `У випускному ${quoteLabel(context)} обрана "Капсула часу".`,
            `Подія: ${eventLabel(context)}.`,
            'Поточний fallback: внутрішня підготовка/замовлення реквізиту. Майбутній contractor-bot має підписатися на подію graduation_capsule_requested.'
        ].join('\n'),
        date: deadlineDate || context.eventDate || null,
        deadline: deadlineAt,
        priority: 'high',
        owner: manager,
        ownerUserId: manager?.id || null,
        assignedTo: manager?.name || manager?.username || context.managerUsername || 'Менеджер',
        ownerRole: 'manager',
        taskKind: 'action',
        workflowState: deadlineDate ? 'scheduled' : 'todo',
        category: 'purchase',
        controlMode: 'normal',
        packStatus: 'confirmed',
        controlMeta: {
            reason: 'graduation_capsule_requested',
            futureAdapterEvent: 'graduation_capsule_requested',
            vendorBotReady: false
        },
        ...source
    });
    await upsertAutomationState(query, context.quote.id, AUTOMATION_CAPSULE, {
        bookingId: context.bookingId,
        state: 'active',
        taskId: task.id,
        scheduledFor: deadlineAt,
        payload: { futureAdapterEvent: 'graduation_capsule_requested', vendorBotReady: false }
    });
    return task;
}

async function syncGraduationOpsForQuote(quoteId, options = {}) {
    const query = options.query || pool;
    const actor = options.actor || {};
    const context = await loadQuoteContext(query, quoteId);
    if (!context) return { success: false, reason: 'quote_not_found', quoteId };

    if (String(context.quote.status || '').toLowerCase() === 'cancelled') {
        const closedRoster = await cancelAutomationTask(query, SOURCE_ROSTER_MISSING, context.quote.id, 'graduation quote cancelled');
        const closedPrint = await cancelAutomationTask(query, SOURCE_PRINT_REMINDER, context.quote.id, 'graduation quote cancelled');
        const closedCapsule = await cancelAutomationTask(query, SOURCE_CAPSULE_PREP, context.quote.id, 'graduation quote cancelled');
        await upsertAutomationState(query, context.quote.id, AUTOMATION_ROSTER, {
            bookingId: context.bookingId,
            state: 'cancelled',
            taskId: closedRoster?.id || null,
            payload: { cancelled: true }
        });
        await upsertAutomationState(query, context.quote.id, AUTOMATION_PRINT, {
            bookingId: context.bookingId,
            state: 'cancelled',
            taskId: closedPrint?.id || null,
            payload: { cancelled: true }
        });
        await upsertAutomationState(query, context.quote.id, AUTOMATION_CAPSULE, {
            bookingId: context.bookingId,
            state: 'cancelled',
            taskId: closedCapsule?.id || null,
            payload: { cancelled: true }
        });
        return { success: true, quoteId: context.quote.id, readiness: { cancelled: true } };
    }

    const diplomaPresent = hasDiplomaService(context.services);
    const capsulePresent = hasCapsuleService(context.services);
    const rosterReady = isRosterReady(context);
    const tasks = {};

    if (diplomaPresent && !rosterReady) {
        tasks.missingRoster = await ensureMissingRosterTask(query, context, actor);
    } else {
        const closed = await completeAutomationTask(query, SOURCE_ROSTER_MISSING, context.quote.id, rosterReady ? 'roster_ready' : 'diploma_removed', rosterReady ? 'ready' : 'cancelled');
        await upsertAutomationState(query, context.quote.id, AUTOMATION_ROSTER, {
            bookingId: context.bookingId,
            state: diplomaPresent ? 'satisfied' : 'cancelled',
            taskId: closed?.id || null,
            payload: { childrenCount: context.childrenCount, rosterReady, diplomaPresent }
        });
    }

    if (diplomaPresent) {
        tasks.printReminder = await ensurePrintReminderTask(query, context, rosterReady, actor);
    } else {
        const cancelled = await cancelAutomationTask(query, SOURCE_PRINT_REMINDER, context.quote.id, 'diploma service removed');
        await upsertAutomationState(query, context.quote.id, AUTOMATION_PRINT, {
            bookingId: context.bookingId,
            state: 'cancelled',
            taskId: cancelled?.id || null,
            payload: { diplomaPresent: false }
        });
    }

    if (capsulePresent) {
        tasks.capsulePrep = await ensureCapsulePrepTask(query, context, actor);
    } else {
        const cancelled = await cancelAutomationTask(query, SOURCE_CAPSULE_PREP, context.quote.id, 'capsule service removed');
        await upsertAutomationState(query, context.quote.id, AUTOMATION_CAPSULE, {
            bookingId: context.bookingId,
            state: 'cancelled',
            taskId: cancelled?.id || null,
            payload: { capsulePresent: false }
        });
    }

    return {
        success: true,
        quoteId: context.quote.id,
        bookingId: context.bookingId,
        readiness: {
            diplomaPresent,
            capsulePresent,
            rosterReady,
            childrenCount: context.childrenCount,
            eventDate: context.eventDate
        },
        tasks
    };
}

async function syncGraduationOpsForUpcoming(options = {}) {
    const query = options.query || pool;
    const limit = Math.max(1, Math.min(Number(options.limit || 200), 500));
    const result = await query.query(
        `SELECT id
         FROM graduation_quotes
         WHERE COALESCE(status, 'draft') NOT IN ('cancelled')
           AND (
                event_date IS NULL
                OR event_date >= CURRENT_DATE - INTERVAL '2 days'
                OR booking_id IS NOT NULL
           )
         ORDER BY updated_at DESC, id DESC
         LIMIT $1`,
        [limit]
    );
    const synced = [];
    for (const row of result.rows) {
        try {
            synced.push(await syncGraduationOpsForQuote(row.id, options));
        } catch (err) {
            log.warn(`Graduation ops sync skipped for quote ${row.id}: ${err.message}`);
            synced.push({ success: false, quoteId: row.id, error: err.message });
        }
    }
    let reminders = null;
    if (options.dispatchDuePrintReminders) {
        reminders = await dispatchDuePrintReminders(options);
    }
    return { success: true, scanned: result.rows.length, synced, reminders };
}

async function dispatchDuePrintReminders(options = {}) {
    const query = options.query || pool;
    const todayResult = await query.query("SELECT (NOW() AT TIME ZONE 'Europe/Kyiv')::date::text AS today");
    const today = todayResult.rows[0]?.today;
    const due = await query.query(
        `SELECT s.*, q.quote_number, q.id AS quote_id
         FROM graduation_automation_state s
         JOIN graduation_quotes q ON q.id = s.graduation_quote_id
         WHERE s.automation_key = $1
           AND s.state IN ('scheduled','blocked')
           AND s.scheduled_for IS NOT NULL
           AND DATE(s.scheduled_for AT TIME ZONE 'Europe/Kyiv') <= $2::date
           AND s.last_notified_at IS NULL
         ORDER BY s.scheduled_for ASC
         LIMIT 50`,
        [AUTOMATION_PRINT, today]
    );
    if (!due.rows.length) return { sent: 0, blocked: 0 };

    let sent = 0;
    let blocked = 0;
    const { sendTelegramMessage, getConfiguredChatId } = require('./telegram');
    for (const row of due.rows) {
        const context = await loadQuoteContext(query, row.graduation_quote_id);
        if (!context) continue;
        const rosterReady = isRosterReady(context);
        const artDirector = await resolveFirstUserByRoles(query, ['art_director']);
        let chatId = null;
        if (artDirector?.id) {
            const tg = await query.query(
                `SELECT telegram_chat_id
                 FROM employee_profiles
                 WHERE user_id = $1 AND telegram_chat_id IS NOT NULL AND is_active = true
                 LIMIT 1`,
                [artDirector.id]
            );
            chatId = tg.rows[0]?.telegram_chat_id || null;
        }
        if (!chatId) chatId = await getConfiguredChatId();
        if (!chatId) {
            await upsertAutomationState(query, context.quote.id, AUTOMATION_PRINT, {
                bookingId: context.bookingId,
                state: 'blocked',
                taskId: row.task_id || null,
                scheduledFor: row.scheduled_for,
                artifactUrl: row.artifact_url || null,
                notReadyReason: 'no_telegram_recipient',
                payload: { ...row.payload, dispatchBlocked: 'no_telegram_recipient' }
            });
            blocked += 1;
            continue;
        }
        const artifactUrl = `/api/graduation/quotes/${context.quote.id}/diplomas/export/pdf`;
        const text = [
            `<b>Дипломи до друку: ${quoteLabel(context)}</b>`,
            `Подія: ${eventLabel(context)}`,
            rosterReady
                ? `PDF: ${artifactUrl}`
                : 'Блокер: список дітей ще не заповнений, PDF не готовий.'
        ].join('\n');
        await sendTelegramMessage(chatId, text, { silent: false });
        await upsertAutomationState(query, context.quote.id, AUTOMATION_PRINT, {
            bookingId: context.bookingId,
            state: rosterReady ? 'sent' : 'blocked',
            taskId: row.task_id || null,
            scheduledFor: row.scheduled_for,
            artifactUrl: rosterReady ? artifactUrl : null,
            notReadyReason: rosterReady ? null : 'missing_roster',
            lastNotifiedAt: new Date().toISOString(),
            payload: { ...row.payload, dispatchedTo: artDirector?.id ? 'art_director' : 'default_telegram', rosterReady }
        });
        sent += 1;
    }
    return { sent, blocked };
}

module.exports = {
    AUTOMATION_CAPSULE,
    AUTOMATION_PRINT,
    AUTOMATION_ROSTER,
    SOURCE_CAPSULE_PREP,
    SOURCE_PRINT_REMINDER,
    SOURCE_ROSTER_MISSING,
    buildGraduationTimelineItems,
    buildGraduationSegments,
    buildGraduationSegmentsForQuote,
    buildGraduationTimelineItemsForQuote,
    computeReminderDate,
    dispatchDuePrintReminders,
    hasCapsuleService,
    hasDiplomaService,
    isRosterReady,
    makeKyivTimestamp,
    normalizeSelectedServices,
    syncGraduationOpsForQuote,
    syncGraduationOpsForUpcoming
};
