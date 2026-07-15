'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { HERMES_INTEGRATION_ID } = require('../middleware/hermesAuth');
const { buildCapabilitiesPayload } = require('../routes/hermes');
const {
    normalizeHermesSchedulePreviewPayload,
    resolveHermesPreviewStaff
} = require('../services/hermesScheduleImport');
const { scheduleableStaffWhere } = require('../services/staffOperationalFilters');

function sourceReference() {
    return {
        telegram: {
            chatId: 'contract-chat',
            messageId: 'contract-message',
            fileUniqueId: 'contract-file'
        }
    };
}

test('Hermes staff schedule capabilities expose the complete public worker contract', () => {
    const capabilities = buildCapabilitiesPayload({});

    assert.equal(capabilities.integrationId, HERMES_INTEGRATION_ID);
    assert.ok(capabilities.supportedActions.includes('staff.read'));
    assert.ok(capabilities.supportedActions.includes('staff.create'));
    assert.ok(capabilities.supportedActions.includes('staff_schedule.read'));
    assert.ok(capabilities.supportedActions.includes('staff_schedule.preview'));
    assert.ok(capabilities.supportedActions.includes('staff_schedule.apply'));
    assert.ok(capabilities.supportedActions.includes('attendance.preview'));
    assert.ok(capabilities.supportedActions.includes('attendance.apply'));
    assert.deepEqual(capabilities.endpoints.staff, {
        list: 'GET /api/hermes/staff',
        create: 'POST /api/hermes/staff',
        maxLimit: 50,
        pagination: 'cursor',
        defaultScheduleable: true,
        defaultIncludeFreelance: false,
        createRequiresConfirmation: true,
        createRequiresIdempotencyKey: true,
        createRequiresManageStaff: true,
        createScheduleWrites: 0
    });
    assert.deepEqual(capabilities.endpoints.staffSchedule, {
        list: 'GET /api/hermes/staff-schedule',
        preview: 'POST /api/hermes/staff-schedule/preview',
        apply: 'POST /api/hermes/staff-schedule/apply',
        maxDateRangeDays: 31,
        maxPreviewRows: 100,
        previewTtlMinutes: 30,
        businessContext: 'event_genix',
        stateHash: 'sha256',
        previewScheduleWrites: 0,
        applyRequiresConfirmation: true,
        applyRequiresIdempotencyKey: true,
        applyRequiresManageStaff: true
    });
    assert.deepEqual(capabilities.endpoints.attendance, {
        preview: 'POST /api/hermes/attendance/preview',
        apply: 'POST /api/hermes/attendance/apply',
        businessContext: 'event_genix',
        maxPreviewRows: 100,
        previewTtlMinutes: 30,
        previewRequiresManageStaff: true,
        previewAttendanceWrites: 0,
        previewScheduleWrites: 0,
        scheduleWrites: 0,
        applyRequiresConfirmation: true,
        applyRequiresIdempotencyKey: true,
        applyRequiresManageStaff: true,
        applyScheduleWrites: 0
    });
});

test('preview row contract reports invalid date, time, and status without guessing', () => {
    const payload = normalizeHermesSchedulePreviewPayload({
        documentDate: '2026-07-14',
        sourceReference: sourceReference(),
        rows: [{
            employeeName: 'Contract Employee',
            date: 'invalid-date',
            startTime: '25:00',
            endTime: '18:00',
            status: 'holiday',
            confidence: 0.99,
            issues: []
        }]
    });
    const codes = payload.rows[0].validationIssues.map(issue => issue.code);

    assert.ok(codes.includes('HERMES_PREVIEW_DATE_INVALID'));
    assert.ok(codes.includes('HERMES_PREVIEW_TIME_INVALID'));
    assert.ok(codes.includes('HERMES_PREVIEW_STATUS_INVALID'));
    assert.equal(payload.rows[0].normalizedEmployeeName, 'contract employee');
});

test('staff matching is exact, normalized-exact, ambiguity-safe, and scheduleable-only', () => {
    const exact = {
        staffId: 10,
        name: 'Contract Employee',
        scheduleable: true,
        matchType: 'exact'
    };
    const normalized = {
        staffId: 11,
        name: 'CONTRACT EMPLOYEE',
        scheduleable: true,
        matchType: 'normalized_exact'
    };
    assert.deepEqual(resolveHermesPreviewStaff([normalized, exact]), {
        match: exact,
        matchType: 'exact'
    });

    const duplicate = resolveHermesPreviewStaff([exact, { ...exact, staffId: 12 }]);
    assert.equal(duplicate.action, 'ambiguous_staff');
    assert.deepEqual(duplicate.candidates.map(candidate => candidate.staffId), [10, 12]);

    const inactive = { ...exact, staffId: 13, scheduleable: false };
    const missing = resolveHermesPreviewStaff([inactive]);
    assert.equal(missing.action, 'staff_not_found');
    assert.equal(missing.candidate.staffId, 13);
    assert.equal(missing.candidate.scheduleable, false);
});

test('default scheduleable SQL excludes inactive, blacklisted, terminated, and freelance staff', () => {
    const sql = scheduleableStaffWhere('s', { dateExpression: 'requested.schedule_date' });

    assert.match(sql, /s\.is_active = true/);
    assert.match(sql, /COALESCE\(s\.hr_pool_status, 'core'\) = 'core'/);
    assert.match(sql, /s\.termination_date IS NULL/);
    assert.match(sql, /s\.termination_date::date > requested\.schedule_date::date/);
    assert.match(sql, /COALESCE\(s\.is_freelance, false\) = false/);
});

test('worker-facing docs contain schedule endpoints, mandatory apply headers, and stale handling', () => {
    const integration = fs.readFileSync(path.resolve(__dirname, '..', 'docs', 'HERMES_INTEGRATION.md'), 'utf8');
    const worker = fs.readFileSync(path.resolve(__dirname, '..', 'docs', 'HERMES_WORKER_CONTRACT.md'), 'utf8');
    const combined = `${integration}\n${worker}`;

    for (const needle of [
        'GET /api/hermes/staff',
        'POST /api/hermes/staff',
        'GET /api/hermes/staff-schedule',
        'POST /api/hermes/staff-schedule/preview',
        'POST /api/hermes/staff-schedule/apply',
        'X-Hermes-User-Confirmed: true',
        'Idempotency-Key:',
        'X-Integration-Id: hermes-event-genix-crm',
        'Плющкіт вже є в CRM (#<staffId>). Нічого не дублюю.',
        'Плющкіт створено у списку персоналу. Графік не змінювався.',
        'Для графіка не вистачає дати/часу. Напиши, наприклад: сьогодні 10:00–20:00.',
        'HERMES_STAFF_CREATE_SCHEDULE_SEPARATE_APPROVAL_REQUIRED',
        'HERMES_SCHEDULE_APPLY_STALE'
    ]) {
        assert.match(combined, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});
