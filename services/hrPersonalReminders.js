'use strict';

const { getKyivDateStr } = require('./booking');

// Use the same projection in the personal cabinet and alert center. No task
// records are created, so updates, returns and revocations apply on the next read.
async function listHrPersonalReminders(db, user, scope, today = getKyivDateStr()) {
    const userId = Number(user?.id);
    const contexts = scope?.selectedContexts?.length ? scope.selectedContexts : [scope?.activeContext];
    if (!Number.isSafeInteger(userId) || userId <= 0 || !contexts.every(Boolean)) return [];

    const result = await db.query(`
        WITH linked_staff AS (
            SELECT s.id
            FROM employee_profiles ep
            JOIN staff s ON s.id = ep.staff_id AND s.is_active IS TRUE
            JOIN users u ON u.id = ep.user_id AND u.is_active IS TRUE
            WHERE ep.user_id = $1 AND ep.is_active IS TRUE
              AND COALESCE(s.hr_pool_status, 'active') NOT IN ('terminated', 'blacklist', 'dismissed')
        ), deadlines AS (
            SELECT 'resource' AS kind, r.id, r.title, r.due_return_at AS due_date,
                   COALESCE(r.business_context, CASE WHEN ws.id IS NOT NULL
                       THEN COALESCE(ws.business_context, 'event_genix') END) AS business_context
            FROM linked_staff s
            JOIN staff_resource_assignments r ON r.staff_id = s.id
            LEFT JOIN warehouse_stock ws ON ws.id = r.warehouse_stock_id
            WHERE r.status = 'issued' AND r.due_return_at <= $3::date + 7
            UNION ALL
            SELECT 'medical_book', c.id, 'Медкнижка', c.expires_at,
                   COALESCE(c.business_context, 'event_genix')
            FROM linked_staff s
            JOIN staff_certifications c ON c.staff_id = s.id
            WHERE c.category = 'medical_book' AND c.status IN ('active', 'expired')
              AND c.expires_at <= $3::date + 14
              AND NOT EXISTS (
                SELECT 1 FROM staff_certifications renewed
                WHERE renewed.staff_id = c.staff_id AND renewed.category = 'medical_book'
                  AND renewed.status IN ('active', 'expired')
                  AND COALESCE(renewed.business_context, 'event_genix') = COALESCE(c.business_context, 'event_genix')
                  AND renewed.expires_at IS NOT NULL
                  AND (COALESCE(renewed.issued_at, '-infinity'::date), renewed.id)
                      > (COALESCE(c.issued_at, '-infinity'::date), c.id)
              )
        )
        SELECT kind, id, title, due_date::text, business_context,
               CASE WHEN due_date < $3::date THEN 'overdue'
                    WHEN due_date = $3::date THEN 'today' ELSE 'upcoming' END AS stage
        FROM deadlines
        WHERE business_context = ANY($2::text[])
        ORDER BY due_date, kind, id
        LIMIT 50`, [userId, contexts, today]);
    return result.rows.map(row => ({
        id: `hr_${row.kind}_${row.id}_${row.due_date}_${row.stage}`,
        level: row.stage === 'overdue' ? 'critical' : 'warning',
        type: 'hr_deadline',
        title: row.kind === 'resource' ? 'Повернути майно' : 'Оновити медкнижку',
        message: row.kind === 'resource'
            ? `${row.title} · поверніть відповідальному`
            : 'Передайте оновлену медкнижку відповідальному за HR',
        dueDate: row.due_date,
        stage: row.stage,
        businessContext: row.business_context,
        link: '/profile?tab=myday#hr-personal-reminders'
    }));
}

module.exports = { listHrPersonalReminders };
