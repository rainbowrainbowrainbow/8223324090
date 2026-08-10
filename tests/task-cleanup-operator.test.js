const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const operator = require('../scripts/task-cleanup-operator');

const ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'task-cleanup-operator.js');

function row(overrides = {}) {
    return {
        task_id: overrides.task_id ?? 101,
        task_status: overrides.task_status || 'todo',
        workflow_state: overrides.workflow_state || 'todo',
        task_type: overrides.task_type || 'auto_complete',
        source_type: overrides.source_type || 'booking',
        creator_class: overrides.creator_class || 'rule_engine',
        due_date: overrides.due_date || '2026-08-01',
        booking_status: overrides.booking_status || 'cancelled',
        booking_date_bucket: overrides.booking_date_bucket || 'past',
        kyiv_today: overrides.kyiv_today || '2026-08-10',
        captured_at: overrides.captured_at || '2026-08-10T10:00:00.000Z',
        has_protections: overrides.has_protections || false
    };
}

test('task cleanup operator defaults to dry-run arguments and blocks destructive generic flags', () => {
    const parsed = operator.parseArgs([
        '--classifier',
        'task5_strict_auto_complete_cancelled_booking_v1_2026_08_09',
        '--output',
        '.codex-temp/task-cleanup/wave.json'
    ]);
    assert.equal(parsed.apply, false);
    assert.equal(parsed.classifier, 'task5_strict_auto_complete_cancelled_booking_v1_2026_08_09');

    for (const flag of operator.BLOCKED_FLAGS) {
        assert.throws(
            () => operator.parseArgs(['--classifier', 'task5_strict_auto_complete_cancelled_booking_v1_2026_08_09', flag]),
            /not supported/
        );
    }
});

test('task cleanup operator accepts npm-forwarded positional classifier and output path', () => {
    const parsed = operator.parseArgs([
        'task5_strict_auto_complete_cancelled_booking_v1_2026_08_09',
        '.codex-temp/task-cleanup/operator-manifest.json'
    ]);
    assert.equal(parsed.classifier, 'task5_strict_auto_complete_cancelled_booking_v1_2026_08_09');
    assert.equal(parsed.output, '.codex-temp/task-cleanup/operator-manifest.json');
    assert.equal(parsed.apply, false);
});

test('task cleanup operator apply requires exact approval shape and deterministic archive reason', () => {
    assert.throws(
        () => operator.parseArgs(['--classifier', 'task5_strict_auto_complete_cancelled_booking_v1_2026_08_09', '--apply']),
        /Apply mode requires/
    );

    assert.throws(
        () => operator.parseArgs([
            '--classifier',
            'task5_strict_auto_complete_cancelled_booking_v1_2026_08_09',
            '--apply',
            '--approved-classifier',
            'task5_strict_auto_complete_cancelled_booking_v1_2026_08_09',
            '--approved-count',
            '1',
            '--approved-membership-checksum',
            'a'.repeat(64),
            '--archive-reason',
            'cleanup_delete_old_done_tasks_v1',
            '--rollback-output',
            '.codex-temp/task-cleanup/rollback.json'
        ]),
        /must not describe delete\/done\/purge/
    );
});

test('task cleanup operator dry-run SQL is read-only and uses Kyiv canonical overdue semantics', () => {
    const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const sql = operator.buildDryRunSql('task5_strict_auto_complete_cancelled_booking_v1_2026_08_09');

    assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /SHOW transaction_read_only/);
    assert.match(source, /SHOW transaction_isolation/);
    assert.match(source, /ROLLBACK/);
    assert.match(sql, /scheduled_start_at AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(sql, /snoozed_until AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(sql, /deadline AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(sql, /remind_at AT TIME ZONE 'Europe\/Kyiv'/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|MERGE|COMMIT)\b/i);
});

test('task cleanup operator UPDATE repeats safety predicates and archives only', () => {
    const sql = operator.buildArchiveUpdateSql('task_strict_rule_engine_booking_type_auto_backlog_v1_2026_08_10_cancelled_booking');

    assert.match(sql, /UPDATE tasks target/);
    assert.match(sql, /status = 'archived'/);
    assert.match(sql, /workflow_state = 'archived'/);
    assert.match(sql, /archive_reason = \$2::text/);
    assert.doesNotMatch(sql, /\bDELETE\b/i);
    assert.doesNotMatch(sql, /status\s*=\s*'done'/i);

    assert.match(sql, /candidate\.archived_at IS NULL/);
    assert.match(sql, /candidate\.created_by_user_id/);
    assert.match(sql, /task_logs tl/);
    assert.match(sql, /task_action_history tah/);
    assert.match(sql, /task_subtasks st/);
    assert.match(sql, /task_dependencies td/);
    assert.match(sql, /task_observers tob/);
    assert.match(sql, /LOWER\(COALESCE\(candidate\.source_type, ''\)\) = 'booking'/);
    assert.match(sql, /LOWER\(COALESCE\(candidate\.created_by, ''\)\) = 'rule_engine'/);
    assert.match(sql, /LOWER\(COALESCE\(b\.status, ''\)\) = ANY\(ARRAY\['cancelled', 'canceled'\]\)/);
});

test('task cleanup operator manifest is deterministic and keeps IDs out of stdout summary', () => {
    const rows = [
        row({ task_id: 3 }),
        row({ task_id: 1 }),
        row({ task_id: 2, booking_status: 'cancelled' })
    ];
    const first = operator.buildWaveManifest(rows, 'task5_strict_auto_complete_cancelled_booking_v1_2026_08_09');
    const second = operator.buildWaveManifest(rows.map(item => ({ ...item, captured_at: '2026-08-10T11:00:00.000Z' })), 'task5_strict_auto_complete_cancelled_booking_v1_2026_08_09');

    assert.deepEqual(first.ids, [1, 2, 3]);
    assert.equal(first.membershipChecksum, second.membershipChecksum);
    assert.equal(first.evidenceChecksum, second.evidenceChecksum);

    const summary = operator.summaryForStdout(first);
    const serialized = JSON.stringify(summary);
    assert.equal(serialized.includes('"ids"'), false);
    assert.equal(serialized.includes('"rows"'), false);
    assert.equal(serialized.includes('source_id'), false);
    assert.equal(serialized.includes('owner'), false);
});

test('task cleanup operator empty manifest still binds Kyiv date into checksums', () => {
    const manifest = operator.buildWaveManifest([], 'task_strict_rule_engine_booking_type_auto_backlog_v1_2026_08_10_cancelled_booking', {
        kyivToday: '2026-08-10',
        capturedAt: '2026-08-10T19:30:00.000Z'
    });
    assert.equal(manifest.count, 0);
    assert.equal(manifest.kyivToday, '2026-08-10');
    assert.match(manifest.membershipChecksum, /^[a-f0-9]{64}$/);
    assert.match(manifest.evidenceChecksum, /^[a-f0-9]{64}$/);
});

test('task cleanup operator cancels apply when count or membership checksum drifts', () => {
    const manifest = operator.buildWaveManifest([row({ task_id: 1 }), row({ task_id: 2 })], 'task5_strict_auto_complete_cancelled_booking_v1_2026_08_09');

    assert.doesNotThrow(() => operator.validateApprovedManifest({
        approvedClassifier: manifest.classifierVersion,
        approvedCount: manifest.count,
        approvedMembershipChecksum: manifest.membershipChecksum
    }, manifest));

    assert.throws(() => operator.validateApprovedManifest({
        approvedClassifier: manifest.classifierVersion,
        approvedCount: manifest.count + 1,
        approvedMembershipChecksum: manifest.membershipChecksum
    }, manifest), /Approved count drift/);

    assert.throws(() => operator.validateApprovedManifest({
        approvedClassifier: manifest.classifierVersion,
        approvedCount: manifest.count,
        approvedMembershipChecksum: 'b'.repeat(64)
    }, manifest), /Approved membership checksum drift/);
});

test('task cleanup operator apply refuses generic DATABASE_URL and requires dedicated apply URL', () => {
    assert.throws(
        () => operator.poolConfig('apply', { DATABASE_URL: 'postgres://write.example/db' }),
        /TASK_CLEANUP_APPLY_DATABASE_URL/
    );
    assert.equal(
        operator.poolConfig('apply', { TASK_CLEANUP_APPLY_DATABASE_URL: 'postgres://write.example/db', PGSSLMODE: 'disable' }).connectionString,
        'postgres://write.example/db'
    );
});
