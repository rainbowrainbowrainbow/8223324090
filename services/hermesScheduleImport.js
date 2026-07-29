'use strict';

const crypto = require('crypto');
const { pool: defaultPool } = require('../db');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');
const { toPostgresDateOnly } = require('./postgresDateOnly');
const {
    normalizeRequestedProfessionKey,
    staffProfessionKeys
} = require('./professions');
const { scheduleableStaffWhere } = require('./staffOperationalFilters');
const {
    lockScheduleStaffRows,
    mutateStaffScheduleBatch,
    validateScheduleMutationTimes,
    validateScheduleWriteStaff
} = require('./staffScheduleMutations');

const HERMES_SCHEDULE_IMPORT_STATUSES = Object.freeze([
    'draft',
    'needs_review',
    'ready',
    'applied',
    'cancelled',
    'expired',
    'failed'
]);
const PREVIEW_EDITABLE_STATUSES = new Set(['draft', 'needs_review']);
const CANCELLABLE_STATUSES = new Set(['draft', 'needs_review', 'ready']);
const DEFAULT_IMPORT_TTL_HOURS = 24;
const HERMES_SCHEDULE_CELL_STATUSES = new Set(['working', 'remote', 'dayoff', 'vacation', 'sick']);
const HERMES_SCHEDULE_PREVIEW_MAX_ROWS = 100;
const HERMES_SCHEDULE_PREVIEW_TTL_MINUTES = 30;
const HERMES_SCHEDULE_PREVIEW_SOURCE = 'hermes_schedule_ocr';
const HERMES_SCHEDULE_PREVIEW_ACTIONS = Object.freeze([
    'create',
    'update',
    'no_change',
    'conflict',
    'staff_not_found',
    'ambiguous_staff',
    'invalid'
]);
const HERMES_SCHEDULE_APPLYABLE_ACTIONS = new Set(['create', 'update', 'no_change', 'conflict']);
const HERMES_SCHEDULE_APPLY_BLOCKED_ACTIONS = new Set(['invalid', 'staff_not_found', 'ambiguous_staff']);
const NON_WORKING_SCHEDULE_STATUSES = new Set(['dayoff', 'vacation', 'sick']);
const WORKING_SCHEDULE_STATUSES = new Set(['working', 'remote']);
const PREVIEW_BODY_BINARY_KEYS = new Set([
    'base64',
    'binary',
    'filebinary',
    'image',
    'imagedata',
    'photo',
    'photobinary'
]);

const FORBIDDEN_REFERENCE_KEYS = new Set([
    'apikey',
    'authorization',
    'base64',
    'binary',
    'botsecret',
    'bottoken',
    'cookie',
    'cookies',
    'headers',
    'image',
    'imagedata',
    'photo',
    'photobinary',
    'rawheaders',
    'secret',
    'telegrambottoken'
]);

function importError(statusCode, code, message, details = undefined) {
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

function normalizeHermesScheduleStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    if (status === 'day_off') return 'dayoff';
    return HERMES_SCHEDULE_CELL_STATUSES.has(status) ? status : 'unknown';
}

function normalizePreviewMatchName(value) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('uk-UA');
}

function normalizePreviewTime(value) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim();
    const match = text.match(/^(\d{2}):([0-5]\d)$/);
    if (!match || Number(match[1]) > 23) return null;
    return text;
}

function previewValidationIssue(code, field, message) {
    return { code, field, message };
}

function normalizePreviewSourceIssues(value, validationIssues) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
        validationIssues.push(previewValidationIssue(
            'HERMES_PREVIEW_ISSUES_INVALID',
            'issues',
            'issues must be an array'
        ));
        return [];
    }
    if (value.length > 20) {
        validationIssues.push(previewValidationIssue(
            'HERMES_PREVIEW_ISSUES_LIMIT',
            'issues',
            'issues supports at most 20 entries'
        ));
    }
    return value.slice(0, 20).map((issue, index) => {
        if (typeof issue === 'string') {
            if (issue.length <= 500) return issue;
        } else if (issue && typeof issue === 'object' && !Array.isArray(issue) && !Buffer.isBuffer(issue)) {
            const code = String(issue.code || '').trim().slice(0, 80) || null;
            const message = String(issue.message || issue.reason || '').trim();
            if (message && message.length <= 500) return { code, message };
        }
        validationIssues.push(previewValidationIssue(
            'HERMES_PREVIEW_ISSUE_INVALID',
            `issues[${index}]`,
            'Each issue must be a string or a code/message object up to 500 characters'
        ));
        return null;
    }).filter(Boolean);
}

function normalizeHermesPreviewRow(value, index) {
    const validationIssues = [];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value)) {
        return {
            rowIndex: index,
            employeeName: '',
            date: null,
            startTime: null,
            endTime: null,
            status: null,
            note: null,
            confidence: null,
            sourceIssues: [],
            validationIssues: [previewValidationIssue(
                'HERMES_PREVIEW_ROW_INVALID',
                `rows[${index}]`,
                'Each row must be an object'
            )]
        };
    }
    for (const key of Object.keys(value)) {
        if (PREVIEW_BODY_BINARY_KEYS.has(normalizeReferenceKey(key))) {
            validationIssues.push(previewValidationIssue(
                'HERMES_SCHEDULE_PREVIEW_BINARY_FORBIDDEN',
                key,
                'OCR rows must not contain photo or image binary'
            ));
        }
    }

    const employeeName = typeof value.employeeName === 'string'
        ? value.employeeName.normalize('NFKC').trim().replace(/\s+/g, ' ')
        : '';
    if (!employeeName || employeeName.length > 160) {
        validationIssues.push(previewValidationIssue(
            'HERMES_PREVIEW_EMPLOYEE_NAME_INVALID',
            'employeeName',
            'employeeName is required and must not exceed 160 characters'
        ));
    }

    let date = null;
    try {
        date = normalizeDocumentDate(value.date);
        if (!date) throw new Error('date required');
    } catch {
        validationIssues.push(previewValidationIssue(
            'HERMES_PREVIEW_DATE_INVALID',
            'date',
            'date must use YYYY-MM-DD'
        ));
    }

    const rawStatus = typeof value.status === 'string' ? value.status.trim().toLowerCase() : '';
    const status = HERMES_SCHEDULE_CELL_STATUSES.has(rawStatus) ? rawStatus : null;
    if (!status) {
        validationIssues.push(previewValidationIssue(
            'HERMES_PREVIEW_STATUS_INVALID',
            'status',
            'status must be working, remote, dayoff, vacation, or sick'
        ));
    }

    const hasStartTime = value.startTime !== undefined && value.startTime !== null && value.startTime !== '';
    const hasEndTime = value.endTime !== undefined && value.endTime !== null && value.endTime !== '';
    const startTime = normalizePreviewTime(value.startTime);
    const endTime = normalizePreviewTime(value.endTime);
    if ((hasStartTime && !startTime) || (hasEndTime && !endTime)) {
        validationIssues.push(previewValidationIssue(
            'HERMES_PREVIEW_TIME_INVALID',
            !startTime && hasStartTime ? 'startTime' : 'endTime',
            'Times must use HH:MM with hours from 00 to 23'
        ));
    }
    if (hasStartTime !== hasEndTime) {
        validationIssues.push(previewValidationIssue(
            'HERMES_PREVIEW_TIME_PAIR_REQUIRED',
            'startTime/endTime',
            'startTime and endTime must be provided together'
        ));
    }
    if (startTime && endTime && startTime === endTime) {
        validationIssues.push(previewValidationIssue(
            'HERMES_PREVIEW_ZERO_LENGTH_SHIFT',
            'startTime/endTime',
            'startTime and endTime must differ'
        ));
    }
    if (status === 'working' && (!startTime || !endTime)) {
        validationIssues.push(previewValidationIssue(
            'HERMES_PREVIEW_WORKING_TIME_REQUIRED',
            'startTime/endTime',
            'working rows require startTime and endTime'
        ));
    }
    if (status && NON_WORKING_SCHEDULE_STATUSES.has(status) && (hasStartTime || hasEndTime)) {
        validationIssues.push(previewValidationIssue(
            'HERMES_PREVIEW_NON_WORKING_TIME_FORBIDDEN',
            'startTime/endTime',
            'dayoff, vacation, and sick rows must not include shift times'
        ));
    }

    let professionKey = null;
    const rawProfessionKey = value.professionKey ?? value.profession_key ?? value.roleType ?? value.role_type;
    if (rawProfessionKey !== undefined && rawProfessionKey !== null && rawProfessionKey !== '') {
        professionKey = normalizeRequestedProfessionKey(rawProfessionKey);
        if (!professionKey) {
            validationIssues.push(previewValidationIssue(
                'HERMES_PREVIEW_PROFESSION_KEY_INVALID',
                'professionKey',
                'professionKey must be a canonical profession key when provided'
            ));
        }
    }

    let note = null;
    if (value.note !== undefined && value.note !== null && value.note !== '') {
        if (typeof value.note !== 'string' || value.note.length > 1000) {
            validationIssues.push(previewValidationIssue(
                'HERMES_PREVIEW_NOTE_INVALID',
                'note',
                'note must be a string up to 1000 characters'
            ));
        } else {
            note = value.note.trim() || null;
        }
    }

    let confidence = null;
    if (value.confidence !== undefined && value.confidence !== null && value.confidence !== '') {
        confidence = Number(value.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
            confidence = null;
            validationIssues.push(previewValidationIssue(
                'HERMES_PREVIEW_CONFIDENCE_INVALID',
                'confidence',
                'confidence must be a number between 0 and 1'
            ));
        }
    }
    const sourceIssues = normalizePreviewSourceIssues(value.issues, validationIssues);

    return {
        rowIndex: index,
        employeeName,
        normalizedEmployeeName: normalizePreviewMatchName(employeeName),
        date,
        startTime,
        endTime,
        status,
        professionKey,
        note,
        confidence,
        sourceIssues,
        validationIssues
    };
}

function normalizeScheduleCellDate(value) {
    return toPostgresDateOnly(value);
}

function normalizeScheduleCellTime(value) {
    if (value === undefined || value === null || value === '') return null;
    return String(value).slice(0, 5);
}

function buildScheduleCellStateHash(cell = {}) {
    return sha256(stableJsonStringify({
        staffId: Number(cell.staffId ?? cell.staff_id) || null,
        date: normalizeScheduleCellDate(cell.date),
        status: normalizeHermesScheduleStatus(cell.status),
        startTime: normalizeScheduleCellTime(cell.startTime ?? cell.start_time ?? cell.shift_start),
        endTime: normalizeScheduleCellTime(cell.endTime ?? cell.end_time ?? cell.shift_end),
        note: cell.note === undefined || cell.note === null ? null : String(cell.note),
        professionKey: cell.professionKey ?? cell.profession_key ?? null
    }));
}

function normalizeReferenceKey(key) {
    return String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isForbiddenReferenceKey(key) {
    const normalized = normalizeReferenceKey(key);
    return FORBIDDEN_REFERENCE_KEYS.has(normalized)
        || normalized.endsWith('token')
        || normalized.endsWith('apikey')
        || normalized.endsWith('binary');
}

function sanitizeSourceReference(value, path = 'sourceReference', seen = new Set()) {
    if (value === undefined) return path === 'sourceReference' ? {} : null;
    if (value === null) return null;
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_SOURCE_SENSITIVE', `${path} must not contain binary data`);
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
        if (seen.has(value)) {
            throw importError(400, 'HERMES_SCHEDULE_IMPORT_SOURCE_INVALID', `${path} contains a circular reference`);
        }
        seen.add(value);
        const sanitized = value.map((item, index) => sanitizeSourceReference(item, `${path}[${index}]`, seen));
        seen.delete(value);
        return sanitized;
    }
    if (typeof value !== 'object') {
        if (typeof value === 'string' && /^data:(?:image\/|application\/octet-stream)[^,]*;base64,/i.test(value.trim())) {
            throw importError(400, 'HERMES_SCHEDULE_IMPORT_SOURCE_SENSITIVE', `${path} must not contain binary data`);
        }
        if (['string', 'number', 'boolean'].includes(typeof value)) return value;
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_SOURCE_INVALID', `${path} contains an unsupported value`);
    }
    if (seen.has(value)) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_SOURCE_INVALID', `${path} contains a circular reference`);
    }
    seen.add(value);
    const sanitized = {};
    for (const [key, item] of Object.entries(value)) {
        if (isForbiddenReferenceKey(key)) {
            throw importError(
                400,
                'HERMES_SCHEDULE_IMPORT_SOURCE_SENSITIVE',
                `${path}.${key} is not allowed in source reference`
            );
        }
        sanitized[key] = sanitizeSourceReference(item, `${path}.${key}`, seen);
    }
    seen.delete(value);
    return sanitized;
}

function normalizeSourceReference(value) {
    const reference = sanitizeSourceReference(value);
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_SOURCE_INVALID', 'sourceReference must be an object');
    }
    return reference;
}

function firstReferenceValue(reference, keys) {
    const scopes = [reference, reference?.telegram].filter(Boolean);
    for (const scope of scopes) {
        for (const key of keys) {
            const value = scope?.[key];
            if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
        }
    }
    return null;
}

function buildSourceDedupeKey(source, sourceReference = {}) {
    const normalizedSource = String(source || '').trim().toLowerCase();
    const reference = normalizeSourceReference(sourceReference);
    if (!Object.keys(reference).length) return null;

    if (normalizedSource.includes('telegram')) {
        const telegramReference = {
            chatId: firstReferenceValue(reference, ['chatId', 'chat_id', 'chat']),
            messageId: firstReferenceValue(reference, ['messageId', 'message_id', 'message']),
            fileId: firstReferenceValue(reference, ['fileUniqueId', 'file_unique_id', 'fileId', 'file_id'])
        };
        if (Object.values(telegramReference).some(Boolean)) {
            return sha256(stableJsonStringify({ source: 'telegram', ...telegramReference }));
        }
    }

    return sha256(stableJsonStringify({ source: normalizedSource, reference }));
}

function normalizeHermesSchedulePreviewPayload(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.isBuffer(input)) {
        throw importError(400, 'HERMES_SCHEDULE_PREVIEW_BODY_INVALID', 'Preview body must be a JSON object');
    }
    for (const key of Object.keys(input)) {
        if (PREVIEW_BODY_BINARY_KEYS.has(normalizeReferenceKey(key))) {
            throw importError(
                400,
                'HERMES_SCHEDULE_PREVIEW_BINARY_FORBIDDEN',
                'Send OCR rows only; photo and image binary are not accepted'
            );
        }
    }
    const documentDate = normalizeDocumentDate(input.documentDate ?? input.document_date);
    if (!documentDate) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_DATE_INVALID', 'documentDate must use YYYY-MM-DD');
    }
    const sourceReference = normalizeSourceReference(input.sourceReference ?? input.source_reference);
    if (!Object.keys(sourceReference).length) {
        throw importError(
            400,
            'HERMES_SCHEDULE_PREVIEW_SOURCE_REFERENCE_REQUIRED',
            'sourceReference must identify the OCR source'
        );
    }
    if (Buffer.byteLength(stableJsonStringify(sourceReference), 'utf8') > 16384) {
        throw importError(
            400,
            'HERMES_SCHEDULE_PREVIEW_SOURCE_REFERENCE_TOO_LARGE',
            'sourceReference must not exceed 16 KB'
        );
    }
    if (!Array.isArray(input.rows)) {
        throw importError(400, 'HERMES_SCHEDULE_PREVIEW_ROWS_INVALID', 'rows must be an array');
    }
    if (input.rows.length > HERMES_SCHEDULE_PREVIEW_MAX_ROWS) {
        throw importError(
            400,
            'HERMES_SCHEDULE_PREVIEW_ROWS_LIMIT',
            `rows supports at most ${HERMES_SCHEDULE_PREVIEW_MAX_ROWS} entries`
        );
    }
    return {
        documentDate,
        sourceReference,
        rows: input.rows.map(normalizeHermesPreviewRow)
    };
}

function mapPreviewStaffCandidate(row = {}) {
    return {
        staffId: Number(row.id),
        name: row.name || '',
        displayName: row.display_name || row.name || '',
        department: row.department || null,
        position: row.position || null,
        professions: staffProfessionKeys(row),
        scheduleable: row.scheduleable === true,
        matchType: row.match_type === 'exact' ? 'exact' : 'normalized_exact'
    };
}

async function loadHermesPreviewStaffCandidates(db, rows) {
    const matchableRows = rows.filter(row => row.validationIssues.length === 0);
    const byRowIndex = new Map();
    if (!matchableRows.length) return byRowIndex;
    const scheduleableSql = scheduleableStaffWhere('s', {
        dateExpression: 'requested.schedule_date',
        includeFreelance: false
    });
    const result = await db.query(
        `WITH requested AS (
             SELECT *
             FROM UNNEST($1::int[], $2::text[], $3::text[], $4::date[])
                  AS source(row_index, employee_name, normalized_name, schedule_date)
         )
         SELECT requested.row_index,
                s.id,
                s.name,
                COALESCE(NULLIF(s.display_name, ''), s.name) AS display_name,
                s.department,
                s.position,
                s.role_type,
                COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                (${scheduleableSql}) AS scheduleable,
                CASE
                    WHEN BTRIM(s.name) = requested.employee_name
                      OR BTRIM(COALESCE(NULLIF(s.display_name, ''), s.name)) = requested.employee_name
                    THEN 'exact'
                    ELSE 'normalized_exact'
                END AS match_type
         FROM requested
         JOIN staff s
           ON LOWER(REGEXP_REPLACE(BTRIM(s.name), '\\s+', ' ', 'g')) = requested.normalized_name
           OR LOWER(REGEXP_REPLACE(BTRIM(COALESCE(NULLIF(s.display_name, ''), s.name)), '\\s+', ' ', 'g')) = requested.normalized_name
         ORDER BY requested.row_index ASC, s.id ASC`,
        [
            matchableRows.map(row => row.rowIndex),
            matchableRows.map(row => row.employeeName),
            matchableRows.map(row => row.normalizedEmployeeName),
            matchableRows.map(row => row.date)
        ]
    );
    for (const candidateRow of result.rows) {
        const rowIndex = Number(candidateRow.row_index);
        if (!byRowIndex.has(rowIndex)) byRowIndex.set(rowIndex, []);
        byRowIndex.get(rowIndex).push(mapPreviewStaffCandidate(candidateRow));
    }
    return byRowIndex;
}

function resolveHermesPreviewStaff(candidates = []) {
    const scheduleable = candidates.filter(candidate => candidate.scheduleable);
    const exact = scheduleable.filter(candidate => candidate.matchType === 'exact');
    if (exact.length === 1) return { match: exact[0], matchType: 'exact' };
    if (exact.length > 1) return { action: 'ambiguous_staff', candidates: exact };

    const normalized = scheduleable.filter(candidate => candidate.matchType === 'normalized_exact');
    if (normalized.length === 1) return { match: normalized[0], matchType: 'normalized_exact' };
    if (normalized.length > 1) return { action: 'ambiguous_staff', candidates: normalized };

    const readOnlyCandidates = candidates
        .filter(candidate => !candidate.scheduleable)
        .sort((left, right) => {
            if (left.matchType === right.matchType) return left.staffId - right.staffId;
            return left.matchType === 'exact' ? -1 : 1;
        });
    return {
        action: 'staff_not_found',
        candidate: readOnlyCandidates[0] || null,
        candidates: readOnlyCandidates
    };
}

async function loadHermesPreviewCurrentStates(db, matchedRows) {
    const byRowIndex = new Map();
    if (!matchedRows.length) return byRowIndex;
    const result = await db.query(
        `WITH requested AS (
             SELECT *
             FROM UNNEST($1::int[], $2::int[], $3::text[])
                  AS source(row_index, staff_id, schedule_date)
         )
         SELECT requested.row_index,
                requested.staff_id,
                requested.schedule_date::text AS requested_date,
                ss.id AS schedule_id,
                ss.status,
                ss.shift_start,
                ss.shift_end,
                ss.note,
                ss.profession_key
         FROM requested
         LEFT JOIN staff_schedule ss
           ON ss.staff_id = requested.staff_id
          AND ss.date = requested.schedule_date
         ORDER BY requested.row_index ASC, ss.id ASC`,
        [
            matchedRows.map(row => row.rowIndex),
            matchedRows.map(row => row.staff.staffId),
            matchedRows.map(row => row.date)
        ]
    );
    for (const stateRow of result.rows) {
        const rowIndex = Number(stateRow.row_index);
        if (!byRowIndex.has(rowIndex)) byRowIndex.set(rowIndex, []);
        if (stateRow.schedule_id === undefined || stateRow.schedule_id === null) continue;
        byRowIndex.get(rowIndex).push({
            scheduleId: Number(stateRow.schedule_id),
            staffId: Number(stateRow.staff_id),
            date: String(stateRow.requested_date || '').slice(0, 10),
            status: normalizeHermesScheduleStatus(stateRow.status),
            startTime: normalizeScheduleCellTime(stateRow.shift_start),
            endTime: normalizeScheduleCellTime(stateRow.shift_end),
            note: stateRow.note || null,
            professionKey: stateRow.profession_key || null
        });
    }
    return byRowIndex;
}

function buildPreviewRowId(sourceDedupeKey, row) {
    return `hsr_${sha256(stableJsonStringify({
        sourceDedupeKey,
        rowIndex: row.rowIndex,
        employeeName: row.employeeName,
        date: row.date
    })).slice(0, 24)}`;
}

function buildMissingScheduleStateHash(staffId, date) {
    return sha256(stableJsonStringify({ staffId: Number(staffId), date, currentState: null }));
}

function comparableScheduleState(state = {}) {
    return {
        staffId: Number(state.staffId),
        date: state.date,
        status: state.status,
        startTime: state.startTime || null,
        endTime: state.endTime || null,
        note: state.note || null,
        professionKey: state.professionKey || null
    };
}

function resolveHermesPreviewStaffDefaultProfessionKey(matchedStaff) {
    const staffProfessions = Array.isArray(matchedStaff?.professions) ? matchedStaff.professions : [];
    return staffProfessions[0] || null;
}

function classifyScheduleTransition(currentState, proposedState) {
    if (!currentState) return { action: 'create', conflictReason: null };
    if (stableJsonStringify(comparableScheduleState(currentState))
        === stableJsonStringify(comparableScheduleState(proposedState))) {
        return { action: 'no_change', conflictReason: null };
    }
    const currentStatus = currentState.status;
    const proposedStatus = proposedState.status;
    if (!HERMES_SCHEDULE_CELL_STATUSES.has(currentStatus)) {
        return { action: 'conflict', conflictReason: 'unknown_current_status' };
    }
    if ((WORKING_SCHEDULE_STATUSES.has(currentStatus) && NON_WORKING_SCHEDULE_STATUSES.has(proposedStatus))
        || (NON_WORKING_SCHEDULE_STATUSES.has(currentStatus) && WORKING_SCHEDULE_STATUSES.has(proposedStatus))) {
        return { action: 'conflict', conflictReason: 'working_non_working_transition' };
    }
    if (NON_WORKING_SCHEDULE_STATUSES.has(currentStatus)
        && NON_WORKING_SCHEDULE_STATUSES.has(proposedStatus)
        && currentStatus !== proposedStatus) {
        return { action: 'conflict', conflictReason: 'non_working_status_change' };
    }
    return { action: 'update', conflictReason: null };
}

function parseStoredJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseStoredJsonObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function summarizePreviewRows(rows = []) {
    const summary = Object.fromEntries(HERMES_SCHEDULE_PREVIEW_ACTIONS.map(action => [action, 0]));
    for (const row of rows) {
        if (Object.hasOwn(summary, row.action)) summary[row.action] += 1;
    }
    return summary;
}

function mapHermesSchedulePreviewResult(result) {
    const importRow = result.import || {};
    const rows = parseStoredJsonArray(importRow.preview_rows ?? importRow.previewRows);
    return {
        success: true,
        importId: importRow.public_id || importRow.publicId || null,
        status: importRow.status || null,
        created: result.created === true,
        replayed: result.created !== true,
        documentDate: normalizeScheduleCellDate(importRow.document_date ?? importRow.documentDate),
        expiresAt: importRow.expires_at instanceof Date
            ? importRow.expires_at.toISOString()
            : (importRow.expires_at ?? importRow.expiresAt ?? null),
        previewHash: importRow.preview_hash ?? importRow.previewHash ?? null,
        rows,
        summary: summarizePreviewRows(rows),
        scheduleWrites: 0
    };
}

async function previewHermesScheduleImport(db = defaultPool, input = {}, options = {}) {
    const payload = normalizeHermesSchedulePreviewPayload(input);
    const businessContext = normalizeBusinessContext(options.businessContext || DEFAULT_BUSINESS_CONTEXT);
    if (businessContext !== DEFAULT_BUSINESS_CONTEXT) {
        throw importError(
            403,
            'HERMES_SCHEDULE_BUSINESS_CONTEXT_UNAVAILABLE',
            'Hermes schedule preview currently supports event_genix only'
        );
    }
    const sourceDedupeKey = buildSourceDedupeKey(HERMES_SCHEDULE_PREVIEW_SOURCE, payload.sourceReference);
    const candidatesByRow = await loadHermesPreviewStaffCandidates(db, payload.rows);
    const resolutions = new Map();
    const matchedRows = [];
    for (const row of payload.rows) {
        if (row.validationIssues.length) continue;
        const resolution = resolveHermesPreviewStaff(candidatesByRow.get(row.rowIndex) || []);
        resolutions.set(row.rowIndex, resolution);
        if (resolution.match) {
            matchedRows.push({ ...row, staff: resolution.match, matchType: resolution.matchType });
        }
    }
    const currentStatesByRow = await loadHermesPreviewCurrentStates(db, matchedRows);
    const targetCounts = new Map();
    for (const matched of matchedRows) {
        const key = `${matched.staff.staffId}:${matched.date}`;
        targetCounts.set(key, (targetCounts.get(key) || 0) + 1);
    }

    const previewRows = payload.rows.map(row => {
        const base = {
            rowId: buildPreviewRowId(sourceDedupeKey, row),
            rowIndex: row.rowIndex,
            employeeName: row.employeeName,
            date: row.date,
            confidence: row.confidence,
            sourceIssues: row.sourceIssues
        };
        if (row.validationIssues.length) {
            return { ...base, action: 'invalid', issues: row.validationIssues };
        }
        const resolution = resolutions.get(row.rowIndex);
        if (!resolution?.match) {
            return {
                ...base,
                action: resolution?.action || 'staff_not_found',
                candidate: resolution?.candidate || null,
                candidates: resolution?.candidates || [],
                issues: [{
                    code: resolution?.action === 'ambiguous_staff'
                        ? 'HERMES_PREVIEW_AMBIGUOUS_STAFF'
                        : 'HERMES_PREVIEW_STAFF_NOT_FOUND',
                    field: 'employeeName',
                    message: resolution?.action === 'ambiguous_staff'
                        ? 'More than one scheduleable exact name match exists'
                        : 'No scheduleable exact or normalized-exact staff match exists'
                }]
            };
        }

        const currentStates = currentStatesByRow.get(row.rowIndex) || [];
        const expectedCurrentState = currentStates[0] || null;
        let proposedState = {
            staffId: resolution.match.staffId,
            date: row.date,
            status: row.status,
            startTime: row.startTime,
            endTime: row.endTime,
            note: row.note,
            professionKey: WORKING_SCHEDULE_STATUSES.has(row.status)
                ? (row.professionKey || expectedCurrentState?.professionKey || null)
                : null
        };
        let classification = classifyScheduleTransition(expectedCurrentState, proposedState);
        let conflictReason = classification.conflictReason;
        if (WORKING_SCHEDULE_STATUSES.has(row.status)
            && !proposedState.professionKey
            && classification.action !== 'no_change') {
            proposedState = {
                ...proposedState,
                professionKey: resolveHermesPreviewStaffDefaultProfessionKey(resolution.match)
            };
        }
        if (WORKING_SCHEDULE_STATUSES.has(row.status)
            && !proposedState.professionKey
            && classification.action !== 'no_change') {
            return {
                ...base,
                action: 'invalid',
                matchType: resolution.matchType,
                matchedStaff: resolution.match,
                issues: [{
                    code: 'HERMES_PREVIEW_PROFESSION_REQUIRED',
                    field: 'professionKey',
                    message: 'Working schedule rows require a primary profession on the row, current schedule state, or staff HR card'
                }]
            };
        }
        const targetKey = `${resolution.match.staffId}:${row.date}`;
        if (currentStates.length > 1) {
            classification = { action: 'conflict' };
            conflictReason = 'multiple_current_rows';
        } else if ((targetCounts.get(targetKey) || 0) > 1) {
            classification = { action: 'conflict' };
            conflictReason = 'duplicate_preview_target';
        }
        return {
            ...base,
            action: classification.action,
            matchType: resolution.matchType,
            matchedStaff: resolution.match,
            proposedState,
            expectedCurrentState,
            stateHash: expectedCurrentState
                ? buildScheduleCellStateHash(expectedCurrentState)
                : buildMissingScheduleStateHash(resolution.match.staffId, row.date),
            conflictReason,
            issues: conflictReason ? [{
                code: `HERMES_PREVIEW_${conflictReason.toUpperCase()}`,
                field: 'status',
                message: 'Proposed schedule state requires explicit review'
            }] : []
        };
    });
    const currentStateSnapshot = previewRows
        .filter(row => row.proposedState)
        .map(row => ({
            rowId: row.rowId,
            staffId: row.proposedState.staffId,
            date: row.proposedState.date,
            expectedCurrentState: row.expectedCurrentState,
            stateHash: row.stateHash
        }));
    const requiresReview = previewRows.some(row => [
        'conflict',
        'staff_not_found',
        'ambiguous_staff',
        'invalid'
    ].includes(row.action));
    const created = await createHermesScheduleImport(db, {
        source: HERMES_SCHEDULE_PREVIEW_SOURCE,
        sourceReference: payload.sourceReference,
        businessContext,
        status: requiresReview ? 'needs_review' : 'ready',
        documentDate: payload.documentDate,
        extractedRows: payload.rows,
        previewRows,
        currentStateSnapshot,
        ttlHours: HERMES_SCHEDULE_PREVIEW_TTL_MINUTES / 60,
        createdByUserId: options.actorUserId
    });
    return mapHermesSchedulePreviewResult(created);
}

function normalizeRows(value, fieldName) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_ROWS_INVALID', `${fieldName} must be an array`);
    }
    return value.map((row, index) => sanitizeSourceReference(row, `${fieldName}[${index}]`));
}

function normalizeDocumentDate(value) {
    if (value === undefined || value === null || value === '') return null;
    const normalized = value instanceof Date ? toPostgresDateOnly(value) : String(value).trim();
    const parsed = new Date(`${normalized}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)
        || Number.isNaN(parsed.getTime())
        || parsed.toISOString().slice(0, 10) !== normalized) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_DATE_INVALID', 'documentDate must use YYYY-MM-DD');
    }
    return normalized;
}

function buildPreviewHash(input = {}) {
    return sha256(stableJsonStringify({
        documentDate: normalizeDocumentDate(input.documentDate ?? input.document_date),
        extractedRows: normalizeRows(input.extractedRows ?? input.extracted_rows, 'extractedRows'),
        previewRows: normalizeRows(input.previewRows ?? input.preview_rows, 'previewRows'),
        currentStateSnapshot: normalizeRows(
            input.currentStateSnapshot ?? input.current_state_snapshot,
            'currentStateSnapshot'
        )
    }));
}

function normalizePublicId(value) {
    const publicId = String(value || '').trim();
    if (!/^hsi_[a-z0-9-]{16,72}$/.test(publicId)) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_ID_INVALID', 'Invalid Hermes schedule import public id');
    }
    return publicId;
}

function normalizeUserId(value) {
    if (value === undefined || value === null || value === '') return null;
    const userId = Number(value);
    if (!Number.isInteger(userId) || userId <= 0) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_ACTOR_INVALID', 'Actor user id must be a positive integer');
    }
    return userId;
}

function normalizeExpiry(value, ttlHours = DEFAULT_IMPORT_TTL_HOURS) {
    const expiresAt = value ? new Date(value) : new Date(Date.now() + Number(ttlHours) * 60 * 60 * 1000);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_EXPIRY_INVALID', 'expiresAt must be in the future');
    }
    return expiresAt.toISOString();
}

function normalizeCreateStatus(value) {
    const status = String(value || 'draft').trim().toLowerCase();
    if (!['draft', 'needs_review', 'ready'].includes(status)) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_STATUS_INVALID', 'New import status must be draft, needs_review, or ready');
    }
    return status;
}

function normalizeScheduleApplyRowIds(value, fieldName, options = {}) {
    if (value === undefined && options.optional === true) return [];
    if (!Array.isArray(value)) {
        throw importError(400, 'HERMES_SCHEDULE_APPLY_BODY_INVALID', `${fieldName} must be an array`);
    }
    if ((!value.length && options.optional !== true) || value.length > HERMES_SCHEDULE_PREVIEW_MAX_ROWS) {
        throw importError(
            400,
            'HERMES_SCHEDULE_APPLY_BODY_INVALID',
            `${fieldName} must contain between 1 and ${HERMES_SCHEDULE_PREVIEW_MAX_ROWS} rowIds`
        );
    }
    const rowIds = [];
    const seen = new Set();
    for (const item of value) {
        const rowId = String(item || '').trim();
        if (!/^hsr_[a-f0-9]{24}$/.test(rowId)) {
            throw importError(400, 'HERMES_SCHEDULE_APPLY_ROW_ID_INVALID', `${fieldName} contains an invalid rowId`);
        }
        if (seen.has(rowId)) {
            throw importError(400, 'HERMES_SCHEDULE_APPLY_ROW_ID_DUPLICATE', `${fieldName} contains duplicate rowIds`);
        }
        seen.add(rowId);
        rowIds.push(rowId);
    }
    return rowIds;
}

function normalizeHermesScheduleApplyBody(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.isBuffer(input)) {
        throw importError(400, 'HERMES_SCHEDULE_APPLY_BODY_INVALID', 'Apply body must be a JSON object');
    }
    const allowedKeys = new Set(['previewId', 'selectedRowIds', 'conflictConfirmed']);
    const unknownKeys = Object.keys(input).filter(key => !allowedKeys.has(key));
    if (unknownKeys.length) {
        throw importError(
            400,
            'HERMES_SCHEDULE_APPLY_BODY_FIELDS_INVALID',
            `Apply body contains unsupported fields: ${unknownKeys.join(', ')}`
        );
    }
    const previewId = normalizePublicId(input.previewId);
    const selectedRowIds = normalizeScheduleApplyRowIds(input.selectedRowIds, 'selectedRowIds');
    const conflictConfirmed = normalizeScheduleApplyRowIds(
        input.conflictConfirmed,
        'conflictConfirmed',
        { optional: true }
    );
    const selectedSet = new Set(selectedRowIds);
    if (conflictConfirmed.some(rowId => !selectedSet.has(rowId))) {
        throw importError(
            400,
            'HERMES_SCHEDULE_APPLY_CONFLICT_CONFIRMATION_INVALID',
            'conflictConfirmed rowIds must also be selected'
        );
    }
    return { previewId, selectedRowIds, conflictConfirmed };
}

async function getHermesScheduleImportForUpdate(db, publicId, businessContext) {
    const result = await db.query(
        `SELECT *
         FROM hermes_schedule_imports
         WHERE public_id = $1
           AND business_context = $2
         LIMIT 1
         FOR UPDATE`,
        [normalizePublicId(publicId), normalizeBusinessContext(businessContext)]
    );
    return result.rows[0] || null;
}

function normalizeStoredProposedState(row) {
    const state = row?.proposedState;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw importError(
            409,
            'HERMES_SCHEDULE_APPLY_PREVIEW_INVALID',
            `Stored preview row ${row?.rowId || ''} has no proposed state`
        );
    }
    const staffId = Number(state.staffId);
    const date = normalizeDocumentDate(state.date);
    const status = normalizeHermesScheduleStatus(state.status);
    const startTime = normalizeScheduleCellTime(state.startTime);
    const endTime = normalizeScheduleCellTime(state.endTime);
    const note = state.note === undefined || state.note === null ? null : String(state.note);
    if (!Number.isInteger(staffId) || staffId <= 0 || !date || !HERMES_SCHEDULE_CELL_STATUSES.has(status)) {
        throw importError(
            409,
            'HERMES_SCHEDULE_APPLY_PREVIEW_INVALID',
            `Stored preview row ${row?.rowId || ''} has an invalid proposed state`
        );
    }
    const timeValidation = validateScheduleMutationTimes({ startTime, endTime }, status);
    const storedTimesInvalid = (status === 'working' && (!startTime || !endTime))
        || (NON_WORKING_SCHEDULE_STATUSES.has(status) && (startTime || endTime));
    if (!timeValidation.ok || storedTimesInvalid) {
        throw importError(
            409,
            'HERMES_SCHEDULE_APPLY_PREVIEW_INVALID',
            `Stored preview row ${row?.rowId || ''} has invalid times`,
            { rowId: row?.rowId || null, reason: timeValidation.code }
        );
    }
    return {
        staffId,
        date,
        status,
        startTime,
        endTime,
        note,
        professionKey: state.professionKey || null
    };
}

async function loadHermesScheduleStatesForApply(db, selectedRows) {
    const result = await db.query(
        `WITH requested AS (
             SELECT *
             FROM UNNEST($1::int[], $2::text[])
                  AS source(staff_id, schedule_date)
         )
         SELECT ss.id AS schedule_id,
                ss.staff_id,
                ss.date::text AS date,
                ss.status,
                ss.shift_start,
                ss.shift_end,
                ss.note,
                ss.profession_key
         FROM staff_schedule ss
         JOIN requested
           ON requested.staff_id = ss.staff_id
          AND requested.schedule_date = ss.date
         ORDER BY ss.staff_id ASC, ss.date ASC, ss.id ASC
         FOR UPDATE OF ss`,
        [
            selectedRows.map(row => row.proposedState.staffId),
            selectedRows.map(row => row.proposedState.date)
        ]
    );
    const states = new Map();
    for (const stateRow of result.rows) {
        const key = `${Number(stateRow.staff_id)}:${String(stateRow.date || '').slice(0, 10)}`;
        if (!states.has(key)) states.set(key, []);
        states.get(key).push({
            scheduleId: Number(stateRow.schedule_id),
            staffId: Number(stateRow.staff_id),
            date: String(stateRow.date || '').slice(0, 10),
            status: normalizeHermesScheduleStatus(stateRow.status),
            startTime: normalizeScheduleCellTime(stateRow.shift_start),
            endTime: normalizeScheduleCellTime(stateRow.shift_end),
            note: stateRow.note || null,
            professionKey: stateRow.profession_key || null
        });
    }
    return states;
}

async function sealHermesScheduleImportReady(db, importRow) {
    if (importRow.status === 'ready') return importRow;
    const result = await db.query(
        `UPDATE hermes_schedule_imports
         SET status = 'ready'
         WHERE public_id = $1
           AND status = 'needs_review'
           AND preview_hash = $2
           AND expires_at > NOW()
         RETURNING *`,
        [importRow.public_id, importRow.preview_hash]
    );
    if (!result.rows[0]) {
        throw importError(409, 'HERMES_SCHEDULE_APPLY_PREVIEW_LOCKED', 'Preview could not be sealed for apply');
    }
    return result.rows[0];
}

async function applyHermesScheduleImport(db = defaultPool, input = {}, options = {}) {
    const request = normalizeHermesScheduleApplyBody(input);
    const businessContext = normalizeBusinessContext(options.businessContext || DEFAULT_BUSINESS_CONTEXT);
    const importRow = await getHermesScheduleImportForUpdate(db, request.previewId, businessContext);
    if (!importRow) {
        throw importError(404, 'HERMES_SCHEDULE_IMPORT_NOT_FOUND', 'Hermes schedule preview was not found');
    }
    if (importRow.status === 'applied') {
        throw importError(409, 'HERMES_SCHEDULE_IMPORT_ALREADY_APPLIED', 'Hermes schedule preview is already applied');
    }
    if (['cancelled', 'expired', 'failed'].includes(importRow.status)) {
        throw importError(
            409,
            'HERMES_SCHEDULE_APPLY_PREVIEW_UNAVAILABLE',
            `Hermes schedule preview cannot be applied from status ${importRow.status}`
        );
    }
    if (!['ready', 'needs_review'].includes(importRow.status)) {
        throw importError(409, 'HERMES_SCHEDULE_APPLY_PREVIEW_NOT_READY', 'Hermes schedule preview is not ready for apply');
    }
    if (!importRow.preview_hash || !/^[a-f0-9]{64}$/.test(String(importRow.preview_hash))) {
        throw importError(409, 'HERMES_SCHEDULE_APPLY_PREVIEW_INVALID', 'Hermes schedule preview has no immutable hash');
    }
    const expiresAt = new Date(importRow.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        throw importError(409, 'HERMES_SCHEDULE_APPLY_PREVIEW_EXPIRED', 'Hermes schedule preview has expired');
    }

    const previewRows = parseStoredJsonArray(importRow.preview_rows);
    const rowsById = new Map(previewRows.map(row => [row.rowId, row]));
    const confirmedConflicts = new Set(request.conflictConfirmed);
    const selectedRows = request.selectedRowIds.map(rowId => {
        const row = rowsById.get(rowId);
        if (!row) {
            throw importError(
                409,
                'HERMES_SCHEDULE_APPLY_ROW_NOT_FOUND',
                `Selected row ${rowId} does not exist in the immutable preview`
            );
        }
        if (HERMES_SCHEDULE_APPLY_BLOCKED_ACTIONS.has(row.action)) {
            throw importError(
                409,
                'HERMES_SCHEDULE_APPLY_ROW_BLOCKED',
                `Selected row ${rowId} cannot be applied from action ${row.action}`,
                { rowId, action: row.action }
            );
        }
        if (!HERMES_SCHEDULE_APPLYABLE_ACTIONS.has(row.action)) {
            throw importError(
                409,
                'HERMES_SCHEDULE_APPLY_ROW_INVALID',
                `Selected row ${rowId} has an unsupported preview action`
            );
        }
        if (row.action === 'conflict' && !confirmedConflicts.has(rowId)) {
            throw importError(
                409,
                'HERMES_SCHEDULE_APPLY_CONFLICT_CONFIRMATION_REQUIRED',
                `Conflict row ${rowId} requires explicit confirmation`,
                { rowId }
            );
        }
        const proposedState = normalizeStoredProposedState(row);
        const stateHash = String(row.stateHash || '').trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(stateHash)) {
            throw importError(409, 'HERMES_SCHEDULE_APPLY_PREVIEW_INVALID', `Selected row ${rowId} has no stateHash`);
        }
        return { ...row, proposedState, stateHash };
    });

    const targetKeys = new Set();
    for (const row of selectedRows) {
        const key = `${row.proposedState.staffId}:${row.proposedState.date}`;
        if (targetKeys.has(key)) {
            throw importError(
                409,
                'HERMES_SCHEDULE_APPLY_DUPLICATE_TARGET',
                `Selected rows contain duplicate target ${key}`
            );
        }
        targetKeys.add(key);
    }

    await lockScheduleStaffRows(db, selectedRows.map(row => row.proposedState.staffId));
    const currentStates = await loadHermesScheduleStatesForApply(db, selectedRows);
    for (const row of selectedRows) {
        const { staffId, date } = row.proposedState;
        const staffValidation = await validateScheduleWriteStaff(db, staffId, date, { forUpdate: false });
        if (!staffValidation.ok) {
            throw importError(
                409,
                'HERMES_SCHEDULE_APPLY_STAFF_NOT_SCHEDULEABLE',
                `Staff ${staffId} is no longer scheduleable for ${date}`,
                { rowId: row.rowId, staffId, date, reason: staffValidation.code }
            );
        }
        const states = currentStates.get(`${staffId}:${date}`) || [];
        if (states.length > 1) {
            throw importError(
                409,
                'HERMES_SCHEDULE_APPLY_STALE',
                `Current schedule state is ambiguous for ${staffId}/${date}`,
                { rowId: row.rowId, staffId, date }
            );
        }
        const currentState = states[0] || null;
        const currentHash = currentState
            ? buildScheduleCellStateHash(currentState)
            : buildMissingScheduleStateHash(staffId, date);
        if (currentHash !== row.stateHash) {
            throw importError(
                409,
                'HERMES_SCHEDULE_APPLY_STALE',
                `Current schedule state changed for ${staffId}/${date}`,
                { rowId: row.rowId, staffId, date }
            );
        }
    }

    const sealedImport = await sealHermesScheduleImportReady(db, importRow);
    const mutationRows = selectedRows.filter(row => row.action !== 'no_change');
    const batch = await mutateStaffScheduleBatch(
        db,
        mutationRows.map(row => ({
            ...row.proposedState,
            rowId: row.rowId,
            action: row.action
        })),
        {
            actor: options.actor,
            source: 'hermes.schedule_ocr',
            auditAction: 'staff_schedule_hermes_apply',
            sourceMetadata: {
                previewId: request.previewId,
                documentDate: normalizeScheduleCellDate(importRow.document_date),
                integrationId: options.integrationId || 'hermes-event-genix-crm',
                batchSize: mutationRows.length
            },
            sourceMetadataForEntry: entry => ({ rowId: entry.rowId }),
            staffRowsLocked: true,
            loadEnriched: false,
            auditWithEnriched: false
        }
    );
    if (!batch.ok) {
        throw importError(
            500,
            'HERMES_SCHEDULE_APPLY_TRANSACTION_FAILED',
            batch.error || 'A selected schedule row could not be applied',
            { failedEntry: batch.failedEntry || null, reason: batch.code || null }
        );
    }

    const response = {
        success: true,
        previewId: request.previewId,
        status: 'applied',
        selectedCount: selectedRows.length,
        appliedCount: batch.count,
        noChangeCount: selectedRows.length - batch.count,
        scheduleWrites: batch.count,
        dates: batch.dates,
        results: selectedRows.map(row => ({
            rowId: row.rowId,
            previewAction: row.action,
            result: row.action === 'no_change' ? 'no_change' : 'applied',
            staffId: row.proposedState.staffId,
            date: row.proposedState.date,
            status: row.proposedState.status
        }))
    };
    try {
        await markHermesScheduleImportApplied(db, request.previewId, {
            previewHash: sealedImport.preview_hash,
            appliedByUserId: options.actorUserId,
            applyResult: response
        });
    } catch (error) {
        if (error.statusCode && error.statusCode < 500) {
            throw importError(
                500,
                'HERMES_SCHEDULE_APPLY_FINALIZE_FAILED',
                'Schedule changes could not be finalized atomically'
            );
        }
        throw error;
    }
    return { response, changes: batch.changes, dates: batch.dates };
}

async function createHermesScheduleImport(db = defaultPool, input = {}) {
    const source = String(input.source || '').trim().toLowerCase();
    if (!source) throw importError(400, 'HERMES_SCHEDULE_IMPORT_SOURCE_REQUIRED', 'source is required');
    const sourceReference = normalizeSourceReference(input.sourceReference ?? input.source_reference);
    const businessContext = normalizeBusinessContext(
        input.businessContext ?? input.business_context ?? DEFAULT_BUSINESS_CONTEXT
    );
    const status = normalizeCreateStatus(input.status);
    const documentDate = normalizeDocumentDate(input.documentDate ?? input.document_date);
    const extractedRows = normalizeRows(input.extractedRows ?? input.extracted_rows, 'extractedRows');
    const previewRows = normalizeRows(input.previewRows ?? input.preview_rows, 'previewRows');
    const currentStateSnapshot = normalizeRows(
        input.currentStateSnapshot ?? input.current_state_snapshot,
        'currentStateSnapshot'
    );
    const previewHash = status === 'ready' || extractedRows.length || previewRows.length || currentStateSnapshot.length
        ? buildPreviewHash({ documentDate, extractedRows, previewRows, currentStateSnapshot })
        : null;
    const sourceDedupeKey = buildSourceDedupeKey(source, sourceReference);
    const publicId = `hsi_${crypto.randomUUID()}`;
    const params = [
        publicId,
        businessContext,
        status,
        source,
        JSON.stringify(sourceReference),
        sourceDedupeKey,
        documentDate,
        JSON.stringify(extractedRows),
        JSON.stringify(previewRows),
        JSON.stringify(currentStateSnapshot),
        previewHash,
        normalizeExpiry(input.expiresAt ?? input.expires_at, input.ttlHours),
        normalizeUserId(input.createdByUserId ?? input.created_by_user_id)
    ];

    const inserted = await db.query(
        `INSERT INTO hermes_schedule_imports (
             public_id, business_context, status, source, source_reference,
             source_dedupe_key, document_date, extracted_rows, preview_rows,
             current_state_snapshot, preview_hash, expires_at, created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13)
         ON CONFLICT (business_context, source_dedupe_key)
             WHERE source_dedupe_key IS NOT NULL
         DO NOTHING
         RETURNING *`,
        params
    );
    if (inserted.rows.length) return { created: true, import: inserted.rows[0] };

    const existing = await db.query(
        `SELECT *
         FROM hermes_schedule_imports
         WHERE business_context = $1
           AND source_dedupe_key = $2
         LIMIT 1`,
        [businessContext, sourceDedupeKey]
    );
    if (!existing.rows[0]) {
        throw importError(409, 'HERMES_SCHEDULE_IMPORT_DEDUPE_RACE', 'Import source is being registered; retry safely');
    }
    return { created: false, import: existing.rows[0] };
}

async function getHermesScheduleImport(db = defaultPool, publicId, options = {}) {
    const params = [normalizePublicId(publicId)];
    let contextFilter = '';
    if (options.businessContext || options.business_context) {
        params.push(normalizeBusinessContext(options.businessContext ?? options.business_context));
        contextFilter = ' AND business_context = $2';
    }
    const result = await db.query(
        `SELECT * FROM hermes_schedule_imports WHERE public_id = $1${contextFilter} LIMIT 1`,
        params
    );
    return result.rows[0] || null;
}

async function saveHermesScheduleImportPreview(db = defaultPool, publicId, input = {}) {
    const status = String(input.status || 'needs_review').trim().toLowerCase();
    if (!['needs_review', 'ready'].includes(status)) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_STATUS_INVALID', 'Preview status must be needs_review or ready');
    }
    const documentDate = normalizeDocumentDate(input.documentDate ?? input.document_date);
    const extractedRows = normalizeRows(input.extractedRows ?? input.extracted_rows, 'extractedRows');
    const previewRows = normalizeRows(input.previewRows ?? input.preview_rows, 'previewRows');
    const currentStateSnapshot = normalizeRows(
        input.currentStateSnapshot ?? input.current_state_snapshot,
        'currentStateSnapshot'
    );
    const previewHash = buildPreviewHash({ documentDate, extractedRows, previewRows, currentStateSnapshot });
    const result = await db.query(
        `UPDATE hermes_schedule_imports
         SET document_date = $2,
             extracted_rows = $3::jsonb,
             preview_rows = $4::jsonb,
             current_state_snapshot = $5::jsonb,
             preview_hash = $6,
             status = $7,
             error_message = NULL
         WHERE public_id = $1
           AND status = ANY($8::varchar[])
           AND expires_at > NOW()
         RETURNING *`,
        [
            normalizePublicId(publicId),
            documentDate,
            JSON.stringify(extractedRows),
            JSON.stringify(previewRows),
            JSON.stringify(currentStateSnapshot),
            previewHash,
            status,
            [...PREVIEW_EDITABLE_STATUSES]
        ]
    );
    if (!result.rows[0]) {
        throw importError(409, 'HERMES_SCHEDULE_IMPORT_PREVIEW_LOCKED', 'Import preview is expired, missing, or immutable');
    }
    return result.rows[0];
}

async function expireHermesScheduleImports(db = defaultPool, options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    if (Number.isNaN(now.getTime())) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_EXPIRY_INVALID', 'Invalid expiry timestamp');
    }
    const result = await db.query(
        `UPDATE hermes_schedule_imports
         SET status = 'expired'
         WHERE status = ANY($1::varchar[])
           AND expires_at <= $2
         RETURNING *`,
        [[...CANCELLABLE_STATUSES], now.toISOString()]
    );
    return result.rows;
}

async function markHermesScheduleImportApplied(db = defaultPool, publicId, input = {}) {
    const previewHash = String(input.previewHash ?? input.preview_hash ?? '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(previewHash)) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_HASH_REQUIRED', 'A valid previewHash is required for apply');
    }
    const applyResult = input.applyResult ?? input.apply_result;
    if (!applyResult || typeof applyResult !== 'object' || Array.isArray(applyResult) || Buffer.isBuffer(applyResult)) {
        throw importError(400, 'HERMES_SCHEDULE_IMPORT_APPLY_RESULT_INVALID', 'applyResult must be an object');
    }
    const result = await db.query(
        `UPDATE hermes_schedule_imports
         SET status = 'applied',
             applied_by_user_id = $3,
             apply_result = $4::jsonb,
             applied_at = NOW(),
             error_message = NULL
         WHERE public_id = $1
           AND status = 'ready'
           AND preview_hash = $2
           AND expires_at > NOW()
         RETURNING *`,
        [
            normalizePublicId(publicId),
            previewHash,
            normalizeUserId(input.appliedByUserId ?? input.applied_by_user_id),
            JSON.stringify(sanitizeSourceReference(applyResult, 'applyResult'))
        ]
    );
    if (!result.rows[0]) {
        throw importError(409, 'HERMES_SCHEDULE_IMPORT_APPLY_CONFLICT', 'Import is not ready, expired, missing, or preview hash changed');
    }
    return result.rows[0];
}

async function cancelHermesScheduleImport(db = defaultPool, publicId, input = {}) {
    const result = await db.query(
        `UPDATE hermes_schedule_imports
         SET status = 'cancelled',
             error_message = $2
         WHERE public_id = $1
           AND status = ANY($3::varchar[])
         RETURNING *`,
        [
            normalizePublicId(publicId),
            input.reason ? String(input.reason).trim().slice(0, 2000) : null,
            [...CANCELLABLE_STATUSES]
        ]
    );
    if (!result.rows[0]) {
        throw importError(409, 'HERMES_SCHEDULE_IMPORT_CANCEL_CONFLICT', 'Import cannot be cancelled from its current status');
    }
    return result.rows[0];
}

module.exports = {
    DEFAULT_IMPORT_TTL_HOURS,
    HERMES_SCHEDULE_IMPORT_STATUSES,
    HERMES_SCHEDULE_PREVIEW_ACTIONS,
    HERMES_SCHEDULE_PREVIEW_MAX_ROWS,
    HERMES_SCHEDULE_PREVIEW_TTL_MINUTES,
    applyHermesScheduleImport,
    buildPreviewHash,
    buildPreviewRowId,
    buildScheduleCellStateHash,
    buildSourceDedupeKey,
    cancelHermesScheduleImport,
    createHermesScheduleImport,
    expireHermesScheduleImports,
    getHermesScheduleImport,
    getHermesScheduleImportForUpdate,
    markHermesScheduleImportApplied,
    normalizeHermesScheduleStatus,
    normalizeHermesScheduleApplyBody,
    normalizeHermesSchedulePreviewPayload,
    previewHermesScheduleImport,
    resolveHermesPreviewStaff,
    sanitizeSourceReference,
    saveHermesScheduleImportPreview,
    stableJsonStringify
};
