'use strict';

const crypto = require('crypto');
const { pool: defaultPool } = require('../db');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');
const { lockAttendanceWriteTargets } = require('./attendanceWriteLock');
const { toPostgresDateOnly } = require('./postgresDateOnly');
const { scheduleableStaffWhere } = require('./staffOperationalFilters');

const HERMES_ATTENDANCE_PREVIEW_MAX_ROWS = 100;
const HERMES_ATTENDANCE_PREVIEW_TTL_MINUTES = 30;
const HERMES_ATTENDANCE_SOURCE_TYPE = 'arrival_sheet_photo';
const HERMES_ATTENDANCE_CLASSIFICATIONS = Object.freeze([
    'ready_to_apply',
    'staff_not_found',
    'ambiguous_staff',
    'schedule_conflict',
    'duplicate_attendance',
    'invalid_time',
    'date_missing'
]);
const WORKING_SCHEDULE_STATUSES = new Set(['working', 'remote']);
const FORBIDDEN_REFERENCE_KEYS = new Set([
    'apikey',
    'authorization',
    'base64',
    'binary',
    'bottoken',
    'cookie',
    'cookies',
    'file',
    'headers',
    'image',
    'imagedata',
    'photo',
    'photobinary',
    'rawheaders',
    'secret',
    'telegrambottoken',
    'token'
]);

function attendanceError(statusCode, code, message, details = undefined) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
}

function normalizeForStableJson(value) {
    if (value === undefined || value === null) return null;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(normalizeForStableJson);
    if (typeof value !== 'object') return value;
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
        normalized[key] = normalizeForStableJson(value[key]);
    }
    return normalized;
}

function stableJsonStringify(value) {
    return JSON.stringify(normalizeForStableJson(value));
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeReferenceKey(value) {
    return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function assertNoSensitivePayload(value, path = 'body') {
    if (Buffer.isBuffer(value)) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_BINARY_FORBIDDEN',
            `${path} must not contain photo or file binary`
        );
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertNoSensitivePayload(item, `${path}[${index}]`));
        return;
    }
    for (const [key, item] of Object.entries(value)) {
        if (FORBIDDEN_REFERENCE_KEYS.has(normalizeReferenceKey(key))) {
            throw attendanceError(
                400,
                'HERMES_ATTENDANCE_SENSITIVE_FIELD_FORBIDDEN',
                `${path}.${key} is not accepted by the attendance preview endpoint`
            );
        }
        assertNoSensitivePayload(item, `${path}.${key}`);
    }
}

function normalizeText(value, fieldName, options = {}) {
    const text = String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!text) {
        if (options.required === false) return '';
        throw attendanceError(400, 'HERMES_ATTENDANCE_PREVIEW_INVALID', `${fieldName} is required`);
    }
    if (text.length > (options.maxLength || 160)) {
        throw attendanceError(400, 'HERMES_ATTENDANCE_PREVIEW_INVALID', `${fieldName} is too long`);
    }
    return text;
}

function normalizeMatchName(value) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('uk-UA');
}

function normalizeDocumentDate(value) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_DOCUMENT_DATE_INVALID',
            'documentDate must use YYYY-MM-DD'
        );
    }
    const parsed = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_DOCUMENT_DATE_INVALID',
            'documentDate is not a valid date'
        );
    }
    return text;
}

function normalizeArrivalTime(value) {
    const text = String(value ?? '').trim();
    const match = text.match(/^(\d{2}):([0-5]\d)$/);
    if (!match || Number(match[1]) > 23) return null;
    return text;
}

function normalizeOptionalBoolean(value, fieldName) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'boolean') {
        throw attendanceError(400, 'HERMES_ATTENDANCE_PREVIEW_INVALID', `${fieldName} must be boolean`);
    }
    return value;
}

function normalizeConfidence(value, fieldName) {
    if (value === undefined || value === null || value === '') return null;
    const confidence = Number(value);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_PREVIEW_INVALID',
            `${fieldName} must be between 0 and 1`
        );
    }
    return confidence;
}

function normalizeHermesAttendancePreviewPayload(input = {}, options = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.isBuffer(input)) {
        throw attendanceError(400, 'HERMES_ATTENDANCE_PREVIEW_INVALID', 'Preview body must be a JSON object');
    }
    assertNoSensitivePayload(input);
    const allowedKeys = new Set([
        'businessContext',
        'business_context',
        'documentDate',
        'document_date',
        'source',
        'rows'
    ]);
    const unknownKeys = Object.keys(input).filter(key => !allowedKeys.has(key));
    if (unknownKeys.length) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_PREVIEW_FIELDS_INVALID',
            `Preview body contains unsupported fields: ${unknownKeys.join(', ')}`
        );
    }

    const requestedBusinessContext = String(
        input.businessContext ?? input.business_context ?? options.businessContext ?? DEFAULT_BUSINESS_CONTEXT
    ).trim().toLowerCase();
    if (requestedBusinessContext !== DEFAULT_BUSINESS_CONTEXT) {
        throw attendanceError(
            403,
            'HERMES_ATTENDANCE_BUSINESS_CONTEXT_UNAVAILABLE',
            'Hermes attendance import currently supports event_genix only'
        );
    }
    const businessContext = normalizeBusinessContext(requestedBusinessContext);
    const documentDate = normalizeDocumentDate(input.documentDate ?? input.document_date);
    const source = input.source;
    if (!source || typeof source !== 'object' || Array.isArray(source) || Buffer.isBuffer(source)) {
        throw attendanceError(400, 'HERMES_ATTENDANCE_SOURCE_INVALID', 'source must be an object');
    }
    const sourceAllowedKeys = new Set(['type', 'rowSet', 'row_set']);
    const sourceUnknownKeys = Object.keys(source).filter(key => !sourceAllowedKeys.has(key));
    if (sourceUnknownKeys.length) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_SOURCE_FIELDS_INVALID',
            `source contains unsupported fields: ${sourceUnknownKeys.join(', ')}`
        );
    }
    const sourceType = normalizeText(source.type, 'source.type', { maxLength: 48 });
    if (sourceType !== HERMES_ATTENDANCE_SOURCE_TYPE) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_SOURCE_TYPE_INVALID',
            `source.type must be ${HERMES_ATTENDANCE_SOURCE_TYPE}`
        );
    }
    const rowSet = normalizeText(source.rowSet ?? source.row_set, 'source.rowSet', { maxLength: 160 });
    if (!Array.isArray(input.rows)
        || input.rows.length < 1
        || input.rows.length > HERMES_ATTENDANCE_PREVIEW_MAX_ROWS) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_ROWS_INVALID',
            `rows must contain between 1 and ${HERMES_ATTENDANCE_PREVIEW_MAX_ROWS} entries`
        );
    }

    const seenSourceRowIds = new Set();
    const rows = input.rows.map((row, index) => {
        const field = `rows[${index}]`;
        if (!row || typeof row !== 'object' || Array.isArray(row) || Buffer.isBuffer(row)) {
            throw attendanceError(400, 'HERMES_ATTENDANCE_ROW_INVALID', `${field} must be an object`);
        }
        const rowAllowedKeys = new Set([
            'sourceRowId',
            'source_row_id',
            'ocrName',
            'ocr_name',
            'arrivalTime',
            'arrival_time',
            'signatureVisible',
            'signature_visible',
            'confidence'
        ]);
        const rowUnknownKeys = Object.keys(row).filter(key => !rowAllowedKeys.has(key));
        if (rowUnknownKeys.length) {
            throw attendanceError(
                400,
                'HERMES_ATTENDANCE_ROW_FIELDS_INVALID',
                `${field} contains unsupported fields: ${rowUnknownKeys.join(', ')}`
            );
        }
        const sourceRowId = normalizeText(
            row.sourceRowId ?? row.source_row_id,
            `${field}.sourceRowId`,
            { maxLength: 80 }
        );
        if (seenSourceRowIds.has(sourceRowId)) {
            throw attendanceError(
                400,
                'HERMES_ATTENDANCE_SOURCE_ROW_DUPLICATE',
                `Duplicate sourceRowId: ${sourceRowId}`
            );
        }
        seenSourceRowIds.add(sourceRowId);
        const ocrName = normalizeText(row.ocrName ?? row.ocr_name, `${field}.ocrName`, {
            required: false,
            maxLength: 160
        });
        const rawArrivalTime = String(row.arrivalTime ?? row.arrival_time ?? '').trim().slice(0, 32);
        return {
            sourceRowId,
            ocrName,
            arrivalTime: normalizeArrivalTime(rawArrivalTime),
            rawArrivalTime,
            signatureVisible: normalizeOptionalBoolean(
                row.signatureVisible ?? row.signature_visible,
                `${field}.signatureVisible`
            ),
            confidence: normalizeConfidence(row.confidence, `${field}.confidence`)
        };
    });

    return {
        businessContext,
        documentDate,
        source: { type: sourceType, rowSet },
        rows
    };
}

function candidateNames(row = {}) {
    return [...new Set([row.name, row.display_name]
        .map(normalizeMatchName)
        .filter(Boolean))];
}

function matchStaffCandidate(ocrName, candidates = []) {
    const normalized = normalizeMatchName(ocrName);
    if (!normalized) return { kind: 'not_found', candidates: [] };
    const exact = candidates.filter(candidate => candidateNames(candidate).includes(normalized));
    if (exact.length === 1) return { kind: 'matched', candidate: exact[0], candidates: exact };
    if (exact.length > 1) return { kind: 'ambiguous', candidates: exact };

    const queryTokens = normalized.split(' ').filter(Boolean);
    const tokenMatches = candidates.filter(candidate => candidateNames(candidate).some(name => {
        const tokens = new Set(name.split(' ').filter(Boolean));
        return queryTokens.length > 0 && queryTokens.every(token => tokens.has(token));
    }));
    if (tokenMatches.length === 1) {
        return { kind: 'matched', candidate: tokenMatches[0], candidates: tokenMatches };
    }
    if (tokenMatches.length > 1) return { kind: 'ambiguous', candidates: tokenMatches };
    return { kind: 'not_found', candidates: [] };
}

function scheduleStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'day_off' ? 'dayoff' : (normalized || null);
}

function timeToMinutes(value) {
    const normalized = normalizeArrivalTime(value);
    if (!normalized) return null;
    const [hours, minutes] = normalized.split(':').map(Number);
    return (hours * 60) + minutes;
}

function buildAttendancePlan(row, schedule = null) {
    const status = scheduleStatus(schedule?.status);
    const plannedStart = normalizeArrivalTime(String(schedule?.shift_start || '').slice(0, 5));
    const plannedEnd = normalizeArrivalTime(String(schedule?.shift_end || '').slice(0, 5));
    if (!WORKING_SCHEDULE_STATUSES.has(status) || plannedStart === null) {
        return {
            plannedStart: null,
            plannedEnd: null,
            lateMinutes: 0,
            attendanceStatus: 'unscheduled'
        };
    }
    const difference = Math.max(0, timeToMinutes(row.arrivalTime) - timeToMinutes(plannedStart));
    return {
        plannedStart,
        plannedEnd,
        lateMinutes: difference,
        attendanceStatus: difference > 5 ? 'late' : 'present'
    };
}

function emptyAttendanceSummary() {
    return Object.fromEntries(HERMES_ATTENDANCE_CLASSIFICATIONS.map(key => [key, 0]));
}

function classificationIssue(classification, context = {}) {
    switch (classification) {
    case 'date_missing':
        return { code: 'date_missing', message: 'documentDate is required before apply' };
    case 'invalid_time':
        return { code: 'invalid_time', message: 'arrivalTime must use HH:mm' };
    case 'staff_not_found':
        return { code: 'staff_not_found', message: 'No active CRM staff member matched this OCR name' };
    case 'ambiguous_staff':
        return { code: 'ambiguous_staff', message: 'More than one CRM staff member matched this OCR name' };
    case 'schedule_conflict':
        return {
            code: 'schedule_conflict',
            message: `CRM schedule status ${context.scheduleStatus || 'unknown'} blocks attendance import`
        };
    case 'duplicate_attendance':
        return { code: 'duplicate_attendance', message: 'Attendance already exists for this staff member and date' };
    default:
        return null;
    }
}

async function loadPreviewStaffCandidates(db, documentDate) {
    const params = documentDate ? [documentDate] : [];
    const dateExpression = documentDate ? '$1' : 'CURRENT_DATE';
    const result = await db.query(
        `SELECT s.id,
                s.name,
                COALESCE(NULLIF(s.display_name, ''), s.name) AS display_name,
                s.department,
                s.position
         FROM staff s
         WHERE ${scheduleableStaffWhere('s', { dateExpression, includeFreelance: false })}
         ORDER BY s.id ASC`,
        params
    );
    return result.rows;
}

async function loadAttendanceCurrentState(db, staffIds, documentDate, options = {}) {
    const ids = [...new Set(staffIds.map(Number).filter(id => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
    if (!ids.length || !documentDate) {
        return { schedules: new Map(), timeRecords: new Map(), checkins: new Map() };
    }
    const lock = options.forUpdate === true ? ' FOR UPDATE' : '';
    const [scheduleResult, timeResult, checkinResult] = await Promise.all([
        db.query(
            `SELECT staff_id, status, shift_start, shift_end
             FROM staff_schedule
             WHERE staff_id = ANY($1::int[])
               AND date = $2
             ORDER BY staff_id ASC${lock}`,
            [ids, documentDate]
        ),
        db.query(
            `SELECT id, staff_id, record_date::text AS record_date, clock_in, status
             FROM hr_time_records
             WHERE staff_id = ANY($1::int[])
               AND record_date = $2::date
             ORDER BY staff_id ASC${lock}`,
            [ids, documentDate]
        ),
        db.query(
            `SELECT id, staff_id, date::text AS date, check_in, method
             FROM staff_checkins
             WHERE staff_id = ANY($1::int[])
               AND date = $2::date
             ORDER BY staff_id ASC${lock}`,
            [ids, documentDate]
        )
    ]);
    return {
        schedules: new Map(scheduleResult.rows.map(row => [Number(row.staff_id), row])),
        timeRecords: new Map(timeResult.rows.map(row => [Number(row.staff_id), row])),
        checkins: new Map(checkinResult.rows.map(row => [Number(row.staff_id), row]))
    };
}

function buildPreviewRowId(sourceDedupeKey, row) {
    return `har_${sha256(stableJsonStringify({
        sourceDedupeKey,
        sourceRowId: row.sourceRowId,
        ocrName: normalizeMatchName(row.ocrName),
        arrivalTime: row.rawArrivalTime
    })).slice(0, 24)}`;
}

function buildPreviewRows(payload, candidates, currentState, sourceDedupeKey) {
    const seenAttendanceTargets = new Set();
    return payload.rows.map(row => {
        const match = matchStaffCandidate(row.ocrName, candidates);
        const matched = match.kind === 'matched' ? match.candidate : null;
        const staffId = matched ? Number(matched.id) : null;
        const schedule = staffId ? currentState.schedules.get(staffId) || null : null;
        const normalizedScheduleStatus = scheduleStatus(schedule?.status);
        let classification = 'ready_to_apply';
        if (!payload.documentDate) classification = 'date_missing';
        else if (!row.arrivalTime) classification = 'invalid_time';
        else if (match.kind === 'not_found') classification = 'staff_not_found';
        else if (match.kind === 'ambiguous') classification = 'ambiguous_staff';
        else if (schedule && !WORKING_SCHEDULE_STATUSES.has(normalizedScheduleStatus)) {
            classification = 'schedule_conflict';
        } else if (currentState.timeRecords.has(staffId) || currentState.checkins.has(staffId)) {
            classification = 'duplicate_attendance';
        } else if (seenAttendanceTargets.has(`${staffId}:${payload.documentDate}`)) {
            classification = 'duplicate_attendance';
        }
        if (classification === 'ready_to_apply') {
            seenAttendanceTargets.add(`${staffId}:${payload.documentDate}`);
        }
        const plan = classification === 'ready_to_apply' ? buildAttendancePlan(row, schedule) : null;
        const issue = classificationIssue(classification, { scheduleStatus: normalizedScheduleStatus });
        const previewRowId = buildPreviewRowId(sourceDedupeKey, row);
        return {
            previewRowId,
            sourceRowId: row.sourceRowId,
            ocrName: row.ocrName,
            matchedStaff: matched ? { staffId, name: matched.display_name || matched.name } : null,
            matchCandidates: match.kind === 'ambiguous'
                ? match.candidates.map(candidate => ({
                    staffId: Number(candidate.id),
                    name: candidate.display_name || candidate.name
                }))
                : [],
            arrivalTime: row.arrivalTime || row.rawArrivalTime || null,
            signatureVisible: row.signatureVisible,
            confidence: row.confidence,
            classification,
            issues: issue ? [issue] : [],
            writePlan: plan && matched ? {
                staffId,
                name: matched.display_name || matched.name,
                documentDate: payload.documentDate,
                arrivalTime: row.arrivalTime,
                ...plan
            } : null
        };
    });
}

function buildCurrentStateSnapshot(previewRows, currentState) {
    return previewRows.filter(row => row.matchedStaff).map(row => {
        const staffId = row.matchedStaff.staffId;
        const schedule = currentState.schedules.get(staffId) || null;
        return {
            previewRowId: row.previewRowId,
            staffId,
            schedule: schedule ? {
                status: scheduleStatus(schedule.status),
                startTime: normalizeArrivalTime(String(schedule.shift_start || '').slice(0, 5)),
                endTime: normalizeArrivalTime(String(schedule.shift_end || '').slice(0, 5))
            } : null,
            timeRecordExists: currentState.timeRecords.has(staffId),
            checkinExists: currentState.checkins.has(staffId)
        };
    });
}

function buildAttendancePreviewHash(input = {}) {
    return sha256(stableJsonStringify({
        documentDate: input.documentDate || null,
        source: input.source || null,
        extractedRows: input.extractedRows || [],
        previewRows: input.previewRows || [],
        currentStateSnapshot: input.currentStateSnapshot || []
    }));
}

function publicPreviewRow(row = {}) {
    return {
        previewRowId: row.previewRowId,
        sourceRowId: row.sourceRowId,
        ocrName: row.ocrName,
        matchedStaff: row.matchedStaff || null,
        ...(Array.isArray(row.matchCandidates) && row.matchCandidates.length
            ? { matchCandidates: row.matchCandidates }
            : {}),
        arrivalTime: row.arrivalTime,
        signatureVisible: row.signatureVisible ?? null,
        confidence: row.confidence ?? null,
        classification: row.classification,
        issues: Array.isArray(row.issues) ? row.issues : []
    };
}

function mapPreviewRecord(row, options = {}) {
    const previewRows = Array.isArray(row.preview_rows) ? row.preview_rows : [];
    const summary = emptyAttendanceSummary();
    for (const previewRow of previewRows) {
        if (Object.prototype.hasOwnProperty.call(summary, previewRow.classification)) {
            summary[previewRow.classification] += 1;
        }
    }
    return {
        success: true,
        previewId: row.public_id,
        status: row.status,
        documentDate: toPostgresDateOnly(row.document_date),
        expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
        created: options.created === true,
        replayed: options.replayed === true,
        summary,
        rows: previewRows.map(publicPreviewRow),
        attendanceWrites: 0,
        scheduleWrites: 0,
        scheduleTouched: false,
        sanitized: true
    };
}

async function persistAttendancePreview(db, record) {
    await db.query(
        `UPDATE hermes_attendance_imports
         SET status = 'expired'
         WHERE business_context = $1
           AND source_dedupe_key = $2
           AND status IN ('ready', 'needs_review')
           AND expires_at <= NOW()`,
        [record.businessContext, record.sourceDedupeKey]
    );
    const inserted = await db.query(
        `INSERT INTO hermes_attendance_imports (
             public_id,
             business_context,
             status,
             source_type,
             source_reference,
             source_dedupe_key,
             document_date,
             extracted_rows,
             preview_rows,
             current_state_snapshot,
             preview_hash,
             expires_at,
             created_by_user_id
         )
         VALUES (
             $1, $2, $3, $4, $5::jsonb, $6, $7::date,
             $8::jsonb, $9::jsonb, $10::jsonb, $11,
             NOW() + INTERVAL '30 minutes', $12
         )
         ON CONFLICT (business_context, source_dedupe_key)
             WHERE status IN ('ready', 'needs_review', 'applied')
         DO NOTHING
         RETURNING *`,
        [
            record.publicId,
            record.businessContext,
            record.status,
            record.source.type,
            JSON.stringify(record.source),
            record.sourceDedupeKey,
            record.documentDate,
            JSON.stringify(record.extractedRows),
            JSON.stringify(record.previewRows),
            JSON.stringify(record.currentStateSnapshot),
            record.previewHash,
            record.actorUserId
        ]
    );
    if (inserted.rows[0]) return mapPreviewRecord(inserted.rows[0], { created: true });

    const existing = await db.query(
        `SELECT *
         FROM hermes_attendance_imports
         WHERE business_context = $1
           AND source_dedupe_key = $2
           AND status IN ('ready', 'needs_review', 'applied')
         ORDER BY id DESC
         LIMIT 1`,
        [record.businessContext, record.sourceDedupeKey]
    );
    const existingRow = existing.rows[0];
    if (existingRow && existingRow.preview_hash === record.previewHash) {
        return mapPreviewRecord(existingRow, { replayed: true });
    }
    throw attendanceError(
        409,
        'HERMES_ATTENDANCE_SOURCE_CONFLICT',
        'This arrival-sheet source was already previewed with different content'
    );
}

async function previewHermesAttendanceImport(db = defaultPool, input = {}, options = {}) {
    const payload = normalizeHermesAttendancePreviewPayload(input, options);
    const sourceDedupeKey = sha256(stableJsonStringify({
        businessContext: payload.businessContext,
        documentDate: payload.documentDate,
        source: payload.source
    }));
    const candidates = await loadPreviewStaffCandidates(db, payload.documentDate);
    const matches = payload.rows.map(row => matchStaffCandidate(row.ocrName, candidates));
    const staffIds = matches
        .filter(match => match.kind === 'matched')
        .map(match => Number(match.candidate.id));
    const currentState = await loadAttendanceCurrentState(db, staffIds, payload.documentDate);
    const previewRows = buildPreviewRows(payload, candidates, currentState, sourceDedupeKey);
    const currentStateSnapshot = buildCurrentStateSnapshot(previewRows, currentState);
    const extractedRows = payload.rows.map(row => ({
        sourceRowId: row.sourceRowId,
        ocrName: row.ocrName,
        arrivalTime: row.arrivalTime || row.rawArrivalTime || null,
        signatureVisible: row.signatureVisible,
        confidence: row.confidence
    }));
    const readyCount = previewRows.filter(row => row.classification === 'ready_to_apply').length;
    const status = payload.documentDate && readyCount > 0 ? 'ready' : 'needs_review';
    const previewHash = buildAttendancePreviewHash({
        documentDate: payload.documentDate,
        source: payload.source,
        extractedRows,
        previewRows,
        currentStateSnapshot
    });
    return persistAttendancePreview(db, {
        publicId: `hai_${crypto.randomUUID()}`,
        businessContext: payload.businessContext,
        status,
        source: payload.source,
        sourceDedupeKey,
        documentDate: payload.documentDate,
        extractedRows,
        previewRows,
        currentStateSnapshot,
        previewHash,
        actorUserId: Number(options.actorUserId) || null
    });
}

function normalizeHermesAttendanceApplyBody(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.isBuffer(input)) {
        throw attendanceError(400, 'HERMES_ATTENDANCE_APPLY_BODY_INVALID', 'Apply body must be a JSON object');
    }
    assertNoSensitivePayload(input);
    const allowedKeys = new Set(['previewId', 'preview_id', 'selectedRowIds', 'selected_row_ids']);
    const unknownKeys = Object.keys(input).filter(key => !allowedKeys.has(key));
    if (unknownKeys.length) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_APPLY_BODY_FIELDS_INVALID',
            `Apply body contains unsupported fields: ${unknownKeys.join(', ')}`,
            { fields: unknownKeys }
        );
    }
    if (input.previewId !== undefined && input.preview_id !== undefined) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_APPLY_BODY_INVALID',
            'Use only one previewId field'
        );
    }
    if (input.selectedRowIds !== undefined && input.selected_row_ids !== undefined) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_APPLY_BODY_INVALID',
            'Use only one selectedRowIds field'
        );
    }
    const previewId = String(input.previewId ?? input.preview_id ?? '').trim();
    if (!/^hai_[a-z0-9-]{16,72}$/.test(previewId)) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_IMPORT_ID_INVALID',
            'previewId is invalid'
        );
    }
    const rawRowIds = input.selectedRowIds ?? input.selected_row_ids;
    if (!Array.isArray(rawRowIds)
        || rawRowIds.length < 1
        || rawRowIds.length > HERMES_ATTENDANCE_PREVIEW_MAX_ROWS) {
        throw attendanceError(
            400,
            'HERMES_ATTENDANCE_APPLY_ROWS_INVALID',
            `selectedRowIds must contain between 1 and ${HERMES_ATTENDANCE_PREVIEW_MAX_ROWS} row ids`
        );
    }
    const selectedRowIds = [];
    const seen = new Set();
    for (const value of rawRowIds) {
        const rowId = String(value || '').trim();
        if (!/^har_[a-f0-9]{24}$/.test(rowId)) {
            throw attendanceError(
                400,
                'HERMES_ATTENDANCE_APPLY_ROW_ID_INVALID',
                'selectedRowIds contains an invalid row id'
            );
        }
        if (seen.has(rowId)) {
            throw attendanceError(
                400,
                'HERMES_ATTENDANCE_APPLY_ROW_ID_DUPLICATE',
                'selectedRowIds contains a duplicate row id'
            );
        }
        seen.add(rowId);
        selectedRowIds.push(rowId);
    }
    return { previewId, selectedRowIds };
}

function storedPreviewHash(importRow) {
    return buildAttendancePreviewHash({
        documentDate: toPostgresDateOnly(importRow.document_date),
        source: importRow.source_reference,
        extractedRows: importRow.extracted_rows,
        previewRows: importRow.preview_rows,
        currentStateSnapshot: importRow.current_state_snapshot
    });
}

function skippedPreviewRow(row, classification = row.classification, reason = null) {
    return {
        previewRowId: row.previewRowId,
        sourceRowId: row.sourceRowId,
        staffId: row.matchedStaff?.staffId || null,
        name: row.matchedStaff?.name || row.ocrName || null,
        arrivalTime: row.arrivalTime || null,
        classification,
        reason: reason || row.issues?.[0]?.message || classification
    };
}

async function loadApplyStaff(db, staffIds, documentDate) {
    const ids = [...new Set(staffIds.map(Number).filter(id => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
    if (!ids.length) return new Map();
    const result = await db.query(
        `SELECT s.id,
                s.name,
                COALESCE(NULLIF(s.display_name, ''), s.name) AS display_name,
                (${scheduleableStaffWhere('s', { dateExpression: '$2', includeFreelance: false })}) AS scheduleable
         FROM staff s
         WHERE s.id = ANY($1::int[])
         ORDER BY s.id ASC
         FOR UPDATE OF s`,
        [ids, documentDate]
    );
    return new Map(result.rows.map(row => [Number(row.id), row]));
}

function actorLabel(options = {}) {
    return String(
        options.actor?.user?.username
        || options.actor?.user?.name
        || options.integrationId
        || 'hermes'
    ).slice(0, 50);
}

async function applyHermesAttendanceImport(db = defaultPool, input = {}, options = {}) {
    const request = normalizeHermesAttendanceApplyBody(input);
    const businessContext = normalizeBusinessContext(options.businessContext || DEFAULT_BUSINESS_CONTEXT);
    const loaded = await db.query(
        `SELECT *
         FROM hermes_attendance_imports
         WHERE public_id = $1
           AND business_context = $2
         LIMIT 1
         FOR UPDATE`,
        [request.previewId, businessContext]
    );
    const importRow = loaded.rows[0];
    if (!importRow) {
        throw attendanceError(404, 'HERMES_ATTENDANCE_IMPORT_NOT_FOUND', 'Attendance preview was not found');
    }
    if (!importRow.document_date) {
        throw attendanceError(
            409,
            'HERMES_ATTENDANCE_DOCUMENT_DATE_REQUIRED',
            'documentDate is required before attendance apply'
        );
    }
    if (importRow.status === 'applied') {
        throw attendanceError(
            409,
            'HERMES_ATTENDANCE_IMPORT_ALREADY_APPLIED',
            'Attendance preview is already applied'
        );
    }
    if (importRow.status !== 'ready') {
        throw attendanceError(
            409,
            'HERMES_ATTENDANCE_IMPORT_NOT_READY',
            `Attendance preview status ${importRow.status} cannot be applied`
        );
    }
    if (new Date(importRow.expires_at).getTime() <= Date.now()) {
        throw attendanceError(409, 'HERMES_ATTENDANCE_IMPORT_EXPIRED', 'Attendance preview has expired');
    }
    if (storedPreviewHash(importRow) !== importRow.preview_hash) {
        throw attendanceError(
            409,
            'HERMES_ATTENDANCE_PREVIEW_HASH_INVALID',
            'Stored attendance preview failed integrity validation'
        );
    }
    const previewRows = Array.isArray(importRow.preview_rows) ? importRow.preview_rows : [];
    const byId = new Map(previewRows.map(row => [row.previewRowId, row]));
    const selectedRows = request.selectedRowIds.map(rowId => {
        const row = byId.get(rowId);
        if (!row) {
            throw attendanceError(
                409,
                'HERMES_ATTENDANCE_PREVIEW_ROW_NOT_FOUND',
                `Selected preview row ${rowId} was not found`
            );
        }
        return row;
    });
    const readyRows = selectedRows.filter(row => row.classification === 'ready_to_apply' && row.writePlan);
    const skipped = selectedRows
        .filter(row => row.classification !== 'ready_to_apply' || !row.writePlan)
        .map(row => skippedPreviewRow(row));
    if (!readyRows.length) {
        throw attendanceError(
            409,
            'HERMES_ATTENDANCE_NO_READY_ROWS_SELECTED',
            'Select at least one ready_to_apply row'
        );
    }
    const documentDate = toPostgresDateOnly(importRow.document_date);

    await lockAttendanceWriteTargets(db, readyRows.map(row => ({
        staffId: row.writePlan.staffId,
        date: documentDate
    })));
    const staffIds = readyRows.map(row => Number(row.writePlan.staffId));
    const staff = await loadApplyStaff(db, staffIds, documentDate);
    const currentState = await loadAttendanceCurrentState(db, staffIds, documentDate, { forUpdate: true });
    const applied = [];

    for (const row of readyRows) {
        const staffId = Number(row.writePlan.staffId);
        const currentStaff = staff.get(staffId);
        if (!currentStaff || currentStaff.scheduleable !== true) {
            skipped.push(skippedPreviewRow(
                row,
                'staff_not_found',
                'Staff member is no longer active and scheduleable'
            ));
            continue;
        }
        const schedule = currentState.schedules.get(staffId) || null;
        const currentScheduleStatus = scheduleStatus(schedule?.status);
        if (schedule && !WORKING_SCHEDULE_STATUSES.has(currentScheduleStatus)) {
            skipped.push(skippedPreviewRow(
                row,
                'schedule_conflict',
                `CRM schedule status ${currentScheduleStatus || 'unknown'} blocks attendance import`
            ));
            continue;
        }
        if (currentState.timeRecords.has(staffId) || currentState.checkins.has(staffId)) {
            skipped.push(skippedPreviewRow(
                row,
                'duplicate_attendance',
                'Attendance already exists for this staff member and date'
            ));
            continue;
        }
        const plan = buildAttendancePlan({ arrivalTime: row.writePlan.arrivalTime }, schedule);
        const inserted = await db.query(
            `INSERT INTO hr_time_records (
                 business_context,
                 staff_id,
                 record_date,
                 clock_in,
                 planned_start,
                 planned_end,
                 late_minutes,
                 status,
                 notes
             )
             VALUES (
                 $1,
                 $2,
                 $3::date,
                 (($3::date + $4::time) AT TIME ZONE 'Europe/Kyiv'),
                 $5::time,
                 $6::time,
                 $7,
                 $8,
                 $9
             )
             ON CONFLICT (staff_id, record_date) DO NOTHING
             RETURNING id, clock_in`,
            [
                businessContext,
                staffId,
                documentDate,
                row.writePlan.arrivalTime,
                plan.plannedStart,
                plan.plannedEnd,
                plan.lateMinutes,
                plan.attendanceStatus,
                `Hermes arrival-sheet import ${importRow.public_id} / ${row.sourceRowId}`
            ]
        );
        const attendanceRecord = inserted.rows[0];
        if (!attendanceRecord) {
            skipped.push(skippedPreviewRow(
                row,
                'duplicate_attendance',
                'Attendance was created concurrently; the existing record was not overwritten'
            ));
            continue;
        }
        const appliedRow = {
            previewRowId: row.previewRowId,
            sourceRowId: row.sourceRowId,
            staffId,
            name: currentStaff.display_name || currentStaff.name,
            arrivalTime: row.writePlan.arrivalTime,
            attendanceRecordId: Number(attendanceRecord.id),
            status: plan.attendanceStatus,
            lateMinutes: plan.lateMinutes
        };
        applied.push(appliedRow);
        currentState.timeRecords.set(staffId, { id: attendanceRecord.id, staff_id: staffId });
        await db.query(
            `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
             VALUES ($1, $2, $3, $4::jsonb, $5)`,
            [
                'attendance_hermes_apply',
                staffId,
                actorLabel(options),
                JSON.stringify({
                    businessContext,
                    previewId: importRow.public_id,
                    previewRowId: row.previewRowId,
                    sourceType: importRow.source_type,
                    sourceRowId: row.sourceRowId,
                    documentDate,
                    arrivalTime: row.writePlan.arrivalTime,
                    attendanceRecordId: Number(attendanceRecord.id),
                    status: plan.attendanceStatus,
                    lateMinutes: plan.lateMinutes,
                    scheduleWrites: 0
                }),
                options.actor?.ip || null
            ]
        );
    }

    const response = {
        success: true,
        previewId: importRow.public_id,
        status: 'applied',
        documentDate,
        selectedCount: selectedRows.length,
        applied,
        skipped,
        attendanceWrites: applied.length,
        scheduleWrites: 0,
        scheduleTouched: false,
        sanitized: true
    };
    const updated = await db.query(
        `UPDATE hermes_attendance_imports
         SET status = 'applied',
             applied_by_user_id = $2,
             apply_result = $3::jsonb,
             applied_at = NOW()
         WHERE id = $1
           AND status = 'ready'
           AND preview_hash = $4
         RETURNING id`,
        [
            importRow.id,
            Number(options.actorUserId) || null,
            JSON.stringify(response),
            importRow.preview_hash
        ]
    );
    if (!updated.rows[0]) {
        throw attendanceError(
            500,
            'HERMES_ATTENDANCE_IMPORT_APPLY_CONFLICT',
            'Attendance preview could not be sealed as applied'
        );
    }
    return {
        response,
        changes: applied.map(row => ({
            businessContext,
            date: documentDate,
            staffId: row.staffId,
            attendanceRecordId: row.attendanceRecordId,
            status: row.status
        }))
    };
}

module.exports = {
    HERMES_ATTENDANCE_CLASSIFICATIONS,
    HERMES_ATTENDANCE_PREVIEW_MAX_ROWS,
    HERMES_ATTENDANCE_PREVIEW_TTL_MINUTES,
    applyHermesAttendanceImport,
    buildAttendancePlan,
    buildAttendancePreviewHash,
    buildPreviewRows,
    emptyAttendanceSummary,
    matchStaffCandidate,
    normalizeArrivalTime,
    normalizeDocumentDate,
    normalizeHermesAttendanceApplyBody,
    normalizeHermesAttendancePreviewPayload,
    normalizeMatchName,
    previewHermesAttendanceImport
};
