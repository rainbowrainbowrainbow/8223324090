const { getPermissions } = require('../config/roles');
const { getKyivDateStr } = require('./booking');

const BUCKETS = [
    { key: 'overdue', label: 'Прострочено' },
    { key: 'today', label: 'Сьогодні' },
    { key: 'tomorrow', label: 'Завтра' },
    { key: 'callback_due', label: 'Передзвонити' },
    { key: 'waiting_reply', label: 'Очікуємо відповідь' },
    { key: 'needs_confirmation', label: 'Підтвердити' },
    { key: 'event_soon', label: 'Подія скоро' },
    { key: 'idle_lead', label: 'Лід холоне' }
];

const CLOSED_LEAD_STAGES = ['completed', 'closed', 'lost'];
const ACTIVE_TASK_STATUS_SQL = "COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')";
const PRIORITY_WEIGHT = { critical: 0, high: 1, normal: 2, medium: 2, low: 3 };

function addDays(dateStr, days) {
    const [year, month, day] = String(dateStr).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
}

function isoValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

function dateValue(value) {
    const raw = isoValue(value);
    return raw ? raw.slice(0, 10) : null;
}

function bookingDueAt(date, time) {
    const day = dateValue(date);
    if (!day) return null;
    const clock = String(time || '').match(/^(\d{2}):(\d{2})/)?.[0];
    return clock ? `${day}T${clock}:00` : day;
}

function priority(value, fallback = 'normal') {
    const raw = String(value || fallback).toLowerCase();
    if (raw === 'medium') return 'normal';
    return ['critical', 'high', 'normal', 'low'].includes(raw) ? raw : fallback;
}

function pushParam(params, value) {
    params.push(value);
    return `$${params.length}`;
}

function buildTaskVisibility(user, params, alias = 't') {
    const perms = getPermissions(user?.role);
    if (perms.taskVisibility === 'all') return '';

    const nameRef = pushParam(params, user?.name || user?.username || '');
    if (perms.taskVisibility === 'department') {
        const userIdRef = pushParam(params, user?.id || 0);
        return `AND (
            ${alias}.assigned_to = ${nameRef}
            OR ${alias}.owner = ${nameRef}
            OR ${alias}.assigned_to IN (
                SELECT u.name
                FROM users u
                JOIN employee_profiles ep ON ep.user_id = u.id
                WHERE ep.department IS NOT NULL
                  AND ep.department = (
                    SELECT ep2.department
                    FROM employee_profiles ep2
                    WHERE ep2.user_id = ${userIdRef}
                    LIMIT 1
                  )
            )
            OR ${alias}.owner IN (
                SELECT u.name
                FROM users u
                JOIN employee_profiles ep ON ep.user_id = u.id
                WHERE ep.department IS NOT NULL
                  AND ep.department = (
                    SELECT ep2.department
                    FROM employee_profiles ep2
                    WHERE ep2.user_id = ${userIdRef}
                    LIMIT 1
                  )
            )
        )`;
    }

    return `AND (${alias}.assigned_to = ${nameRef} OR ${alias}.owner = ${nameRef})`;
}

function hrefForTask(row) {
    const sourceType = row.task_source_type || row.source_type;
    const sourceId = row.task_source_id || row.source_id;
    const leadId = row.linked_lead_id || (sourceType === 'lead' && /^\d+$/.test(String(sourceId || '')) ? Number(sourceId) : null);
    const bookingId = row.linked_booking_id || (sourceType === 'booking' ? sourceId : null);
    const bookingDate = row.linked_booking_date || row.booking_date;

    if (leadId) return `/sales-funnel?lead=${encodeURIComponent(leadId)}`;
    if (bookingId && bookingDate) {
        return `/?date=${encodeURIComponent(dateValue(bookingDate))}&highlight=${encodeURIComponent(bookingId)}`;
    }
    return `/tasks?open=${encodeURIComponent(row.id)}`;
}

function taskItem(row, bucket, options = {}) {
    const sourceType = row.task_source_type || row.source_type || null;
    const sourceId = row.task_source_id || row.source_id || null;
    const leadId = row.linked_lead_id || (sourceType === 'lead' && /^\d+$/.test(String(sourceId || '')) ? Number(sourceId) : null);
    const bookingId = row.linked_booking_id || (sourceType === 'booking' ? sourceId : null);
    const dueAt = isoValue(row.deadline) || dateValue(row.date);
    const hasExactCase = Boolean(leadId || bookingId);

    return {
        id: `task:${bucket}:${row.id}`,
        bucket,
        sourceType: 'task',
        sourceId: String(row.id),
        taskId: row.id,
        leadId: leadId || null,
        customerId: row.linked_customer_id || null,
        bookingId: bookingId || null,
        title: row.title || 'Задача',
        subtitle: row.description || null,
        dueAt,
        priority: priority(row.priority),
        confidence: hasExactCase ? 'exact' : (row.deadline ? 'durable' : 'suggested'),
        actionLabel: hasExactCase ? 'Відкрити кейс' : 'Відкрити задачу',
        href: hrefForTask(row),
        meta: {
            status: row.status || null,
            category: row.category || null,
            assignedTo: row.assigned_to || row.owner || null,
            taskSourceType: sourceType,
            taskSourceId: sourceId,
            signal: options.signal || (row.deadline ? 'deadline' : 'date')
        }
    };
}

function leadHref(id) {
    return `/sales-funnel?lead=${encodeURIComponent(id)}`;
}

function leadTitle(row) {
    return row.client_name || row.customer_name || row.name || `Лід #${row.id || row.lead_id}`;
}

function leadItem(row, bucket, options = {}) {
    const leadId = row.lead_id || row.id;
    return {
        id: `${bucket}:lead:${leadId}:${row.source_id || row.interaction_id || row.id}`,
        bucket,
        sourceType: options.sourceType || 'lead',
        sourceId: String(row.source_id || row.interaction_id || leadId),
        taskId: null,
        leadId,
        customerId: row.customer_id || null,
        bookingId: row.booking_id || null,
        title: options.title || leadTitle(row),
        subtitle: options.subtitle || row.summary || row.details || row.phone || null,
        dueAt: isoValue(row.due_at || row.follow_up_date || row.event_date || row.last_contact_at || row.created_at),
        priority: options.priority || 'normal',
        confidence: options.confidence || 'durable',
        actionLabel: 'Відкрити кейс',
        href: leadHref(leadId),
        meta: {
            pipelineStage: row.pipeline_stage || null,
            assignedTo: row.assigned_name || row.assigned_to || null,
            signal: options.signal || bucket
        }
    };
}

function conversationTitle(row) {
    return row.customer_name || row.customer_phone || `Conversation #${row.conversation_id}`;
}

function conversationItem(row, bucket = 'waiting_reply') {
    const dueAt = isoValue(row.due_at || row.reply_sla_at || row.awaiting_reply_since);
    return {
        id: `${bucket}:conversation:${row.conversation_id}`,
        bucket,
        sourceType: 'conversation',
        sourceId: String(row.conversation_id),
        taskId: null,
        leadId: row.lead_id || null,
        customerId: row.customer_id || null,
        bookingId: null,
        title: `Очікуємо відповідь: ${conversationTitle(row)}`,
        subtitle: [row.channel, row.customer_phone].filter(Boolean).join(' · ') || null,
        dueAt,
        priority: row.reply_sla_at && new Date(row.reply_sla_at).getTime() < Date.now() ? 'high' : 'normal',
        confidence: 'exact',
        actionLabel: 'Відкрити чат',
        href: `/omni?conversation=${encodeURIComponent(row.conversation_id)}`,
        meta: {
            assignedTo: row.reply_owner || row.assigned_to || null,
            signal: 'conversations.reply_expected',
            awaitingReplySince: isoValue(row.awaiting_reply_since),
            replySlaAt: isoValue(row.reply_sla_at),
            replyExpectedMessageId: row.reply_expected_message_id || null,
            deliveryStatus: row.delivery_status || null,
        }
    };
}

function bookingItem(row, bucket, options = {}) {
    const dueAt = bookingDueAt(row.date, row.time);
    return {
        id: `booking:${bucket}:${row.id}`,
        bucket,
        sourceType: 'booking',
        sourceId: String(row.id),
        taskId: null,
        leadId: row.lead_id || null,
        customerId: row.customer_id || null,
        bookingId: row.id,
        title: row.label || row.group_name || row.customer_name || `Бронювання ${row.id}`,
        subtitle: [row.program_name, row.room, row.time ? String(row.time).slice(0, 5) : null].filter(Boolean).join(' · ') || null,
        dueAt,
        priority: options.priority || (dateValue(row.date) === options.today ? 'high' : 'normal'),
        confidence: 'exact',
        actionLabel: options.actionLabel || 'Відкрити таймлайн',
        href: `/?date=${encodeURIComponent(dateValue(row.date))}&highlight=${encodeURIComponent(row.id)}`,
        meta: {
            status: row.status || null,
            signal: options.signal || bucket
        }
    };
}

async function source(pool, warnings, name, fn) {
    try {
        return await fn();
    } catch (err) {
        warnings.push({ source: name, error: err.message });
        return [];
    }
}

async function loadTaskBucket(pool, user, bucket, whereSql, whereParams, limit, signal) {
    const params = [...whereParams];
    const visibility = buildTaskVisibility(user, params, 't');
    const limitRef = pushParam(params, limit);
    const query = `
        SELECT t.id, t.title, t.description, t.status, t.priority, t.deadline, t.date,
               t.category, t.assigned_to, t.owner, t.source_type AS task_source_type,
               t.source_id AS task_source_id, t.created_at,
               sl.id AS linked_lead_id,
               sb.id AS linked_booking_id, sb.date AS linked_booking_date,
               sb.customer_id AS linked_customer_id
        FROM tasks t
        LEFT JOIN leads sl ON t.source_type = 'lead' AND t.source_id = sl.id::text
        LEFT JOIN bookings sb ON t.source_type = 'booking' AND t.source_id = sb.id::text
        WHERE ${ACTIVE_TASK_STATUS_SQL}
          ${visibility}
          AND (${whereSql})
        ORDER BY
          CASE WHEN t.deadline IS NOT NULL THEN t.deadline ELSE NULL END ASC NULLS LAST,
          LEFT(COALESCE(t.date, ''), 10) ASC NULLS LAST,
          CASE COALESCE(t.priority, 'normal') WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
          t.created_at DESC
        LIMIT ${limitRef}
    `;
    const result = await pool.query(query, params);
    return result.rows.map(row => taskItem(row, bucket, { signal }));
}

function compareItems(a, b) {
    const aTime = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const safeATime = Number.isNaN(aTime) ? Number.MAX_SAFE_INTEGER : aTime;
    const safeBTime = Number.isNaN(bTime) ? Number.MAX_SAFE_INTEGER : bTime;
    if (safeATime !== safeBTime) return safeATime - safeBTime;
    return (PRIORITY_WEIGHT[a.priority] ?? 9) - (PRIORITY_WEIGHT[b.priority] ?? 9);
}

function makeBucketMap() {
    return BUCKETS.reduce((acc, bucket) => {
        acc[bucket.key] = { ...bucket, count: 0, items: [] };
        return acc;
    }, {});
}

async function buildWorkQueue({ pool, user, limit = 8, today = null } = {}) {
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('pool with query() is required');
    }
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 8, 20));
    const todayStr = today || getKyivDateStr();
    const tomorrowStr = addDays(todayStr, 1);
    const eventSoonStr = addDays(todayStr, 7);
    const warnings = [];
    const bucketMap = makeBucketMap();

    const overdue = await source(pool, warnings, 'tasks_overdue', () => loadTaskBucket(
        pool,
        user,
        'overdue',
        "(t.deadline IS NOT NULL AND t.deadline < NOW()) OR (t.deadline IS NULL AND LEFT(COALESCE(t.date, ''), 10) < $1)",
        [todayStr],
        safeLimit,
        'task_due_overdue'
    ));

    const todayTasks = await source(pool, warnings, 'tasks_today', () => loadTaskBucket(
        pool,
        user,
        'today',
        "(t.deadline IS NOT NULL AND t.deadline >= NOW() AND t.deadline::date = $1::date) OR (t.deadline IS NULL AND LEFT(COALESCE(t.date, ''), 10) = $1)",
        [todayStr],
        safeLimit,
        'task_due_today'
    ));

    const tomorrowTasks = await source(pool, warnings, 'tasks_tomorrow', () => loadTaskBucket(
        pool,
        user,
        'tomorrow',
        "(t.deadline IS NOT NULL AND t.deadline::date = $1::date) OR (t.deadline IS NULL AND LEFT(COALESCE(t.date, ''), 10) = $1)",
        [tomorrowStr],
        safeLimit,
        'task_due_tomorrow'
    ));

    const callbackDue = await source(pool, warnings, 'lead_followups', async () => {
        const result = await pool.query(`
            SELECT li.id AS interaction_id, li.lead_id, li.type, li.summary, li.details,
                   li.follow_up_date AS due_at, l.client_name, l.phone, l.pipeline_stage,
                   l.assigned_to, l.booking_id, u.name AS assigned_name
            FROM lead_interactions li
            JOIN leads l ON l.id = li.lead_id
            LEFT JOIN users u ON u.id = l.assigned_to
            WHERE li.follow_up_date IS NOT NULL
              AND COALESCE(li.follow_up_done, false) = false
              AND li.follow_up_date::date <= $1::date
              AND COALESCE(l.pipeline_stage, 'new') <> ALL($2::text[])
            ORDER BY li.follow_up_date ASC, li.created_at DESC
            LIMIT $3
        `, [tomorrowStr, CLOSED_LEAD_STAGES, safeLimit]);
        return result.rows.map(row => leadItem(row, 'callback_due', {
            sourceType: 'lead_interaction',
            source_id: row.interaction_id,
            title: `Передзвонити: ${leadTitle(row)}`,
            subtitle: row.summary || row.details || row.phone || null,
            signal: 'lead_interactions.follow_up_date',
            confidence: 'exact',
            priority: dateValue(row.due_at) <= todayStr ? 'high' : 'normal'
        }));
    });

    const waitingReply = await source(pool, warnings, 'conversation_reply_expectations', async () => {
        const result = await pool.query(`
            SELECT c.id AS conversation_id, c.channel, c.customer_name, c.customer_phone,
                   c.customer_id, c.assigned_to, c.awaiting_reply_since,
                   c.reply_expected_message_id, c.reply_owner, c.reply_sla_at,
                   COALESCE(c.reply_sla_at, c.awaiting_reply_since) AS due_at,
                   cm.delivery_status, cm.delivery_error, cm.failed_at,
                   cust.lead_id
            FROM conversations c
            LEFT JOIN conversation_messages cm ON cm.id = c.reply_expected_message_id
            LEFT JOIN customers cust ON cust.id = c.customer_id
            WHERE c.reply_expected IS TRUE
              AND c.awaiting_reply_since IS NOT NULL
              AND COALESCE(c.status, 'open') NOT IN ('closed', 'spam')
              AND (c.last_inbound_at IS NULL OR c.last_inbound_at <= c.awaiting_reply_since)
              AND COALESCE(cm.delivery_status, '') NOT IN ('failed', 'later_failed')
            ORDER BY COALESCE(c.reply_sla_at, c.awaiting_reply_since) ASC
            LIMIT $1
        `, [safeLimit]);
        return result.rows.map(row => conversationItem(row, 'waiting_reply'));
    });

    const needsConfirmation = await source(pool, warnings, 'bookings_confirmation', async () => {
        const result = await pool.query(`
            SELECT b.id, b.date, b.time, b.label, b.group_name, b.program_name, b.room,
                   b.status, b.customer_id, c.lead_id
            FROM bookings b
            LEFT JOIN customers c ON c.id = b.customer_id
            WHERE LEFT(COALESCE(b.date, ''), 10) >= $1
              AND LEFT(COALESCE(b.date, ''), 10) <= $2
              AND b.status = 'preliminary'
              AND NULLIF(COALESCE(b.linked_to, ''), '') IS NULL
            ORDER BY b.date ASC, b.time ASC NULLS LAST
            LIMIT $3
        `, [todayStr, tomorrowStr, safeLimit]);
        return result.rows.map(row => bookingItem(row, 'needs_confirmation', {
            today: todayStr,
            actionLabel: 'Підтвердити бронювання',
            signal: 'bookings.status_preliminary',
            priority: dateValue(row.date) === todayStr ? 'high' : 'normal'
        }));
    });

    const eventSoon = await source(pool, warnings, 'leads_event_soon', async () => {
        const result = await pool.query(`
            SELECT l.id, l.client_name, l.phone, l.event_date AS due_at,
                   l.pipeline_stage, l.assigned_to, l.booking_id, u.name AS assigned_name,
                   p.label AS program_name
            FROM leads l
            LEFT JOIN users u ON u.id = l.assigned_to
            LEFT JOIN products p ON p.id = l.program_id
            WHERE l.event_date IS NOT NULL
              AND l.event_date::date >= $1::date
              AND l.event_date::date <= $2::date
              AND COALESCE(l.pipeline_stage, 'new') <> ALL($3::text[])
            ORDER BY l.event_date ASC, l.updated_at DESC
            LIMIT $4
        `, [todayStr, eventSoonStr, CLOSED_LEAD_STAGES, safeLimit]);
        return result.rows.map(row => leadItem(row, 'event_soon', {
            title: `Подія скоро: ${leadTitle(row)}`,
            subtitle: [row.program_name, row.phone].filter(Boolean).join(' · ') || null,
            signal: 'leads.event_date',
            confidence: 'durable',
            priority: dateValue(row.due_at) <= tomorrowStr ? 'high' : 'normal'
        }));
    });

    const idleLeads = await source(pool, warnings, 'leads_idle', async () => {
        const result = await pool.query(`
            SELECT l.id, l.client_name, l.phone, l.pipeline_stage, l.assigned_to,
                   l.booking_id, COALESCE(l.last_contact_at, l.created_at) AS due_at,
                   EXTRACT(EPOCH FROM (NOW() - COALESCE(l.last_contact_at, l.created_at))) / 3600 AS hours_idle,
                   u.name AS assigned_name
            FROM leads l
            LEFT JOIN users u ON u.id = l.assigned_to
            WHERE COALESCE(l.pipeline_stage, 'new') <> ALL($1::text[])
              AND COALESCE(l.last_contact_at, l.created_at) < NOW() - INTERVAL '48 hours'
            ORDER BY COALESCE(l.last_contact_at, l.created_at) ASC
            LIMIT $2
        `, [CLOSED_LEAD_STAGES, safeLimit]);
        return result.rows.map(row => leadItem(row, 'idle_lead', {
            title: `Лід без руху: ${leadTitle(row)}`,
            subtitle: row.hours_idle ? `${Math.round(row.hours_idle)} год без контакту` : row.phone || null,
            signal: 'leads.last_contact_at_or_created_at',
            confidence: 'suggested',
            priority: Number(row.hours_idle || 0) >= 72 ? 'high' : 'normal'
        }));
    });

    const tomorrowBookings = await source(pool, warnings, 'bookings_tomorrow', async () => {
        const result = await pool.query(`
            SELECT b.id, b.date, b.time, b.label, b.group_name, b.program_name, b.room,
                   b.status, b.customer_id, c.lead_id
            FROM bookings b
            LEFT JOIN customers c ON c.id = b.customer_id
            WHERE LEFT(COALESCE(b.date, ''), 10) = $1
              AND b.status IN ('confirmed', 'preliminary')
              AND NULLIF(COALESCE(b.linked_to, ''), '') IS NULL
            ORDER BY b.time ASC NULLS LAST
            LIMIT $2
        `, [tomorrowStr, safeLimit]);
        return result.rows.map(row => bookingItem(row, 'tomorrow', {
            today: todayStr,
            actionLabel: 'Перевірити підготовку',
            signal: 'bookings.date_tomorrow',
            priority: row.status === 'preliminary' ? 'high' : 'normal'
        }));
    });

    const allItems = [
        ...overdue,
        ...todayTasks,
        ...tomorrowTasks,
        ...tomorrowBookings,
        ...callbackDue,
        ...waitingReply,
        ...needsConfirmation,
        ...eventSoon,
        ...idleLeads
    ];

    for (const item of allItems) {
        if (!bucketMap[item.bucket]) continue;
        bucketMap[item.bucket].items.push(item);
    }

    for (const bucket of Object.values(bucketMap)) {
        bucket.items.sort(compareItems);
        bucket.count = bucket.items.length;
    }

    return {
        generatedAt: new Date().toISOString(),
        timezone: 'Europe/Kyiv',
        date: {
            today: todayStr,
            tomorrow: tomorrowStr,
            eventSoonUntil: eventSoonStr
        },
        buckets: BUCKETS.map(bucket => bucketMap[bucket.key]),
        items: BUCKETS.flatMap(bucket => bucketMap[bucket.key].items),
        meta: {
            canonicalBuckets: BUCKETS.map(bucket => bucket.key),
            heuristicBuckets: ['idle_lead'],
            omittedBuckets: [],
            warnings
        }
    };
}

module.exports = {
    BUCKETS,
    buildWorkQueue,
    addDays
};
