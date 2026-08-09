const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const inventory = require('../scripts/task-cleanup-inventory');

const ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'task-cleanup-inventory.js');

function row(overrides = {}) {
    return {
        id: overrides.id ?? 1,
        business_context: overrides.business_context || 'event_genix',
        status: overrides.status || 'todo',
        archived: overrides.archived || false,
        archive_reason: overrides.archive_reason || '',
        task_type_legacy: Object.prototype.hasOwnProperty.call(overrides, 'task_type_legacy') ? overrides.task_type_legacy : 'auto_complete',
        source_type: Object.prototype.hasOwnProperty.call(overrides, 'source_type') ? overrides.source_type : 'booking',
        source_id: overrides.source_id || 'booking-1',
        source_entity_type: overrides.source_entity_type || '',
        related_entity_type: overrides.related_entity_type || '',
        source_module: overrides.source_module || '',
        created_by_normalized: Object.prototype.hasOwnProperty.call(overrides, 'created_by_normalized') ? overrides.created_by_normalized : 'rule_engine',
        created_by_user_id: overrides.created_by_user_id || 0,
        owner_user_id: overrides.owner_user_id || 0,
        visibility: overrides.visibility || 'team',
        task_mode: overrides.task_mode || 'work',
        workflow_state: overrides.workflow_state || 'todo',
        focus_rank: overrides.focus_rank || 0,
        has_snooze: overrides.has_snooze || false,
        has_future_snooze: overrides.has_future_snooze || false,
        due_date: overrides.due_date || '2026-08-08',
        active: overrides.active ?? true,
        canonical_overdue: overrides.canonical_overdue ?? true,
        human_touched: overrides.human_touched || false,
        subtask_count: overrides.subtask_count || 0,
        dependency_count: overrides.dependency_count || 0,
        observer_count: overrides.observer_count || 0,
        ai_bundle_count: overrides.ai_bundle_count || 0,
        booking_found: overrides.booking_found ?? true,
        booking_status: overrides.booking_status || 'cancelled',
        booking_date: overrides.booking_date || '2026-08-01',
        kyiv_today: overrides.kyiv_today || '2026-08-09',
        captured_at: overrides.captured_at || '2026-08-09T12:00:00.000Z'
    };
}

test('task cleanup inventory refuses write/apply style flags', () => {
    for (const flag of inventory.BLOCKED_FLAGS) {
        assert.throws(() => inventory.parseArgs([flag]), /read-only only/);
    }
});

test('task cleanup inventory accepts npm-forwarded positional output path', () => {
    assert.deepEqual(inventory.parseArgs(['.codex-temp/task-cleanup-inventory/manifest.json']), {
        output: '.codex-temp/task-cleanup-inventory/manifest.json',
        printManifest: false,
        help: false
    });
});

test('task cleanup inventory SQL is read-only and uses canonical Kyiv due date semantics', () => {
    const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const sql = inventory.buildInventorySql();

    assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /SHOW transaction_read_only/);
    assert.match(source, /ROLLBACK/);
    assert.match(sql, /scheduled_start_at AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(sql, /snoozed_until AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(sql, /WHEN LEFT\(COALESCE\(t\.date::text, ''\), 10\)/);
    assert.match(sql, /THEN LEFT\(t\.date::text, 10\)::date/);
    assert.match(sql, /deadline AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(sql, /remind_at AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(sql, /t\.snoozed_until IS NULL OR t\.snoozed_until <= NOW\(\)/);

    const forbiddenMutation = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|MERGE|GRANT|REVOKE|COMMIT)\b/i;
    assert.doesNotMatch(sql, forbiddenMutation);
});

test('task cleanup inventory classifier separates strict automation from protected provenance', () => {
    assert.equal(inventory.classifyProvenance(row({ id: 1 })), 'strict_rule_engine');
    assert.equal(inventory.classifyProvenance(row({
        id: 2,
        source_type: 'attendance',
        created_by_normalized: 'rule_engine',
        task_type_legacy: 'auto_complete'
    })), 'attendance');
    assert.equal(inventory.classifyProvenance(row({
        id: 3,
        source_type: 'ai_draft',
        created_by_user_id: 7,
        task_type_legacy: 'manual'
    })), 'human_assisted_ai');
    assert.equal(inventory.classifyProvenance(row({
        id: 4,
        source_type: 'hermes',
        created_by_normalized: 'hermes_bot'
    })), 'integrations_hermes');
    assert.equal(inventory.classifyProvenance(row({
        id: 5,
        source_type: 'manual',
        task_type_legacy: 'manual',
        created_by_user_id: 9
    })), 'manual');
    assert.equal(inventory.classifyProvenance(row({
        id: 6,
        source_type: '',
        task_type_legacy: '',
        created_by_normalized: ''
    })), 'unknown');
});

test('task cleanup inventory protects manual, private, focused, snoozed, human-touched, subtasks, dependencies, observers and AI bundles', () => {
    const protectedRows = [
        row({ id: 10, created_by_user_id: 1, source_type: 'manual', task_type_legacy: 'manual' }),
        row({ id: 11, visibility: 'me_only' }),
        row({ id: 12, task_mode: 'personal' }),
        row({ id: 13, status: 'in_progress' }),
        row({ id: 14, focus_rank: 1 }),
        row({ id: 15, has_snooze: true, has_future_snooze: true }),
        row({ id: 16, human_touched: true }),
        row({ id: 17, subtask_count: 1 }),
        row({ id: 18, dependency_count: 1 }),
        row({ id: 19, observer_count: 1 }),
        row({ id: 20, ai_bundle_count: 1 })
    ];

    const reasons = protectedRows.map(item => inventory.protectionReasons(item));
    assert.ok(reasons.every(list => list.length > 0));
    assert.ok(reasons.some(list => list.includes('typed_creator')));
    assert.ok(reasons.some(list => list.includes('private_or_personal')));
    assert.ok(reasons.some(list => list.includes('in_progress')));
    assert.ok(reasons.some(list => list.includes('focus_rank')));
    assert.ok(reasons.some(list => list.includes('future_snooze')));
    assert.ok(reasons.some(list => list.includes('human_touched')));
    assert.ok(reasons.some(list => list.includes('subtasks')));
    assert.ok(reasons.some(list => list.includes('dependencies')));
    assert.ok(reasons.some(list => list.includes('observers')));
    assert.ok(reasons.some(list => list.includes('human_assisted_ai')));
});

test('task cleanup manifest is deterministic, checksummed, and keeps production IDs out of stdout summary', () => {
    const rows = [
        row({ id: 102, booking_status: 'cancelled' }),
        row({ id: 101, booking_status: 'active', booking_date: '2026-08-01' }),
        row({ id: 103, source_type: 'manual', task_type_legacy: 'manual', created_by_user_id: 5 }),
        row({ id: 104, archive_reason: 'auto_expired', source_type: 'manual', task_type_legacy: 'manual', created_by_user_id: 5, canonical_overdue: false, active: false, archived: true })
    ];
    const first = inventory.buildManifest(rows, { transactionReadOnlyVerified: true });
    const second = inventory.buildManifest(rows, { transactionReadOnlyVerified: true });
    const laterRows = rows.map(item => ({ ...item, captured_at: '2026-08-09T12:05:00.000Z' }));
    const later = inventory.buildManifest(laterRows, { transactionReadOnlyVerified: true });

    assert.equal(first.checksum, second.checksum);
    assert.equal(first.checksum, later.checksum);
    assert.equal(first.classifierVersion, inventory.CLASSIFIER_VERSION);
    assert.deepEqual(first.cohorts.cleanupCandidates.strictCancelledBookings.ids, [102]);
    assert.deepEqual(first.cohorts.booking.strictRuleEngineOverdue.cancelled.ids, [102]);
    assert.deepEqual(first.cohorts.booking.strictRuleEngineOverdue.past_active.ids, [101]);
    assert.deepEqual(first.cohorts.autoExpiredManualPrivate.ids, [104]);

    const summary = inventory.summaryForStdout(first);
    assert.equal(summary.strictCancelledBookingCandidates, 1);
    assert.equal(JSON.stringify(summary).includes('"ids"'), false);
});
