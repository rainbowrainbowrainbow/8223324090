const crypto = require('crypto');
const os = require('os');
const { pool } = require('../db');
const {
    buildHrAttendanceDocumentSnapshot,
    normalizeDocumentRequest
} = require('./hrAttendanceDocuments');
const {
    buildHrAttendanceDocumentPdfBuffer,
    hrAttendanceDocumentPdfFilename
} = require('./hrAttendanceDocumentsPdf');
const { createLogger } = require('../utils/logger');

const log = createLogger('HrAttendanceDocumentAutomation');
const KYIV_TIME_ZONE = 'Europe/Kyiv';
const TEMPLATE_VERSION = 'v27';
const BUILD_LEASE_SECONDS = 180;
const WORKER_ID = `${os.hostname()}:${process.pid}`.slice(0, 120);
const DOCUMENT_TYPES = new Set(['arrival_inout', 'month_grid']);
const JOB_ACTIONABLE_STATUSES = new Set(['building', 'queued', 'failed']);

function automationError(message, code = 'HR_ATTENDANCE_AUTOMATION_INVALID', statusCode = 400) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableStringify(value) {
    return JSON.stringify(stableValue(value));
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeInteger(value, fallback, min, max, field) {
    const number = value === undefined || value === null || value === '' ? fallback : Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
        throw automationError(`${field} має бути цілим числом від ${min} до ${max}`);
    }
    return number;
}

function normalizeLocalTime(value) {
    const match = String(value || '08:00').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) throw automationError('localTime має формат HH:MM');
    return `${match[1]}:${match[2]}`;
}

function normalizeWeekdays(value, documentType) {
    if (documentType === 'month_grid') return [1];
    const source = Array.isArray(value) && value.length ? value : [1, 2, 3, 4, 5, 6, 7];
    const days = [...new Set(source.map(Number))].sort((a, b) => a - b);
    if (!days.length || days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
        throw automationError('weekdays має містити дні 1–7');
    }
    return days;
}

function documentSettingsFromPayload(documentType, categoryIds, settings = {}) {
    const normalized = normalizeDocumentRequest({
        templateId: documentType,
        ...(documentType === 'arrival_inout' ? { documentDate: '2024-01-01' } : { month: '2024-01' }),
        categoryIds,
        dailyMode: settings.dailyMode || 'manual_blank',
        rosterMode: settings.rosterMode || 'all_eligible',
        locationShift: settings.locationShift || '',
        markedBy: settings.markedBy || '',
        texts: settings.texts || {},
        fontPreset: settings.fontPreset || {},
        allowEmpty: false
    });
    return {
        dailyMode: normalized.dailyMode,
        rosterMode: normalized.rosterMode,
        locationShift: normalized.locationShift,
        markedBy: normalized.markedBy,
        texts: normalized.texts,
        // Store the accepted scalar values, not normalizeDocumentRequest's
        // renderer metadata wrapper ({ name, customized, values }).
        fontPreset: normalized.fontPreset.values
    };
}

function normalizeAutomationPayload(payload = {}, current = null) {
    const merged = { ...(current || {}), ...(payload || {}) };
    const documentType = String(merged.documentType || merged.document_type || '').trim();
    if (!DOCUMENT_TYPES.has(documentType)) throw automationError('Невідомий тип документа');
    const name = String(merged.name || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 120) throw automationError('Назва автоматизації обов’язкова (до 120 символів)');
    const categoryIds = Array.isArray(merged.categoryIds)
        ? merged.categoryIds
        : (Array.isArray(merged.category_ids) ? merged.category_ids : []);
    const settingsSource = merged.settings || merged.settings_json || {};
    const settings = documentSettingsFromPayload(documentType, categoryIds, settingsSource);
    const weekdays = normalizeWeekdays(merged.weekdays, documentType);
    const scheduleKind = documentType === 'arrival_inout' ? 'weekly' : 'first_day_month';
    const normalized = {
        name,
        documentType,
        categoryIds: normalizeDocumentRequest({
            templateId: documentType,
            ...(documentType === 'arrival_inout' ? { documentDate: '2024-01-01' } : { month: '2024-01' }),
            categoryIds,
            allowEmpty: true
        }).categoryIds,
        scheduleKind,
        weekdays,
        localTime: normalizeLocalTime(merged.localTime || merged.local_time),
        copies: normalizeInteger(merged.copies, 1, 1, 10, 'copies'),
        settings,
        templateVersion: TEMPLATE_VERSION,
        artifactTtlHours: normalizeInteger(
            merged.artifactTtlHours ?? merged.artifact_ttl_hours,
            168,
            1,
            720,
            'artifactTtlHours'
        ),
        catchUpMinutes: normalizeInteger(
            merged.catchUpMinutes ?? merged.catch_up_minutes,
            120,
            1,
            360,
            'catchUpMinutes'
        ),
        printerTargetKey: 'queue_only',
        enabled: merged.enabled === true
    };
    normalized.selectionHash = sha256(stableStringify({
        documentType: normalized.documentType,
        categoryIds: normalized.categoryIds,
        settings: normalized.settings,
        templateVersion: normalized.templateVersion
    }));
    return normalized;
}

function kyivParts(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: KYIV_TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(now).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
    }, {});
    const localDate = `${parts.year}-${parts.month}-${parts.day}`;
    const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay() || 7;
    return {
        localDate,
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        weekday,
        minutes: Number(parts.hour) * 60 + Number(parts.minute)
    };
}

function isAutomationDue(automation, now = new Date()) {
    if (!automation?.enabled) return false;
    const parts = kyivParts(now);
    const [hour, minute] = String(automation.local_time || automation.localTime).slice(0, 5).split(':').map(Number);
    const scheduledMinutes = hour * 60 + minute;
    const delta = parts.minutes - scheduledMinutes;
    if (delta < 0 || delta > Number(automation.catch_up_minutes || automation.catchUpMinutes || 120)) return false;
    if (automation.document_type === 'month_grid' || automation.documentType === 'month_grid') return parts.day === 1;
    const weekdays = (automation.weekdays || []).map(Number);
    return weekdays.includes(parts.weekday);
}

function idempotencyKey(automation, localDate) {
    const id = Number(automation.id);
    const documentType = automation.document_type || automation.documentType;
    const selectionHash = automation.selection_hash || automation.selectionHash;
    return sha256(`${id}|${localDate}|${documentType}|${selectionHash}`);
}

function actorValues(actor = {}) {
    const id = Number(actor.id);
    return {
        id: Number.isSafeInteger(id) && id > 0 ? id : null,
        name: String(actor.name || actor.username || '').slice(0, 120) || null
    };
}

function mapAutomationRow(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        name: row.name,
        documentType: row.document_type,
        categoryIds: row.category_ids || [],
        scheduleKind: row.schedule_kind,
        weekdays: (row.weekdays || []).map(Number),
        localTime: String(row.local_time || '').slice(0, 5),
        copies: Number(row.copies),
        settings: row.settings_json || {},
        selectionHash: row.selection_hash,
        templateVersion: row.template_version,
        artifactTtlHours: Number(row.artifact_ttl_hours),
        catchUpMinutes: Number(row.catch_up_minutes),
        printerTargetKey: row.printer_target_key,
        enabled: row.enabled === true,
        lastEnqueuedLocalDate: row.last_enqueued_local_date || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function mapJobRow(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        automationId: Number(row.automation_id),
        automationName: row.automation_name || null,
        triggerKind: row.trigger_kind,
        localDate: row.local_date,
        documentType: row.document_type,
        status: row.status,
        templateVersion: row.template_version,
        pdfByteLength: row.pdf_byte_length === null ? null : Number(row.pdf_byte_length),
        filename: row.filename,
        copies: Number(row.copies),
        printerTargetKey: row.printer_target_key,
        attempts: Number(row.attempts),
        requeueCount: Number(row.requeue_count),
        queuedAt: row.queued_at,
        failedAt: row.failed_at,
        cancelledAt: row.cancelled_at,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at
    };
}

async function listAutomations(db = pool) {
    const result = await db.query('SELECT * FROM hr_attendance_document_automations ORDER BY enabled DESC, updated_at DESC, id DESC');
    return result.rows.map(mapAutomationRow);
}

async function createAutomation(payload, actor = {}, db = pool) {
    const item = normalizeAutomationPayload(payload);
    const user = actorValues(actor);
    const result = await db.query(
        `INSERT INTO hr_attendance_document_automations
            (name, document_type, category_ids, schedule_kind, weekdays, local_time, copies,
             settings_json, selection_hash, template_version, artifact_ttl_hours, catch_up_minutes,
             printer_target_key, enabled, created_by, updated_by, created_by_name, updated_by_name)
         VALUES ($1,$2,$3::text[],$4,$5::smallint[],$6::time,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$15,$16,$16)
         RETURNING *`,
        [item.name, item.documentType, item.categoryIds, item.scheduleKind, item.weekdays, item.localTime,
            item.copies, JSON.stringify(item.settings), item.selectionHash, item.templateVersion,
            item.artifactTtlHours, item.catchUpMinutes, item.printerTargetKey, item.enabled, user.id, user.name]
    );
    return mapAutomationRow(result.rows[0]);
}

async function updateAutomation(id, payload, actor = {}, db = pool) {
    const currentResult = await db.query('SELECT * FROM hr_attendance_document_automations WHERE id = $1', [id]);
    if (!currentResult.rows[0]) throw automationError('Автоматизацію не знайдено', 'HR_ATTENDANCE_AUTOMATION_NOT_FOUND', 404);
    const current = mapAutomationRow(currentResult.rows[0]);
    const item = normalizeAutomationPayload(payload, current);
    const user = actorValues(actor);
    const result = await db.query(
        `UPDATE hr_attendance_document_automations
         SET name=$2, document_type=$3, category_ids=$4::text[], schedule_kind=$5,
             weekdays=$6::smallint[], local_time=$7::time, copies=$8, settings_json=$9::jsonb,
             selection_hash=$10, template_version=$11, artifact_ttl_hours=$12,
             catch_up_minutes=$13, printer_target_key='queue_only', enabled=$14,
             updated_by=$15, updated_by_name=$16, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id, item.name, item.documentType, item.categoryIds, item.scheduleKind, item.weekdays,
            item.localTime, item.copies, JSON.stringify(item.settings), item.selectionHash,
            item.templateVersion, item.artifactTtlHours, item.catchUpMinutes, item.enabled, user.id, user.name]
    );
    return mapAutomationRow(result.rows[0]);
}

async function disableAutomation(id, actor = {}, db = pool) {
    return updateAutomation(id, { enabled: false }, actor, db);
}

function requestFromAutomation(automation, localDate) {
    const settings = automation.settings_json || automation.settings || {};
    const fontPreset = settings.fontPreset?.values || settings.fontPreset || {};
    const documentType = automation.document_type || automation.documentType;
    const categoryIds = automation.category_ids || automation.categoryIds;
    return {
        templateId: documentType,
        ...(documentType === 'arrival_inout' ? { documentDate: localDate } : { month: localDate.slice(0, 7) }),
        categoryIds,
        dailyMode: settings.dailyMode || 'manual_blank',
        rosterMode: settings.rosterMode || 'all_eligible',
        locationShift: settings.locationShift || '',
        markedBy: settings.markedBy || '',
        texts: settings.texts || {},
        fontPreset
    };
}

async function enqueueAutomationJob(automationId, triggerKind, actor = {}, options = {}, db = pool) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const localDate = options.localDate || kyivParts(now).localDate;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const locked = await client.query(
            'SELECT * FROM hr_attendance_document_automations WHERE id = $1 FOR UPDATE',
            [automationId]
        );
        const automation = locked.rows[0];
        if (!automation) throw automationError('Автоматизацію не знайдено', 'HR_ATTENDANCE_AUTOMATION_NOT_FOUND', 404);
        if (triggerKind === 'scheduled') {
            if (!isAutomationDue(automation, now) || String(automation.last_enqueued_local_date || '') === localDate) {
                await client.query('COMMIT');
                return null;
            }
        }
        const key = idempotencyKey(automation, localDate);
        const user = actorValues(actor);
        const request = requestFromAutomation(automation, localDate);
        const result = await client.query(
            `INSERT INTO hr_attendance_document_jobs
                (automation_id, trigger_kind, local_date, document_type, selection_hash, idempotency_key,
                 status, settings_snapshot, template_version, copies, printer_target_key,
                 print_deadline_at, expires_at, created_by, created_by_name)
             VALUES ($1,$2,$3::date,$4,$5,$6,'building',$7::jsonb,$8,$9,'queue_only',
                     $10::timestamptz + ($11 || ' minutes')::interval,
                     $10::timestamptz + ($12 || ' hours')::interval,$13,$14)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [automation.id, triggerKind, localDate, automation.document_type, automation.selection_hash,
                key, JSON.stringify(request), automation.template_version, automation.copies, now.toISOString(),
                automation.catch_up_minutes, automation.artifact_ttl_hours, user.id, user.name]
        );
        if (triggerKind === 'scheduled') {
            await client.query(
                `UPDATE hr_attendance_document_automations
                 SET last_enqueued_local_date=$2::date, updated_at=NOW() WHERE id=$1`,
                [automation.id, localDate]
            );
        }
        await client.query('COMMIT');
        if (result.rows[0]) return mapJobRow(result.rows[0]);
        const existing = await db.query(
            `SELECT jobs.*, automations.name AS automation_name
             FROM hr_attendance_document_jobs jobs
             JOIN hr_attendance_document_automations automations ON automations.id=jobs.automation_id
             WHERE jobs.idempotency_key=$1`,
            [key]
        );
        return mapJobRow(existing.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function claimBuildJob(jobId = null, db = pool) {
    const token = crypto.randomUUID();
    const result = await db.query(
        `WITH candidate AS (
            SELECT id FROM hr_attendance_document_jobs
            WHERE status='building'
              AND ($1::bigint IS NULL OR id=$1)
              AND (locked_until IS NULL OR locked_until < NOW())
            ORDER BY created_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE hr_attendance_document_jobs jobs
         SET claim_token=$2::uuid, claimed_by=$3,
             locked_until=NOW() + ($4 || ' seconds')::interval,
             attempts=attempts+1, updated_at=NOW()
         FROM candidate
         WHERE jobs.id=candidate.id
         RETURNING jobs.*`,
        [jobId, token, WORKER_ID, BUILD_LEASE_SECONDS]
    );
    return result.rows[0] ? { row: result.rows[0], token } : null;
}

async function buildClaimedJob(claim, db = pool) {
    const row = claim.row;
    try {
        const request = row.settings_snapshot || {};
        const snapshot = await buildHrAttendanceDocumentSnapshot(db, request);
        const pdf = await buildHrAttendanceDocumentPdfBuffer(snapshot);
        const filename = hrAttendanceDocumentPdfFilename(snapshot);
        const digest = sha256(pdf);
        const result = await db.query(
            `UPDATE hr_attendance_document_jobs
             SET status='queued', roster_snapshot=$3::jsonb, pdf_data=$4, pdf_sha256=$5,
                 pdf_byte_length=$6, filename=$7, queued_at=NOW(), failed_at=NULL,
                 error_code=NULL, error_message=NULL, claim_token=NULL, claimed_by=NULL,
                 locked_until=NULL, updated_at=NOW()
             WHERE id=$1 AND claim_token=$2::uuid AND status='building'
             RETURNING *`,
            [row.id, claim.token, JSON.stringify(snapshot), pdf, digest, pdf.length, filename]
        );
        return mapJobRow(result.rows[0]);
    } catch (error) {
        await db.query(
            `UPDATE hr_attendance_document_jobs
             SET status='failed', failed_at=NOW(), error_code=$3, error_message=$4,
                 claim_token=NULL, claimed_by=NULL, locked_until=NULL, updated_at=NOW()
             WHERE id=$1 AND claim_token=$2::uuid`,
            [row.id, claim.token, String(error.code || 'HR_ATTENDANCE_DOCUMENT_BUILD_FAILED').slice(0, 80),
                String(error.message || 'PDF build failed').slice(0, 500)]
        );
        throw error;
    }
}

async function processBuildJobs(options = {}, db = pool) {
    const limit = normalizeInteger(options.limit, 3, 1, 20, 'limit');
    const completed = [];
    for (let index = 0; index < limit; index += 1) {
        const claim = await claimBuildJob(options.jobId || null, db);
        if (!claim) break;
        completed.push(await buildClaimedJob(claim, db));
        if (options.jobId) break;
    }
    return completed;
}

async function manualRun(automationId, actor = {}, options = {}, db = pool) {
    const job = await enqueueAutomationJob(automationId, 'manual', actor, options, db);
    if (job?.status === 'building') {
        const built = await processBuildJobs({ jobId: job.id, limit: 1 }, db);
        return built[0] || job;
    }
    if (job && ['failed', 'cancelled', 'expired'].includes(job.status)) {
        return requeueJob(job.id, db);
    }
    return job;
}

async function listJobs(filters = {}, db = pool) {
    const limit = normalizeInteger(filters.limit, 40, 1, 100, 'limit');
    const result = await db.query(
        `SELECT jobs.*, automations.name AS automation_name
         FROM hr_attendance_document_jobs jobs
         JOIN hr_attendance_document_automations automations ON automations.id=jobs.automation_id
         ORDER BY jobs.created_at DESC, jobs.id DESC LIMIT $1`,
        [limit]
    );
    return result.rows.map(mapJobRow);
}

async function getJobPdf(jobId, db = pool) {
    const result = await db.query(
        `SELECT id, status, filename, pdf_data, pdf_sha256, pdf_byte_length, expires_at
         FROM hr_attendance_document_jobs WHERE id=$1`,
        [jobId]
    );
    const row = result.rows[0];
    if (!row) throw automationError('Завдання не знайдено', 'HR_ATTENDANCE_JOB_NOT_FOUND', 404);
    if (row.status === 'expired' || new Date(row.expires_at).getTime() <= Date.now()) {
        throw automationError('PDF уже протерміновано', 'HR_ATTENDANCE_JOB_EXPIRED', 410);
    }
    if (!row.pdf_data) throw automationError('PDF ще не готовий', 'HR_ATTENDANCE_JOB_NOT_READY', 409);
    return { filename: row.filename, buffer: row.pdf_data, sha256: row.pdf_sha256 };
}

async function cancelJob(jobId, db = pool) {
    const result = await db.query(
        `UPDATE hr_attendance_document_jobs
         SET status='cancelled', cancelled_at=NOW(), claim_token=NULL, claimed_by=NULL,
             locked_until=NULL, updated_at=NOW()
         WHERE id=$1 AND status = ANY($2::text[]) RETURNING *`,
        [jobId, [...JOB_ACTIONABLE_STATUSES]]
    );
    if (!result.rows[0]) throw automationError('Завдання не знайдено або його вже не можна скасувати', 'HR_ATTENDANCE_JOB_NOT_ACTIONABLE', 409);
    return mapJobRow(result.rows[0]);
}

async function requeueJob(jobId, db = pool) {
    const result = await db.query(
        `UPDATE hr_attendance_document_jobs
         SET status=CASE WHEN pdf_data IS NULL THEN 'building' ELSE 'queued' END,
             requeue_count=requeue_count+1, failed_at=NULL, cancelled_at=NULL,
             error_code=NULL, error_message=NULL, claim_token=NULL, claimed_by=NULL,
             locked_until=NULL, queued_at=CASE WHEN pdf_data IS NULL THEN NULL ELSE NOW() END,
             expires_at=NOW() + automations.artifact_ttl_hours * INTERVAL '1 hour',
             print_deadline_at=NOW() + automations.catch_up_minutes * INTERVAL '1 minute',
             updated_at=NOW()
         FROM hr_attendance_document_automations automations
         WHERE hr_attendance_document_jobs.id=$1
           AND automations.id=hr_attendance_document_jobs.automation_id
           AND hr_attendance_document_jobs.status = ANY($2::text[])
         RETURNING hr_attendance_document_jobs.*`,
        [jobId, ['failed', 'cancelled', 'queued', 'expired']]
    );
    if (!result.rows[0]) throw automationError('Завдання не знайдено або його не можна повторити', 'HR_ATTENDANCE_JOB_NOT_ACTIONABLE', 409);
    const job = mapJobRow(result.rows[0]);
    if (job.status === 'building') {
        const built = await processBuildJobs({ jobId: job.id, limit: 1 }, db);
        return built[0] || job;
    }
    return job;
}

async function expireArtifacts(db = pool) {
    const result = await db.query(
        `UPDATE hr_attendance_document_jobs
         SET status='expired', pdf_data=NULL, roster_snapshot=NULL, claim_token=NULL,
             claimed_by=NULL, locked_until=NULL, updated_at=NOW()
         WHERE expires_at <= NOW()
           AND status = ANY($1::text[])
         RETURNING id`,
        [['queued', 'failed', 'cancelled']]
    );
    return result.rowCount;
}

async function checkHrAttendancePrintAutomations(options = {}, db = pool) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const result = await db.query('SELECT * FROM hr_attendance_document_automations WHERE enabled=TRUE ORDER BY id');
    let enqueued = 0;
    for (const automation of result.rows) {
        if (!isAutomationDue(automation, now)) continue;
        const job = await enqueueAutomationJob(automation.id, 'scheduled', {}, { now }, db);
        if (job?.status === 'building') enqueued += 1;
    }
    let built = 0;
    try {
        built = (await processBuildJobs({ limit: 5 }, db)).length;
    } catch (error) {
        log.error('Scheduled HR attendance PDF build failed', { code: error.code || 'HR_ATTENDANCE_DOCUMENT_BUILD_FAILED' });
    }
    const expired = await expireArtifacts(db);
    return { checked: result.rowCount, enqueued, built, expired };
}

module.exports = {
    TEMPLATE_VERSION,
    automationError,
    checkHrAttendancePrintAutomations,
    createAutomation,
    disableAutomation,
    enqueueAutomationJob,
    getJobPdf,
    idempotencyKey,
    isAutomationDue,
    kyivParts,
    listAutomations,
    listJobs,
    manualRun,
    mapAutomationRow,
    mapJobRow,
    normalizeAutomationPayload,
    processBuildJobs,
    requeueJob,
    cancelJob,
    sha256,
    stableStringify,
    updateAutomation
};
