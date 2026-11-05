'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { executionError, requireExecutionEnabled, transaction, withProviderExecution, assertPaidCapacity } = require('./crmProviderExecution');
const { recognizeAttendanceSheet, matchAttendanceRows } = require('./crmAttendanceOcr');
const { validateScheduleImage } = require('./crmScheduleOcr');
const { assertKieOcrReady } = require('./crmScheduleOcrKie');
const { scheduleableStaffWhere } = require('./staffOperationalFilters');
const { resolveAttendancePlan, buildAttendanceCompensationPlanSnapshot } = require('./hrAttendance');

function stable(value) {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
    return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

async function attendanceSnapshot(client, documentDate, review) {
    const candidates = (await client.query(`SELECT s.id, s.name, s.display_name FROM staff s
        WHERE ${scheduleableStaffWhere('s', { dateExpression: '$1', includeFreelance: false })} ORDER BY s.id`, [documentDate])).rows;
    const matched = matchAttendanceRows(review, candidates);
    const ids = [...new Set(matched.map(r => r.matchedStaffId).filter(Number.isInteger))].sort((a,b) => a-b);
    const schedules = (await client.query('SELECT staff_id, status, shift_start, shift_end FROM staff_schedule WHERE staff_id=ANY($1::int[]) AND date=$2 ORDER BY staff_id', [ids, documentDate])).rows;
    const records = (await client.query('SELECT to_jsonb(t) AS record FROM hr_time_records t WHERE staff_id=ANY($1::int[]) AND record_date=$2::date ORDER BY staff_id,id', [ids, documentDate])).rows.map(r => r.record);
    const checkins = (await client.query('SELECT to_jsonb(c) AS record FROM staff_checkins c WHERE staff_id=ANY($1::int[]) AND date=$2::date ORDER BY staff_id,id', [ids, documentDate])).rows.map(r => r.record);
    const compensation = [];
    const rows = [];
    for (const row of matched) {
        if (row.classification !== 'requires_current_state_preview') { rows.push(row); continue; }
        const schedule = schedules.find(s => Number(s.staff_id) === row.matchedStaffId);
        let classification = 'ready_for_confirmed_apply';
        if (records.some(r => Number(r.staff_id) === row.matchedStaffId) || checkins.some(r => Number(r.staff_id) === row.matchedStaffId)) classification = 'existing_attendance_requires_review';
        else if (schedule && !['working','remote'].includes(schedule.status)) classification = 'schedule_conflict';
        if (classification === 'ready_for_confirmed_apply') {
            const plan = await resolveAttendancePlan(client, row.matchedStaffId, documentDate);
            const terms = await buildAttendanceCompensationPlanSnapshot(client, { staffId: row.matchedStaffId,
                recordDate: documentDate, plan, capturedAt: documentDate+'T00:00:00Z' });
            compensation.push({ staffId: row.matchedStaffId, terms });
            if (terms.manualReview) classification = 'compensation_requires_review';
        }
        rows.push({ ...row, classification, unscheduled: !schedule });
    }
    return { rows, snapshot: { candidates, schedules, records, checkins, compensation } };
}

function createAttendanceOcrPreview(options = {}) {
    const env = options.env || process.env;
    function assertContext(input) {
        requireExecutionEnabled(env, 'CRM_ATTENDANCE_OCR_ENABLED');
        if (input.businessContext !== 'event_genix' || !Number.isInteger(input.actor?.id) || input.actor.id < 1) throw executionError('CRM_ATTENDANCE_OCR_CONTEXT_FORBIDDEN', 403);
    }
    const validId = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value || '');
    function publicPreview(row, date, reused = false) {
        return { previewId: row.id, previewHash: row.preview_hash, rows: row.preview_rows,
            documentDate: date, expiresAt: row.expires_at, applied: !!row.applied_at,
            applyAllowed: false, wholeDayComplete: false, reused };
    }
    async function savePreview(client, execution, refresh) {
        // Serialize revisions independently of provider execution. No image/key is
        // needed when refreshing a reviewed execution after its preview expires.
        await client.query('SELECT id FROM crm_attendance_ocr_executions WHERE id=$1 FOR UPDATE', [execution.id]);
        const applied = await client.query('SELECT id FROM crm_attendance_ocr_previews WHERE execution_id=$1 AND applied_at IS NOT NULL', [execution.id]);
        if (applied.rowCount) throw executionError('CRM_ATTENDANCE_OCR_ALREADY_APPLIED');
        const prior = (await client.query('SELECT *, expires_at > NOW() AS valid FROM crm_attendance_ocr_previews WHERE execution_id=$1 ORDER BY revision DESC LIMIT 1', [execution.id])).rows[0];
        if (prior && !refresh) {
            if (!prior.valid) throw executionError('CRM_ATTENDANCE_OCR_PREVIEW_EXPIRED');
            return publicPreview(prior, execution.document_date, true);
        }
        const { rows, snapshot } = await attendanceSnapshot(client, execution.document_date, execution.review_document);
        const id = randomUUID(), hash = digest({ executionId: execution.id, rows, snapshot });
        const row = (await client.query(`INSERT INTO crm_attendance_ocr_previews
            (id,execution_id,revision,preview_rows,state_snapshot,preview_hash,expires_at)
            VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,NOW()+INTERVAL '30 minutes') RETURNING *`,
        [id,execution.id,(prior?.revision || 0)+1,JSON.stringify(rows),JSON.stringify(snapshot),hash])).rows[0];
        return publicPreview(row, execution.document_date);
    }
    return {
        async refreshPreview(input) {
            assertContext(input);
            if (!validId(input.previewId)) throw executionError('CRM_ATTENDANCE_OCR_PREVIEW_NOT_FOUND', 404);
            const pool = options.pool || require('../db').pool, client = await pool.connect();
            try {
                return await transaction(client, async () => {
                    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
                    const execution = (await client.query(`SELECT e.*,e.document_date::text AS document_date
                        FROM crm_attendance_ocr_executions e JOIN crm_attendance_ocr_previews p ON p.execution_id=e.id
                        WHERE p.id=$1 AND e.business_context=$2 AND e.actor_user_id=$3`,
                    [input.previewId,input.businessContext,input.actor.id])).rows[0];
                    if (!execution) throw executionError('CRM_ATTENDANCE_OCR_PREVIEW_NOT_FOUND', 404);
                    return savePreview(client, execution, true);
                });
            } finally { client.release(); }
        },
        async getPreview(input) {
            assertContext(input);
            if (!validId(input.previewId)) throw executionError('CRM_ATTENDANCE_OCR_PREVIEW_NOT_FOUND', 404);
            const pool = options.pool || require('../db').pool;
            const row = (await pool.query(`SELECT p.id,p.preview_hash,p.preview_rows,p.expires_at,p.applied_at,
                p.expires_at>NOW() AS valid,e.document_date::text AS document_date
                FROM crm_attendance_ocr_previews p JOIN crm_attendance_ocr_executions e ON e.id=p.execution_id
                WHERE p.id=$1 AND e.business_context=$2 AND e.actor_user_id=$3`,
            [input.previewId,input.businessContext,input.actor.id])).rows[0];
            if (!row) throw executionError('CRM_ATTENDANCE_OCR_PREVIEW_NOT_FOUND', 404);
            return { ...publicPreview(row, row.document_date, true), expired: !row.valid };
        },
        async preview(input) {
        assertContext(input);
        if (input.confirmed !== true) throw executionError('CRM_EXECUTION_CONFIRMATION_REQUIRED', 400);
        const date = input.documentDate;
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T00:00:00Z'))
            || new Date(date+'T00:00:00Z').toISOString().slice(0,10) !== date) throw executionError('CRM_ATTENDANCE_OCR_DATE_REQUIRES_REVIEW', 422);
        const image = validateScheduleImage(input.file), pool = options.pool || require('../db').pool;
        return withProviderExecution(pool, async client => {
            const params = [input.businessContext, input.actor.id, date, image.sha256];
            let entry = await transaction(client, async () => {
                const prior = (await client.query(`SELECT * FROM crm_attendance_ocr_executions
                    WHERE business_context=$1 AND actor_user_id=$2 AND document_date=$3::date AND image_sha256=$4`, params)).rows[0];
                if (prior) return { row: prior, created: false };
                const model = env.CRM_ATTENDANCE_OCR_MODEL;
                if (!options.recognize) assertKieOcrReady({ model, env, fetchImpl: options.fetchImpl });
                await assertPaidCapacity(client);
                const outstanding = (await client.query("SELECT count(*)::int AS n FROM crm_attendance_ocr_executions WHERE status IN ('reserved','unknown')")).rows[0].n;
                if (outstanding >= 3) throw executionError('CRM_PROVIDER_BUSY', 429);
                const row = (await client.query(`INSERT INTO crm_attendance_ocr_executions
                    (id,business_context,actor_user_id,document_date,image_sha256,provider,model,status)
                    VALUES ($5,$1,$2,$3::date,$4,'kie',$6,'reserved') RETURNING *`, [...params, randomUUID(), model || 'synthetic'])).rows[0];
                return { row, created: true };
            });
            if (entry.created) {
                try {
                    const review = await (options.recognize || recognizeAttendanceSheet)({ file: input.file, documentDate: date, env,
                        fetchImpl: options.fetchImpl, onReceipt: async receipt => {
                            const safe = Object.fromEntries(['provider','model','requestId','promptTokens','completionTokens','reasoningTokens','creditsConsumed'].map(k => [k,receipt[k]??null]));
                            await client.query("UPDATE crm_attendance_ocr_executions SET provider_receipt=$2::jsonb WHERE id=$1 AND status='reserved'", [entry.row.id, JSON.stringify(safe)]);
                        } });
                    entry.row = (await client.query("UPDATE crm_attendance_ocr_executions SET review_document=$2::jsonb,status='reviewed' WHERE id=$1 AND status='reserved' RETURNING *", [entry.row.id, JSON.stringify(review)])).rows[0];
                    if (!entry.row) throw executionError('CRM_ATTENDANCE_OCR_STATE_CHANGED');
                } catch (error) {
                    await client.query("UPDATE crm_attendance_ocr_executions SET status='unknown',error_code=$2 WHERE id=$1 AND status='reserved'", [entry.row?.id, /^CRM_[A-Z_]+$/.test(error.code || '') ? error.code : 'CRM_OCR_EXECUTION_REQUIRES_REVIEW']);
                    throw executionError('CRM_OCR_EXECUTION_REQUIRES_REVIEW', 502);
                }
            }
            if (entry.row.status !== 'reviewed') throw executionError('CRM_OCR_EXECUTION_REQUIRES_REVIEW');
            return transaction(client, async () => {
                await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
                return savePreview(client, { ...entry.row, document_date: date }, input.refreshPreview);
            });
        });
    } };
}

module.exports = { createAttendanceOcrPreview, attendanceSnapshot, digest };
