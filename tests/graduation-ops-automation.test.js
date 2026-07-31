const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    buildGraduationSegments,
    buildGraduationTimelineItems,
    computeReminderDate,
    hasCapsuleService,
    hasDiplomaService,
    isRosterReady,
    normalizeSelectedServices,
    syncGraduationOpsForQuote
} = require('../services/graduationOpsAutomation');

const ROOT = path.join(__dirname, '..');

function readRepoFile(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function compactSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function createGraduationOpsOutboxQuery() {
    const state = {
        queries: [],
        tasks: [],
        outboxInserts: [],
        automationStates: [],
        nextTaskId: 810
    };

    return {
        state,
        query: async (sql, params = []) => {
            const text = compactSql(sql);
            state.queries.push({ text, params });

            if (/FROM graduation_quotes q/i.test(text)) {
                return {
                    rows: [{
                        id: params[0],
                        status: 'draft',
                        selected_services: [{ name: 'Diploma ceremony' }],
                        package_id: null,
                        child_pack_id: null,
                        booking_id: 77,
                        booking_date: '2026-06-30',
                        booking_time: '12:00',
                        created_by: 'manager',
                        children_count: 0
                    }]
                };
            }
            if (/FROM users/i.test(text) && /username = \$1 OR name = \$1/i.test(text)) {
                return { rows: [{ id: 4, username: params[0], name: 'Manager', role: 'manager' }] };
            }
            if (/FROM users/i.test(text) && /role = ANY\(\$1::text\[\]\)/i.test(text)) {
                return { rows: [{ id: 6, username: 'art_director', name: 'Art Director', role: 'art_director' }] };
            }
            if (/FROM tasks WHERE source_type = \$1 AND source_id = \$2/i.test(text)) {
                return { rows: [] };
            }
            if (/UPDATE tasks SET status = 'done'/i.test(text) && /archive_reason = \$3/i.test(text)) {
                return { rows: [], rowCount: 0 };
            }
            if (/INSERT INTO tasks/i.test(text)) {
                const row = {
                    id: state.nextTaskId++,
                    title: params[0],
                    description: params[1],
                    date: params[2],
                    priority: params[3],
                    assigned_to: params[4],
                    owner: params[5],
                    owner_user_id: params[6],
                    deadline: params[7],
                    source_type: params[9],
                    source_id: params[10],
                    category: params[11],
                    task_kind: params[15],
                    status: 'todo',
                    workflow_state: params[16],
                    remind_at: params[17],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                state.tasks.push(row);
                return { rows: [row], rowCount: 1 };
            }
            if (/INSERT INTO notification_outbox/i.test(text)) {
                const row = {
                    id: state.outboxInserts.length + 1,
                    event_id: params[0],
                    task_id: params[1],
                    owner_user_id: params[2],
                    event_type: params[3],
                    payload_json: params[4],
                    payload_hash: params[5],
                    status: 'pending',
                    attempts: 0,
                    available_at: params[6],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                state.outboxInserts.push(row);
                return { rows: [row], rowCount: 1 };
            }
            if (/SELECT DISTINCT u\.id/i.test(text)) {
                return { rows: [] };
            }
            if (/INSERT INTO task_observers/i.test(text)) {
                return { rows: [], rowCount: 1 };
            }
            if (/INSERT INTO graduation_automation_state/i.test(text)) {
                const row = {
                    graduation_quote_id: params[0],
                    automation_key: params[2],
                    state: params[3],
                    task_id: params[4]
                };
                state.automationStates.push(row);
                return { rows: [row], rowCount: 1 };
            }

            throw new Error(`Unexpected graduation ops query: ${text}`);
        }
    };
}

describe('Graduation ops automation contract', () => {
    it('normalizes selected graduation services into timeline-visible ordered items', () => {
        const items = buildGraduationTimelineItems([
            { serviceId: 2, name: 'Capsule of time', sortOrder: 20, durationMin: 15 },
            { serviceId: 1, name: 'Diploma print', sortOrder: 10, durationMin: 20 },
            { serviceId: 3, name: 'Hidden service', sortOrder: 30, timelineVisible: false }
        ], [
            { serviceId: 1, startTime: '12:30', endTime: '12:50' }
        ]);

        assert.equal(items.length, 2);
        assert.deepEqual(items.map(item => item.name), ['Diploma print', 'Capsule of time']);
        assert.equal(items[0].operationKind, 'diploma');
        assert.equal(items[0].startTime, '12:30');
        assert.equal(items[1].operationKind, 'capsule_time');
    });

    it('builds package-derived nested graduation segments with offsets and color tokens', () => {
        const segments = buildGraduationSegments([
            { serviceId: 10, name: 'Welcome zone', sortOrder: 10, durationMin: 30, operationKind: 'welcome' },
            { serviceId: 11, name: 'Animation', sortOrder: 20, durationMin: 60, operationKind: 'animation' },
            { serviceId: 12, name: 'Diploma ceremony', sortOrder: 30, durationMin: 30, operationKind: 'diploma' }
        ], [
            { serviceId: 11, startTime: '12:30', endTime: '13:30' }
        ], '12:00');

        assert.deepEqual(segments.map(segment => segment.title), ['Welcome zone', 'Animation', 'Diploma ceremony']);
        assert.deepEqual(segments.map(segment => segment.startOffsetMin), [0, 30, 90]);
        assert.deepEqual(segments.map(segment => segment.durationMin), [30, 60, 30]);
        assert.deepEqual(segments.map(segment => segment.colorToken), ['welcome', 'animation', 'diploma']);
        assert.equal(segments[0].source, 'package');
    });

    it('detects readiness and service types from canonical helpers', () => {
        const normalized = normalizeSelectedServices([{ id: 7, service_name: 'Diploma set' }, { id: 8, name: 'Capsule service' }]);
        assert.equal(normalized.length, 2);
        assert.equal(hasDiplomaService(normalized), true);
        assert.equal(hasCapsuleService(normalized), true);
        assert.equal(isRosterReady({ childrenCount: 0 }), false);
        assert.equal(isRosterReady({ childrenCount: 1 }), true);
        assert.equal(computeReminderDate('2026-05-21'), '2026-05-20');
    });

    it('keeps database migration purpose-aware and reusable', () => {
        const migration = readRepoFile('db/migrations/203_graduation_ops_automation.sql');
        assert.match(migration, /control_mode/);
        assert.match(migration, /special_control/);
        assert.match(migration, /graduation_automation_state/);
        assert.match(migration, /timeline_visible/);
        assert.match(migration, /operation_kind/);
    });

    it('wires route, scheduler and UI surfaces to the automation contract', () => {
        const graduationRoute = readRepoFile('routes/graduation.js');
        const scheduler = readRepoFile('services/scheduler.js');
        const server = readRepoFile('server.js');
        const timeline = readRepoFile('js/timeline.js');
        const taskContract = readRepoFile('services/taskContract.js');
        const tasksPage = readRepoFile('js/tasks-page.js');

        assert.match(graduationRoute, /syncGraduationOpsSafe/);
        assert.match(graduationRoute, /graduationTimelineItems/);
        assert.match(graduationRoute, /graduationSegments/);
        assert.match(graduationRoute, /graduationPackageSegments/);
        assert.match(graduationRoute, /duration, status, extra_data/);
        assert.match(scheduler, /checkGraduationOpsAutomation/);
        assert.match(server, /checkGraduationOpsAutomation/);
        assert.match(timeline, /getGraduationTimelineItems/);
        assert.match(timeline, /normalizeGraduationSegments/);
        assert.match(timeline, /initGraduationSegmentInteractions/);
        assert.match(timeline, /graduation-segment-track/);
        assert.match(timeline, /apiUpdateBooking/);
        assert.match(taskContract, /controlMode/);
        assert.match(tasksPage, /special-control/);
    });

    it('emits notification_outbox events for newly inserted graduation automation tasks', async () => {
        const fake = createGraduationOpsOutboxQuery();
        const result = await syncGraduationOpsForQuote(900, {
            query: fake,
            hermesOutboxEnabled: true
        });

        assert.equal(result.success, true);
        assert.equal(fake.state.tasks.length, 2);
        assert.equal(fake.state.outboxInserts.length, 2);
        assert.deepEqual(
            fake.state.outboxInserts.map(row => row.task_id),
            fake.state.tasks.map(row => row.id)
        );
        assert.deepEqual(
            fake.state.outboxInserts.map(row => row.event_type),
            ['task_created', 'task_created']
        );
        assert.deepEqual(
            fake.state.outboxInserts.map(row => row.status),
            ['pending', 'pending']
        );
        assert.deepEqual(
            fake.state.outboxInserts.map(row => row.owner_user_id),
            [4, 6]
        );
    });
});
