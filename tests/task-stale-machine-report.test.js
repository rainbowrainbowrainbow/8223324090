const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const report = require('../services/taskStaleMachineReport');
const script = require('../scripts/task-stale-machine-report');

const ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'task-stale-machine-report.js');

function row(overrides = {}) {
    return {
        task_id: overrides.task_id ?? 101,
        task_status: overrides.task_status || 'todo',
        workflow_state: overrides.workflow_state || 'todo',
        source_type: overrides.source_type ?? 'booking',
        source_module: overrides.source_module || '',
        task_type: overrides.task_type || 'auto_complete',
        creator_class: overrides.creator_class || 'rule_engine',
        created_by_user_id: overrides.created_by_user_id || 0,
        visibility: overrides.visibility || 'team',
        task_mode: overrides.task_mode || 'work',
        focus_rank: overrides.focus_rank || 0,
        has_snooze: overrides.has_snooze || false,
        has_future_snooze: overrides.has_future_snooze || false,
        active: overrides.active ?? true,
        archived: overrides.archived || false,
        canonical_overdue: overrides.canonical_overdue ?? true,
        human_touched: overrides.human_touched || false,
        subtask_count: overrides.subtask_count || 0,
        dependency_count: overrides.dependency_count || 0,
        observer_count: overrides.observer_count || 0,
        ai_bundle_count: overrides.ai_bundle_count || 0,
        booking_found: overrides.booking_found ?? true,
        booking_status: overrides.booking_status || 'cancelled',
        booking_date_bucket: overrides.booking_date_bucket || 'past',
        has_template_id: overrides.has_template_id || false,
        template_found: overrides.template_found || false,
        template_active: overrides.template_active || false,
        template_context_match: Object.prototype.hasOwnProperty.call(overrides, 'template_context_match')
            ? overrides.template_context_match
            : null,
        health_score: Object.prototype.hasOwnProperty.call(overrides, 'health_score') ? overrides.health_score : null,
        kyiv_today: overrides.kyiv_today || '2026-08-10',
        captured_at: overrides.captured_at || '2026-08-10T12:00:00.000Z'
    };
}

test('stale machine report marks strict booking cohorts as report-only candidates', () => {
    const cancelled = report.classifyStaleMachineTask(row({ task_id: 1, booking_status: 'cancelled' }));
    const past = report.classifyStaleMachineTask(row({ task_id: 2, booking_status: 'confirmed' }));

    assert.equal(cancelled.decision, 'report_candidate');
    assert.equal(cancelled.cohort, 'candidate_strict_booking_cancelled');
    assert.equal(cancelled.candidateArchiveReason, 'cleanup_candidate_strict_booking_cancelled_v1');

    assert.equal(past.decision, 'report_candidate');
    assert.equal(past.cohort, 'candidate_strict_booking_past');
    assert.equal(past.candidateArchiveReason, 'cleanup_candidate_strict_booking_past_v1');
});

test('stale machine report protects manual, private, AI, integration, attendance and unknown tasks', () => {
    const cases = [
        row({ task_id: 10, source_type: 'manual', task_type: 'manual', creator_class: 'human_named_or_legacy', created_by_user_id: 7 }),
        row({ task_id: 11, visibility: 'private' }),
        row({ task_id: 12, source_type: 'ai_draft', task_type: 'ai_draft', created_by_user_id: 8 }),
        row({ task_id: 13, source_type: 'hermes', creator_class: 'hermes' }),
        row({ task_id: 14, source_type: 'attendance' }),
        row({ task_id: 15, source_type: '', task_type: '', creator_class: 'unknown', health_score: 0 })
    ];

    const results = cases.map(item => report.classifyStaleMachineTask(item));
    assert.ok(results.every(item => item.decision === 'protected'));
    assert.ok(results.some(item => item.cohort === 'protected_attendance'));
    assert.ok(results.some(item => item.cohort === 'protected_hermes_or_integration'));
    assert.ok(results.some(item => item.cohort === 'protected_ai_assisted'));
    assert.ok(results.some(item => item.cohort === 'protected_unknown_or_unproven_machine_lineage'));
});

test('stale machine report protects current/future and human-touched machine tasks', () => {
    assert.deepEqual(report.classifyStaleMachineTask(row({
        task_id: 20,
        canonical_overdue: false,
        booking_date_bucket: 'today_or_future'
    })).cohort, 'protected_current_or_future');

    assert.deepEqual(report.classifyStaleMachineTask(row({
        task_id: 21,
        human_touched: true
    })).cohort, 'protected_by_human_or_visibility_flags');
});

test('stale machine report ignores terminal and archived tasks', () => {
    assert.equal(report.classifyStaleMachineTask(row({ task_id: 30, task_status: 'archived', active: false, archived: true })).decision, 'ignored');
    assert.equal(report.classifyStaleMachineTask(row({ task_id: 31, task_status: 'done', active: false })).cohort, 'ignored_terminal_or_archived');
});

test('stale recurring/template generated tasks are report-only candidates, not automatic mutations', () => {
    const result = report.classifyStaleMachineTask(row({
        task_id: 40,
        source_type: 'recurring',
        task_type: 'recurring',
        creator_class: 'system',
        booking_found: false,
        booking_date_bucket: 'missing',
        has_template_id: true,
        template_found: true,
        template_active: true,
        template_context_match: true
    }));

    assert.equal(result.decision, 'report_candidate');
    assert.equal(result.cohort, 'candidate_recurring_template_stale');
    assert.equal(result.candidateArchiveReason, 'cleanup_candidate_recurring_template_stale_v1');
});

test('stale machine report is deterministic and stdout summary contains no task IDs or PII keys', () => {
    const rows = [
        row({ task_id: 3, booking_status: 'confirmed' }),
        row({ task_id: 1, booking_status: 'cancelled' }),
        row({ task_id: 2, booking_status: 'cancelled', captured_at: '2026-08-10T12:05:00.000Z' }),
        row({ task_id: 4, source_type: 'manual', task_type: 'manual', creator_class: 'unknown' })
    ];

    const first = report.buildStaleMachineReport(rows, { kyivToday: '2026-08-10', capturedAt: '2026-08-10T12:00:00.000Z' });
    const second = report.buildStaleMachineReport(rows.toReversed(), { kyivToday: '2026-08-10', capturedAt: '2026-08-10T13:00:00.000Z' });
    const summary = report.summaryForStdout(first);
    const serialized = JSON.stringify(summary);

    assert.equal(first.manifestChecksum, second.manifestChecksum);
    assert.equal(first.totals.reportCandidates, 3);
    assert.equal(first.totals.protected, 1);
    assert.equal(serialized.includes('"ids"'), false);
    assert.equal(serialized.includes('task_id'), false);
    assert.equal(serialized.includes('title'), false);
    assert.equal(serialized.includes('owner'), false);
    assert.equal(serialized.includes('source_id'), false);
});

test('stale machine report script is read-only and blocks mutation flags', () => {
    for (const flag of script.BLOCKED_FLAGS) {
        assert.throws(() => script.parseArgs([flag]), /report-only/);
    }

    const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const sql = script.buildReportSql();

    assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /SHOW transaction_read_only/);
    assert.match(source, /SHOW transaction_isolation/);
    assert.match(source, /ROLLBACK/);
    assert.match(sql, /scheduled_start_at AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(sql, /snoozed_until AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(sql, /task_action_history tah/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|MERGE|COMMIT)\b/i);
});

test('stale machine report accepts npm-forwarded positional output path', () => {
    assert.deepEqual(script.parseArgs(['.codex-temp/task-cleanup/stale-report.json']), {
        output: '.codex-temp/task-cleanup/stale-report.json',
        help: false
    });
});
