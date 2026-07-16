'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    idempotencyKey,
    isAutomationDue,
    kyivParts,
    normalizeAutomationPayload,
    stableStringify
} = require('../services/hrAttendanceDocumentAutomation');

const ROOT = path.join(__dirname, '..');

function sample(overrides = {}) {
    return {
        name: 'Ранковий лист',
        documentType: 'arrival_inout',
        categoryIds: ['waiter', 'trampoline'],
        weekdays: [1, 2, 3, 4, 5],
        localTime: '08:00',
        copies: 1,
        artifactTtlHours: 168,
        catchUpMinutes: 120,
        enabled: false,
        settings: {
            dailyMode: 'actual_times',
            rosterMode: 'all_eligible',
            locationShift: 'Основна зміна',
            markedBy: '',
            texts: {},
            fontPreset: {}
        },
        ...overrides
    };
}

test('automation contract is deterministic, queue-only and disabled by default', () => {
    const left = normalizeAutomationPayload(sample());
    const right = normalizeAutomationPayload(sample({ categoryIds: ['waiter', 'trampoline'] }));
    assert.equal(left.selectionHash, right.selectionHash);
    assert.equal(left.printerTargetKey, 'queue_only');
    assert.equal(left.templateVersion, 'v27');
    assert.equal(left.enabled, false);
    assert.equal(left.scheduleKind, 'weekly');
    assert.deepEqual(left.weekdays, [1, 2, 3, 4, 5]);
    assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test('month grid is constrained to a first-day schedule', () => {
    const item = normalizeAutomationPayload(sample({
        documentType: 'month_grid',
        categoryIds: ['waiter'],
        weekdays: [2, 7],
        settings: { rosterMode: 'all_eligible' }
    }));
    assert.equal(item.scheduleKind, 'first_day_month');
    assert.deepEqual(item.weekdays, [1]);
});

test('Kyiv due window allows bounded catch-up but rejects evening replay', () => {
    const automation = {
        enabled: true,
        document_type: 'arrival_inout',
        weekdays: [4],
        local_time: '08:00:00',
        catch_up_minutes: 120
    };
    const inside = new Date('2026-07-16T06:00:00.000Z'); // 09:00 Europe/Kyiv, Thursday
    const evening = new Date('2026-07-16T16:00:00.000Z'); // 19:00 Europe/Kyiv
    assert.deepEqual(kyivParts(inside), {
        localDate: '2026-07-16', year: 2026, month: 7, day: 16, weekday: 4, minutes: 540
    });
    assert.equal(isAutomationDue(automation, inside), true);
    assert.equal(isAutomationDue(automation, evening), false);
});

test('idempotency excludes trigger kind and blocks manual/scheduled duplicates', () => {
    const automation = {
        id: 17,
        document_type: 'arrival_inout',
        selection_hash: 'a'.repeat(64)
    };
    assert.equal(idempotencyKey(automation, '2026-07-16'), idempotencyKey(automation, '2026-07-16'));
    assert.notEqual(idempotencyKey(automation, '2026-07-16'), idempotencyKey(automation, '2026-07-17'));
});

test('migration provides DB unique dedup, row locks, leases and artifact TTL fields', () => {
    const migration = fs.readFileSync(path.join(ROOT, 'db/migrations/295_hr_attendance_document_automation.sql'), 'utf8');
    const service = fs.readFileSync(path.join(ROOT, 'services/hrAttendanceDocumentAutomation.js'), 'utf8');
    assert.match(migration, /idempotency_key CHAR\(64\) NOT NULL UNIQUE/);
    assert.match(migration, /locked_until TIMESTAMPTZ/);
    assert.match(migration, /expires_at TIMESTAMPTZ NOT NULL/);
    assert.match(service, /FOR UPDATE SKIP LOCKED/);
    assert.match(service, /SELECT \* FROM hr_attendance_document_automations WHERE id = \$1 FOR UPDATE/);
    assert.match(service, /status='expired', pdf_data=NULL, roster_snapshot=NULL/);
});

test('HR routes keep reads private and mutations behind existing manage_staff action', () => {
    const routes = fs.readFileSync(path.join(ROOT, 'routes/hr.js'), 'utf8');
    assert.match(routes, /router\.use\(requireRole\(\.\.\.HR_VIEW_ROLES\)\)/);
    assert.match(routes, /router\.post\('\/attendance-document-automations', requireHrManage/);
    assert.match(routes, /router\.patch\('\/attendance-document-automations\/:id', requireHrManage/);
    assert.match(routes, /router\.post\('\/attendance-document-automations\/:id\/run', requireHrManage/);
    assert.match(routes, /router\.get\('\/attendance-document-jobs\/:id\/pdf'/);
    assert.match(routes, /Cache-Control': 'no-store, private, max-age=0'/);
});

test('scheduler is registered without guard-level dedup because queue owns it', () => {
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const manifest = fs.readFileSync(path.join(ROOT, 'config/schedulerSurface.js'), 'utf8');
    assert.match(server, /guardScheduler\('checkHrAttendancePrintAutomations', checkHrAttendancePrintAutomations, \{ dedup: null \}\)/);
    assert.match(manifest, /name: 'checkHrAttendancePrintAutomations'.*dedup: null/);
});
