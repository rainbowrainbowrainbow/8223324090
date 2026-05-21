const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    buildGraduationTimelineItems,
    computeReminderDate,
    hasCapsuleService,
    hasDiplomaService,
    isRosterReady,
    normalizeSelectedServices
} = require('../services/graduationOpsAutomation');

const ROOT = path.join(__dirname, '..');

function readRepoFile(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
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
        const tasksRoute = readRepoFile('routes/tasks.js');
        const tasksPage = readRepoFile('js/tasks-page.js');

        assert.match(graduationRoute, /syncGraduationOpsSafe/);
        assert.match(graduationRoute, /graduationTimelineItems/);
        assert.match(scheduler, /checkGraduationOpsAutomation/);
        assert.match(server, /checkGraduationOpsAutomation/);
        assert.match(timeline, /getGraduationTimelineItems/);
        assert.match(timeline, /graduation-timeline-items/);
        assert.match(tasksRoute, /controlMode/);
        assert.match(tasksPage, /special-control/);
    });
});
