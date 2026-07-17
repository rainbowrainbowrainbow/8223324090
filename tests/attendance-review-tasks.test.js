'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const {
    ATTENDANCE_REVIEW_SOURCE_TYPE,
    attendanceReviewWindow,
    formatAttendanceReviewDescription,
    mergeAttendanceArrivals,
    runAttendanceReviewTasks
} = require('../services/attendanceReviewTasks');

function compact(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function createFixture(options = {}) {
    const state = {
        calls: [],
        createdTasks: [],
        taskSources: new Set(options.existingSources || []),
        released: false,
        users: options.users || [{
            id: 11,
            username: 'director.primary',
            name: 'Director Primary',
            role: 'director',
            extra_roles: [],
            is_active: true
        }],
        canonicalRows: options.canonicalRows || [],
        fallbackRows: options.fallbackRows || []
    };
    const client = {
        async query(sql, params = []) {
            const text = compact(sql);
            state.calls.push({ text, params });
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [], rowCount: 0 };
            if (/pg_advisory_xact_lock\(hashtextextended/i.test(text)) return { rows: [{}], rowCount: 1 };
            if (/FROM users/i.test(text)) return { rows: state.users, rowCount: state.users.length };
            if (/FROM hr_time_records tr/i.test(text)) {
                return { rows: state.canonicalRows, rowCount: state.canonicalRows.length };
            }
            if (/FROM staff_checkins sc/i.test(text)) {
                return { rows: state.fallbackRows, rowCount: state.fallbackRows.length };
            }
            if (/FROM tasks/i.test(text) && /source_type = \$2/i.test(text)) {
                const exists = state.taskSources.has(params[2]);
                return { rows: exists ? [{ id: 900 }] : [], rowCount: exists ? 1 : 0 };
            }
            throw new Error(`Unexpected attendance review SQL: ${text}`);
        },
        release() {
            state.released = true;
        }
    };
    const db = { async connect() { return client; } };
    const createTask = async (payload, taskOptions) => {
        state.createdTasks.push({ payload, options: taskOptions });
        state.taskSources.add(payload.source_id);
        return { id: 1000 + state.createdTasks.length, ...payload };
    };
    return { state, db, createTask };
}

describe('attendance review task scheduling', () => {
    it('waits until 08:30 Kyiv and targets the previous full calendar day', async () => {
        assert.equal(attendanceReviewWindow(new Date('2026-07-17T05:29:00Z')), null);
        assert.deepEqual(attendanceReviewWindow(new Date('2026-07-17T05:30:00Z')), {
            taskDate: '2026-07-17',
            reportDate: '2026-07-16'
        });

        let connected = false;
        const result = await runAttendanceReviewTasks({
            now: new Date('2026-07-17T05:29:00Z'),
            db: { async connect() { connected = true; } }
        });
        assert.deepEqual(result, { skipped: true, reason: 'before_cutoff' });
        assert.equal(connected, false);
    });

    it('creates one private Today task per unique active primary/extra role with scoped descriptions', async () => {
        const fixture = createFixture({
            users: [
                { id: 11, username: 'director.primary', role: 'director', extra_roles: [], is_active: true },
                { id: 12, username: 'art.extra', role: 'employee', extra_roles: ['art_director'], is_active: true },
                { id: 13, username: 'dual.role', role: 'art_director', extra_roles: ['director'], is_active: true },
                { id: 12, username: 'art.extra', role: 'employee', extra_roles: ['art_director'], is_active: true },
                { id: 14, username: 'inactive.director', role: 'director', extra_roles: [], is_active: false },
                { id: 15, username: 'ordinary', role: 'employee', extra_roles: [], is_active: true }
            ],
            canonicalRows: [
                { staff_id: 101, staff_name: 'Creative Canonical', department: 'animators', arrival_time: '09:10' },
                { staff_id: 102, staff_name: 'Admin Canonical', department: 'admin', arrival_time: '08:55' }
            ],
            fallbackRows: [
                { staff_id: 101, staff_name: 'Creative Canonical', department: 'animators', arrival_time: '08:40' },
                { staff_id: 103, staff_name: 'Creative Fallback', department: 'creative', arrival_time: '09:05' },
                { staff_id: 104, staff_name: 'Admin Fallback', department: 'admin', arrival_time: '08:30' }
            ]
        });

        const result = await runAttendanceReviewTasks({
            now: new Date('2026-07-17T06:00:00Z'),
            db: fixture.db,
            createTask: fixture.createTask
        });

        assert.equal(result.reportDate, '2026-07-16');
        assert.equal(result.taskDate, '2026-07-17');
        assert.equal(result.recipients, 3);
        assert.equal(result.created, 3);
        assert.deepEqual(
            fixture.state.createdTasks.map(task => task.payload.owner_user_id).sort((a, b) => a - b),
            [11, 12, 13]
        );

        const directorTask = fixture.state.createdTasks.find(task => task.payload.owner_user_id === 11);
        const artTask = fixture.state.createdTasks.find(task => task.payload.owner_user_id === 12);
        const dualRoleTask = fixture.state.createdTasks.find(task => task.payload.owner_user_id === 13);
        assert.equal(directorTask.payload.title, 'Ознайомитися з приходами за 16.07.2026');
        assert.equal(directorTask.payload.date, '2026-07-17');
        assert.equal(directorTask.payload.visibility, 'private');
        assert.equal(directorTask.payload.task_kind, 'routine');
        assert.equal(directorTask.payload.category, 'admin');
        assert.equal(directorTask.payload.source_type, ATTENDANCE_REVIEW_SOURCE_TYPE);
        assert.equal(directorTask.payload.source_id, '2026-07-16:11');
        assert.equal(directorTask.payload.description, [
            '08:30 — Admin Fallback',
            '08:55 — Admin Canonical',
            '09:05 — Creative Fallback',
            '09:10 — Creative Canonical'
        ].join('\n'));
        assert.equal(artTask.payload.description, [
            '09:05 — Creative Fallback',
            '09:10 — Creative Canonical'
        ].join('\n'));
        assert.equal(dualRoleTask.payload.description, directorTask.payload.description);

        for (const task of fixture.state.createdTasks) {
            assert.equal(task.options.skipNotifications, true);
            assert.equal(task.options.skipHermesOutbox, true);
        }
        const userQuery = fixture.state.calls.find(call => /FROM users/i.test(call.text));
        assert.match(userQuery.text, /COALESCE\(is_active, true\) = true/i);
        assert.match(userQuery.text, /unnest\(COALESCE\(extra_roles/i);
        assert.equal(fixture.state.released, true);
    });

    it('uses canonical attendance before fallback and keeps one earliest arrival per employee', () => {
        const merged = mergeAttendanceArrivals([
            { staff_id: 7, staff_name: 'Canonical', department: 'animators', arrival_time: '09:15' },
            { staff_id: 7, staff_name: 'Canonical', department: 'animators', arrival_time: '09:05' }
        ], [
            { staff_id: 7, staff_name: 'Fallback ignored', department: 'animators', arrival_time: '08:00' },
            { staff_id: 8, staff_name: 'Fallback used', department: 'admin', arrival_time: '08:45' },
            { staff_id: 8, staff_name: 'Fallback used', department: 'admin', arrival_time: '08:30' }
        ]);
        assert.deepEqual(merged.map(row => [row.staffId, row.time, row.source]), [
            [8, '08:30', 'staff_checkins'],
            [7, '09:05', 'hr_time_records']
        ]);
    });

    it('creates an explicit zero-arrivals task without leaking through notification paths', async () => {
        const fixture = createFixture();
        const result = await runAttendanceReviewTasks({
            now: new Date('2026-07-17T06:00:00Z'),
            db: fixture.db,
            createTask: fixture.createTask
        });
        assert.equal(result.created, 1);
        assert.equal(fixture.state.createdTasks[0].payload.description, 'Приходів не зафіксовано');
        assert.equal(formatAttendanceReviewDescription([]), 'Приходів не зафіксовано');
        assert.deepEqual(fixture.state.createdTasks[0].options, {
            pool: fixture.state.createdTasks[0].options.pool,
            skipNotifications: true,
            skipHermesOutbox: true
        });
    });

    it('restart catch-up and reruns do not duplicate a task even after it was completed', async () => {
        const sourceId = '2026-07-16:11';
        const fixture = createFixture({ existingSources: [sourceId] });
        const result = await runAttendanceReviewTasks({
            now: new Date('2026-07-17T09:00:00Z'),
            db: fixture.db,
            createTask: fixture.createTask
        });
        assert.equal(result.created, 0);
        assert.equal(result.existing, 1);
        assert.equal(fixture.state.createdTasks.length, 0);
        const duplicateQuery = fixture.state.calls.find(call => /FROM tasks/i.test(call.text));
        assert.doesNotMatch(duplicateQuery.text, /status/i);
        assert.match(duplicateQuery.text, /source_type = \$2/i);
        assert.match(duplicateQuery.text, /source_id = \$3/i);
    });

    it('keeps startup catch-up, scheduler ownership, and no-Telegram policy explicit', () => {
        const root = path.join(__dirname, '..');
        const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
        const service = fs.readFileSync(path.join(root, 'services', 'attendanceReviewTasks.js'), 'utf8');
        assert.match(server, /checkAttendanceReviewTasks\(\)\.catch/);
        assert.match(server, /guardScheduler\('checkAttendanceReviewTasks', checkAttendanceReviewTasks, \{ dedup: null \}\)/);
        assert.doesNotMatch(service, /sendTelegramMessage|getConfiguredChatId|telegramRequest/);
        assert.match(service, /skipNotifications:\s*true/);
        assert.match(service, /skipHermesOutbox:\s*true/);
    });
});
