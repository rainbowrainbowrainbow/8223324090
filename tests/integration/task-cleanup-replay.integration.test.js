'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

test('read-only audit and booking replay after an isolated archival fixture', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true'
}, async t => {
    assertSafeIsolatedTestUrl(process.env.TEST_URL);
    const connection = new URL(process.env.TEST_DATABASE_URL);
    assert.equal(connection.hostname, '127.0.0.1');
    assert.match(connection.pathname, /(^|[_-])test([_-]|$)/);
    const { pool } = require('../../db');
    const { processBookingAutomation } = require('../../services/bookingAutomation');
    const { checkRecurringTasks } = require('../../services/scheduler');
    const { cancelledBookingAutoArchivePredicateSql } = require('../../services/taskLifecycle');
    const { taskWorkloadDateSql } = require('../../services/taskAutomationPolicy');
    const reports = path.resolve('output/qa/task-cleanup');
    fs.mkdirSync(reports, { recursive: true });
    const output = fs.mkdtempSync(path.join(reports, 'run-'));
    t.diagnostic(`Report directory: ${output}`);
    const classifier = 'task5_strict_auto_complete_cancelled_booking_v1_2026_08_09';
    const title = 'Fixture booking replay';
    async function runAudit(label) {
        const phases = [
            ['inventory', 'scripts/task-cleanup-inventory.js', []],
            ['stale', 'scripts/task-stale-machine-report.js', []],
            ['wave', 'scripts/task-cleanup-operator.js', ['--classifier', classifier]]
        ];
        for (const [name, script, args] of phases) {
            const destination = path.join(output, label + '-' + name + '.json');
            execFileSync(process.execPath, [script, ...args, '--output', destination], {
                env: { ...process.env, PGSSLMODE: 'disable',
                    TASK_CLEANUP_AUDIT_DATABASE_URL: connection.href,
                    TASK_CLEANUP_READONLY_DATABASE_URL: connection.href }
            });
        }
        return JSON.parse(fs.readFileSync(path.join(output, label + '-wave.json')));
    }
    const matching = async booking => (await pool.query(
        'SELECT id, status FROM tasks WHERE title = $1 AND source_id = $2 ORDER BY id',
        [title, booking.id])).rows;
    try {
        const { rows: [old, fresh] } = await pool.query(`INSERT INTO bookings
            (id, date, time, line_id, program_id, status, business_context, room, room_resource_id)
            VALUES ('qa-replay-old', ((NOW() AT TIME ZONE 'Europe/Kyiv')::date - 40)::text, '12:00', 'qa', 'qa-replay', 'cancelled', 'event_genix', 'QA room', 'qa-room'),
                   ('qa-replay-new', ((NOW() AT TIME ZONE 'Europe/Kyiv')::date + 40)::text, '12:00', 'qa', 'qa-replay', 'confirmed', 'event_genix', 'QA room', 'qa-room')
            RETURNING id, date, status, program_id, business_context`);
        await pool.query(`INSERT INTO automation_rules (name, trigger_type, trigger_condition, actions, days_before)
            VALUES ('QA booking replay rule', 'booking_create', $1::jsonb, $2::jsonb, 0)`,
        [JSON.stringify({ product_ids: ['qa-replay'] }), JSON.stringify([{ type: 'create_task', title }])]);
        await processBookingAutomation(old);
        const before = await matching(old);
        assert.equal(before.length, 1);
        await processBookingAutomation(old);
        assert.deepEqual(await matching(old), before);
        const { rows: [safe] } = await pool.query(`SELECT t.id FROM tasks t JOIN bookings b ON b.id::text = t.source_id::text
            WHERE t.id = $1 AND ${cancelledBookingAutoArchivePredicateSql('t', 'b', "(NOW() AT TIME ZONE 'Europe/Kyiv')::date")}`,
        [before[0].id]);
        assert.equal(safe?.id, before[0].id);
        const wave = await runAudit('before');
        assert.ok(wave.ids.includes(before[0].id));

        // Archive only the single disposable fixture. The audit tools are dry-run only.
        await pool.query(`UPDATE tasks SET status = 'archived', workflow_state = 'archived', archived_at = NOW()
            WHERE id = $1`, [safe.id]);
        assert.deepEqual((await matching(old)).filter(row => row.status !== 'archived'), []);
        await processBookingAutomation(old);
        const active = (await matching(old)).filter(row => row.status !== 'archived');
        assert.equal(active.length, 1);
        assert.notEqual(active[0].id, before[0].id);
        await processBookingAutomation(fresh);
        assert.equal((await matching(fresh)).filter(row => row.status !== 'archived').length, 1);

        const { rows: [template] } = await pool.query(`INSERT INTO task_templates
            (title, recurrence_pattern, is_active, business_context)
            VALUES ('Fixture recurring replay', 'daily', true, 'event_genix') RETURNING id`);
        let occurrences;
        t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2099-02-01T22:05:00Z') });
        try {
            await checkRecurringTasks();
            await checkRecurringTasks();
            t.mock.timers.setTime(Date.parse('2099-02-02T22:05:00Z'));
            await checkRecurringTasks();
            occurrences = (await pool.query('SELECT id, date FROM tasks WHERE template_id = $1 ORDER BY date', [template.id])).rows;
        } finally {
            t.mock.timers.reset();
        }
        assert.deepEqual(occurrences.map(item => item.date), ['2099-02-02', '2099-02-03']);
        const after = await runAudit('after');
        assert.ok(after.ids.includes(active[0].id));
        const groups = await pool.query(`SELECT business_context, source_type, COUNT(*)::int AS count,
            CASE WHEN status = 'archived' THEN 'archived_fixture'
                 WHEN source_id = 'qa-replay-old' THEN 'trigger_recreates_after_archive'
                 WHEN owner_user_id IS NULL OR ${taskWorkloadDateSql('t')} IS NULL THEN 'replan'
                 ELSE 'individual' END AS reason
            FROM tasks t WHERE title LIKE 'Fixture %' GROUP BY 1,2,4 ORDER BY 1,2,4`);
        fs.writeFileSync(path.join(output, 'isolated-result.json'), JSON.stringify({
            cancelledBooking: { before: before[0].id, replay: active[0].id, activeAfterReplay: active.length },
            newBooking: (await matching(fresh))[0].id,
            recurring: { verification: 'scheduler', occurrences },
            wave: { classifier, count: wave.count, membershipChecksum: wave.membershipChecksum },
            groups: groups.rows
        }, null, 2));
    } finally {
        await pool.end();
    }
});
