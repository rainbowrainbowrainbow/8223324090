#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');

const EFFECTIVE_DATE = process.env.ATTENDANCE_SNAPSHOT_EFFECTIVE_DATE || '2026-07-18';
const CONFIRMATION = 'READ_ONLY_ATTENDANCE_SNAPSHOT_AUDIT';

function requireConfiguration() {
    if (process.env.ATTENDANCE_SNAPSHOT_AUDIT_CONFIRM !== CONFIRMATION) {
        throw new Error(`set ATTENDANCE_SNAPSHOT_AUDIT_CONFIRM=${CONFIRMATION}`);
    }
    if (!process.env.DATABASE_PUBLIC_URL && !process.env.DATABASE_URL) {
        throw new Error('DATABASE_PUBLIC_URL or DATABASE_URL is required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(EFFECTIVE_DATE)) {
        throw new Error('ATTENDANCE_SNAPSHOT_EFFECTIVE_DATE must be YYYY-MM-DD');
    }
}

function noteCategory(notes) {
    const value = String(notes || '');
    if (/Hermes arrival-sheet import/i.test(value)) return 'hermes_import';
    if (/Заявка\s*#/iu.test(value)) return 'leave_request';
    if (/live[_ -]?qa|disposable/iu.test(value)) return 'qa_helper';
    return value.trim() ? 'manual_or_other' : 'none';
}

function classifyWriter(row) {
    const events = Array.isArray(row.audit_events) ? row.audit_events : [];
    const actions = new Set(events.map(event => event.action).filter(Boolean));
    const methods = new Set(events.map(event => event.method).filter(Boolean));
    const sources = new Set(events.map(event => event.source).filter(Boolean));
    const notes = noteCategory(row.notes);

    if (actions.has('attendance_hermes_apply') || notes === 'hermes_import') return 'import';
    if (actions.has('live_multi_segment_qa_attendance_create') || notes === 'qa_helper') return 'qa_helper';
    if (actions.has('mark_absent')) return 'manual_attendance_status';
    if (actions.has('leave_request_review') || notes === 'leave_request') return 'leave_request';
    if (actions.has('no_show') || row.status === 'no_show') return 'scheduler_no_show';
    if (actions.has('auto_close') || row.auto_closed === true) return 'auto_close';
    if (actions.has('correction') || row.corrected_at) return 'correction';
    if (methods.has('camera') || methods.has('face')
        || sources.has('camera') || sources.has('face_checkin')) return 'camera';
    if (actions.has('clock_in') || actions.has('clock_out')) return 'normal_clock';
    if (!row.clock_in && !row.clock_out
        && ['sick', 'vacation', 'day_off'].includes(String(row.status || ''))) {
        return 'manual_or_leave_status_without_audit';
    }
    if (!row.clock_in && !row.clock_out && row.status === 'absent') return 'legacy_absent_placeholder';
    return 'unclassified';
}

async function main() {
    requireConfiguration();
    const pool = new Pool({
        connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 1,
        connectionTimeoutMillis: 10_000
    });
    const client = await pool.connect();
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const columnResult = await client.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'hr_time_records'
             ORDER BY ordinal_position`
        );
        const auditColumnResult = await client.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'hr_audit_log'
             ORDER BY ordinal_position`
        );
        const coverageResult = await client.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE compensation_snapshot IS NULL)::int AS without_snapshot,
                    COUNT(*) FILTER (WHERE compensation_snapshot IS NOT NULL)::int AS with_snapshot
             FROM hr_time_records
             WHERE record_date >= $1::date`,
            [EFFECTIVE_DATE]
        );
        const candidateResult = await client.query(
            `SELECT tr.id,
                    tr.staff_id,
                    tr.status,
                    tr.clock_in,
                    tr.clock_out,
                    tr.planned_start,
                    tr.planned_end,
                    tr.total_worked_minutes,
                    tr.auto_closed,
                    tr.corrected_at,
                    tr.correction_reason,
                    tr.notes,
                    tr.ip_address IS NOT NULL AS has_ip_address,
                    tr.user_agent IS NOT NULL AS has_user_agent,
                    (tr.record_date - $1::date)::int AS record_day_offset,
                    (tr.created_at::date - $1::date)::int AS created_day_offset,
                    EXTRACT(HOUR FROM tr.created_at AT TIME ZONE 'Europe/Kyiv')::int AS created_hour_kyiv,
                    EXTRACT(EPOCH FROM (tr.updated_at - tr.created_at))::int AS update_delay_seconds,
                    COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'action', audit.action,
                                'method', audit.details->>'method',
                                'source', audit.details->>'source'
                            )
                            ORDER BY audit.created_at, audit.id
                        )
                        FROM hr_audit_log audit
                        WHERE audit.staff_id = tr.staff_id
                          AND audit.created_at BETWEEN tr.created_at - INTERVAL '5 minutes'
                                                   AND GREATEST(tr.updated_at, tr.created_at) + INTERVAL '5 minutes'
                          AND (
                              audit.details->>'record_id' = tr.id::text
                              OR audit.details->>'recordId' = tr.id::text
                              OR audit.details->>'attendance_record_id' = tr.id::text
                              OR audit.details->>'attendanceRecordId' = tr.id::text
                              OR COALESCE(
                                  audit.details->>'record_date',
                                  audit.details->>'recordDate',
                                  audit.details->>'documentDate'
                              ) = tr.record_date::text
                              OR audit.action IN (
                                  'mark_absent',
                                  'leave_request_review',
                                  'no_show',
                                  'auto_close'
                              )
                          )
                    ), '[]'::jsonb) AS audit_events
             FROM hr_time_records tr
             WHERE tr.record_date >= $1::date
               AND tr.compensation_snapshot IS NULL
             ORDER BY tr.created_at, tr.id`,
            [EFFECTIVE_DATE]
        );
        const records = candidateResult.rows.map((row, index) => ({
            record: `R${String(index + 1).padStart(2, '0')}`,
            writerPath: classifyWriter(row),
            recordDayOffset: row.record_day_offset,
            createdDayOffset: row.created_day_offset,
            createdHourKyiv: row.created_hour_kyiv,
            updateDelaySeconds: row.update_delay_seconds,
            status: row.status,
            hasClockIn: Boolean(row.clock_in),
            hasClockOut: Boolean(row.clock_out),
            hasPlannedInterval: Boolean(row.planned_start && row.planned_end),
            totalWorkedMinutes: Number(row.total_worked_minutes || 0),
            autoClosed: row.auto_closed === true,
            corrected: Boolean(row.corrected_at || row.correction_reason),
            noteCategory: noteCategory(row.notes),
            hasIpAddress: row.has_ip_address === true,
            hasUserAgent: row.has_user_agent === true,
            auditEvents: (row.audit_events || []).map(event => ({
                action: event.action || null,
                method: event.method || null,
                source: event.source || null
            }))
        }));
        const writerCounts = records.reduce((counts, record) => {
            counts[record.writerPath] = (counts[record.writerPath] || 0) + 1;
            return counts;
        }, {});
        console.log(JSON.stringify({
            mode: 'repeatable_read_read_only',
            effectiveDate: EFFECTIVE_DATE,
            columns: columnResult.rows.map(row => row.column_name),
            auditColumns: auditColumnResult.rows.map(row => row.column_name),
            coverage: coverageResult.rows[0],
            writerCounts,
            records
        }, null, 2));
        await client.query('ROLLBACK');
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.code || error.message);
    process.exitCode = 1;
});
