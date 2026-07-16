'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    CONTRACT_VERSION,
    DOCUMENT_TEXT_DEFAULTS,
    LEGACY_DOCUMENT_TEXT_DEFAULTS
} = require('../services/hrAttendanceDocuments');
const {
    TEMPLATE_VERSION,
    enqueueAutomationJob,
    idempotencyKey,
    isAutomationDue,
    kyivParts,
    normalizeAutomationPayload,
    processBuildJobs,
    requeueJob,
    requestFromAutomation,
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
    assert.equal(CONTRACT_VERSION, 'v27.2');
    assert.equal(TEMPLATE_VERSION, CONTRACT_VERSION);
    assert.equal(left.templateVersion, CONTRACT_VERSION);
    assert.equal(left.enabled, false);
    assert.equal(left.scheduleKind, 'weekly');
    assert.deepEqual(left.weekdays, [1, 2, 3, 4, 5]);
    assert.equal(left.settings.fontPreset.title, 14);
    assert.equal(left.settings.fontPreset.dailyEmployee, 15);
    assert.equal(Object.hasOwn(left.settings.fontPreset, 'values'), false);
    assert.doesNotThrow(() => normalizeAutomationPayload({
        ...sample(),
        settings: left.settings
    }));
    assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test('automation boundary upgrades only exact legacy defaults and preserves custom text', () => {
    const legacy = LEGACY_DOCUMENT_TEXT_DEFAULTS.month_grid;
    const current = DOCUMENT_TEXT_DEFAULTS.month_grid;
    const upgraded = normalizeAutomationPayload(sample({
        documentType: 'month_grid',
        categoryIds: ['waiter'],
        settings: {
            rosterMode: 'all_eligible',
            texts: {
                monthlyInstruction: legacy.monthlyInstruction,
                footerNote: legacy.footerNote
            }
        }
    }));
    assert.equal(upgraded.settings.texts.monthlyInstruction, current.monthlyInstruction);
    assert.equal(upgraded.settings.texts.footerNote, current.footerNote);

    const upgradedDaily = normalizeAutomationPayload(sample({
        settings: {
            dailyMode: 'actual_times',
            rosterMode: 'all_eligible',
            texts: { footerNote: LEGACY_DOCUMENT_TEXT_DEFAULTS.arrival_inout.footerNote }
        }
    }));
    assert.equal(upgradedDaily.settings.texts.footerNote, DOCUMENT_TEXT_DEFAULTS.arrival_inout.footerNote);

    const custom = normalizeAutomationPayload(sample({
        documentType: 'month_grid',
        categoryIds: ['waiter'],
        settings: {
            rosterMode: 'all_eligible',
            texts: {
                monthlyInstruction: 'Моя інструкція',
                footerNote: 'Мій нижній колонтитул'
            }
        }
    }));
    assert.equal(custom.settings.texts.monthlyInstruction, 'Моя інструкція');
    assert.equal(custom.settings.texts.footerNote, 'Мій нижній колонтитул');

    const nearMatch = normalizeAutomationPayload(sample({
        documentType: 'month_grid',
        categoryIds: ['waiter'],
        settings: {
            rosterMode: 'all_eligible',
            texts: { footerNote: `${legacy.footerNote} ` }
        }
    }));
    assert.equal(nearMatch.settings.texts.footerNote, legacy.footerNote, 'non-exact input is normalized but not upgraded');
});

test('runtime request maps an untouched legacy automation without mutating stored settings', () => {
    const legacy = LEGACY_DOCUMENT_TEXT_DEFAULTS.month_grid;
    const automation = {
        document_type: 'month_grid',
        category_ids: ['waiter'],
        settings_json: {
            rosterMode: 'all_eligible',
            texts: {
                monthlyInstruction: legacy.monthlyInstruction,
                footerNote: legacy.footerNote
            }
        }
    };
    const before = structuredClone(automation);
    const request = requestFromAutomation(automation, '2026-07-01');
    assert.equal(request.texts.monthlyInstruction, DOCUMENT_TEXT_DEFAULTS.month_grid.monthlyInstruction);
    assert.equal(request.texts.footerNote, DOCUMENT_TEXT_DEFAULTS.month_grid.footerNote);
    assert.deepEqual(automation, before);
});

test('enqueue snapshots an old automation with the effective v27.2 contract', async () => {
    const legacy = LEGACY_DOCUMENT_TEXT_DEFAULTS.month_grid;
    const storedAutomation = {
        id: 17,
        name: 'Старий місячний табель',
        document_type: 'month_grid',
        category_ids: ['waiter'],
        weekdays: [1],
        local_time: '08:00:00',
        copies: 1,
        settings_json: {
            rosterMode: 'all_eligible',
            texts: {
                monthlyInstruction: legacy.monthlyInstruction,
                footerNote: legacy.footerNote
            },
            fontPreset: {}
        },
        selection_hash: 'a'.repeat(64),
        template_version: 'v27',
        artifact_ttl_hours: 168,
        catch_up_minutes: 120,
        enabled: true
    };
    let insertParams = null;
    const client = {
        async query(sql, params = []) {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.includes('SELECT * FROM hr_attendance_document_automations')) {
                return { rows: [storedAutomation] };
            }
            if (sql.includes('INSERT INTO hr_attendance_document_jobs')) {
                insertParams = params;
                return {
                    rows: [{
                        id: 91,
                        automation_id: storedAutomation.id,
                        trigger_kind: 'manual',
                        local_date: params[2],
                        document_type: params[3],
                        status: 'building',
                        template_version: params[7],
                        pdf_byte_length: null,
                        filename: null,
                        copies: params[8],
                        printer_target_key: 'queue_only',
                        attempts: 0,
                        requeue_count: 0
                    }]
                };
            }
            throw new Error(`Unexpected query: ${sql}`);
        },
        release() {}
    };
    const db = {
        async connect() {
            return client;
        },
        async query(sql) {
            throw new Error(`Unexpected pool query: ${sql}`);
        }
    };
    await enqueueAutomationJob(17, 'manual', {}, {
        now: new Date('2026-07-01T05:00:00.000Z'),
        localDate: '2026-07-01'
    }, db);
    assert.ok(insertParams);
    const request = JSON.parse(insertParams[6]);
    assert.equal(insertParams[7], CONTRACT_VERSION);
    assert.notEqual(insertParams[4], storedAutomation.selection_hash);
    assert.equal(request.texts.monthlyInstruction, DOCUMENT_TEXT_DEFAULTS.month_grid.monthlyInstruction);
    assert.equal(request.texts.footerNote, DOCUMENT_TEXT_DEFAULTS.month_grid.footerNote);
    assert.equal(storedAutomation.template_version, 'v27');
});

test('legacy job without PDF bytes is rejected instead of mixing renderer contracts', async () => {
    const legacyJob = {
        id: 92,
        automation_id: 17,
        trigger_kind: 'manual',
        local_date: '2026-07-01',
        document_type: 'month_grid',
        status: 'building',
        settings_snapshot: {
            templateId: 'month_grid',
            month: '2026-07',
            categoryIds: ['waiter'],
            rosterMode: 'all_eligible',
            texts: {
                monthlyInstruction: LEGACY_DOCUMENT_TEXT_DEFAULTS.month_grid.monthlyInstruction,
                footerNote: 'Мій незмінний нижній колонтитул'
            }
        },
        template_version: 'v27',
        copies: 1,
        printer_target_key: 'queue_only',
        attempts: 0,
        requeue_count: 0
    };
    let queryCount = 0;
    let failureParams = null;
    const db = {
        async query(sql, params = []) {
            queryCount += 1;
            if (sql.includes('WITH candidate AS')) return { rows: [legacyJob] };
            if (sql.includes("SET status='failed'")) {
                failureParams = params;
                return { rows: [] };
            }
            throw new Error(`Legacy job unexpectedly reached renderer query: ${sql}`);
        }
    };
    await assert.rejects(
        processBuildJobs({ jobId: legacyJob.id, limit: 1 }, db),
        error => error.code === 'HR_ATTENDANCE_JOB_TEMPLATE_VERSION_MISMATCH' && error.statusCode === 409
    );
    assert.equal(queryCount, 2, 'legacy job must be claimed and failed without reading roster data or rendering');
    assert.equal(failureParams[2], 'HR_ATTENDANCE_JOB_TEMPLATE_VERSION_MISMATCH');
    assert.equal(legacyJob.template_version, 'v27');
    assert.equal(legacyJob.settings_snapshot.texts.footerNote, 'Мій незмінний нижній колонтитул');
});

test('requeue of a ready PDF keeps the stored artifact and does not invoke the renderer', async () => {
    const storedBytes = Buffer.from('existing-pdf-bytes');
    const storedDigest = 'b'.repeat(64);
    let queryCount = 0;
    const db = {
        async query(sql, params = []) {
            queryCount += 1;
            assert.match(sql, /CASE WHEN pdf_data IS NULL THEN 'building' ELSE 'queued' END/);
            const setClause = sql.slice(sql.indexOf('SET'), sql.indexOf('FROM hr_attendance_document_automations'));
            assert.doesNotMatch(setClause, /\b(?:pdf_data|pdf_sha256|roster_snapshot|template_version)\s*=/);
            assert.equal(params[0], 93);
            return {
                rows: [{
                    id: 93,
                    automation_id: 17,
                    trigger_kind: 'manual',
                    local_date: '2026-07-01',
                    document_type: 'month_grid',
                    status: 'queued',
                    template_version: 'v27',
                    pdf_data: storedBytes,
                    pdf_sha256: storedDigest,
                    pdf_byte_length: storedBytes.length,
                    filename: 'month_grid_2026-07.pdf',
                    copies: 1,
                    printer_target_key: 'queue_only',
                    attempts: 1,
                    requeue_count: 1
                }]
            };
        }
    };
    const job = await requeueJob(93, db);
    assert.equal(queryCount, 1, 'ready PDF must not be claimed or rendered again');
    assert.equal(job.status, 'queued');
    assert.equal(job.templateVersion, 'v27');
    assert.equal(job.pdfByteLength, storedBytes.length);
    assert.equal(job.filename, 'month_grid_2026-07.pdf');
});

test('requeue of a legacy job without bytes fails without changing its snapshot or rendering', async () => {
    const legacyJob = {
        id: 94,
        automation_id: 17,
        trigger_kind: 'manual',
        local_date: '2026-07-01',
        document_type: 'month_grid',
        status: 'building',
        settings_snapshot: {
            templateId: 'month_grid',
            month: '2026-07',
            categoryIds: ['waiter'],
            rosterMode: 'all_eligible',
            texts: {
                monthlyInstruction: 'Моя стара інструкція',
                footerNote: 'Мій старий нижній колонтитул'
            }
        },
        template_version: 'v27',
        pdf_data: null,
        copies: 1,
        printer_target_key: 'queue_only',
        attempts: 1,
        requeue_count: 1
    };
    const before = structuredClone(legacyJob);
    let queryCount = 0;
    const db = {
        async query(sql) {
            queryCount += 1;
            if (sql.includes('UPDATE hr_attendance_document_jobs') && sql.includes('requeue_count=requeue_count+1')) {
                return { rows: [legacyJob] };
            }
            if (sql.includes('WITH candidate AS')) {
                assert.match(sql, /status='building'[\s\S]*AND pdf_data IS NULL/);
                return { rows: [legacyJob] };
            }
            if (sql.includes("SET status='failed'")) return { rows: [] };
            throw new Error(`Legacy requeue unexpectedly reached renderer query: ${sql}`);
        }
    };
    await assert.rejects(
        requeueJob(legacyJob.id, db),
        error => error.code === 'HR_ATTENDANCE_JOB_TEMPLATE_VERSION_MISMATCH'
    );
    assert.equal(queryCount, 3);
    assert.equal(legacyJob.template_version, before.template_version);
    assert.deepEqual(legacyJob.settings_snapshot, before.settings_snapshot);
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
    assert.match(service, /status='building'\s+AND pdf_data IS NULL/);
    assert.match(service, /SELECT \* FROM hr_attendance_document_automations WHERE id = \$1 FOR UPDATE/);
    assert.match(service, /status='expired', pdf_data=NULL, roster_snapshot=NULL/);
    assert.match(service, /CASE WHEN pdf_data IS NULL THEN 'building' ELSE 'queued' END/);
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
