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
        same_template_date_duplicate: overrides.same_template_date_duplicate || false,
        health_score: Object.prototype.hasOwnProperty.call(overrides, 'health_score') ? overrides.health_score : null,
        kyiv_today: overrides.kyiv_today || '2026-08-10',
        captured_at: overrides.captured_at || '2026-08-10T12:00:00.000Z'
    };
}

test('stale machine report marks only terminal strict booking cohorts as report-only candidates', () => {
    const cancelled = report.classifyStaleMachineTask(row({ task_id: 1, booking_status: 'cancelled' }));
    const past = report.classifyStaleMachineTask(row({ task_id: 2, booking_status: 'confirmed' }));

    assert.equal(cancelled.decision, 'report_candidate');
    assert.equal(cancelled.cohort, 'candidate_strict_booking_cancelled');
    assert.equal(cancelled.candidateArchiveReason, 'cleanup_candidate_strict_booking_cancelled_v1');

    assert.equal(past.decision, 'protected');
    assert.equal(past.cohort, 'protected_booking_past_active_needs_business_decision');
    assert.equal(past.candidateArchiveReason, undefined);
});

test('stale machine report keeps plain manual outside automation denominator and protects machine-like records', () => {
    const manual = report.classifyStaleMachineTask(row({
        task_id: 10,
        source_type: 'manual',
        task_type: 'manual',
        creator_class: 'human_named_or_legacy',
        created_by_user_id: 7
    }));
    assert.equal(manual.decision, 'ignored');
    assert.equal(manual.cohort, 'outside_automation_scope_human_manual_overdue');

    const unknown = report.classifyStaleMachineTask(row({
        task_id: 15,
        source_type: 'unknown',
        task_type: 'unknown',
        creator_class: 'unknown',
        health_score: 0
    }));
    assert.equal(unknown.decision, 'ignored');
    assert.equal(unknown.cohort, 'outside_automation_scope_unknown_overdue');

    const results = [
        report.classifyStaleMachineTask(row({ task_id: 11, visibility: 'private' })),
        report.classifyStaleMachineTask(row({ task_id: 12, source_type: 'ai_draft', task_type: 'ai_draft', created_by_user_id: 8 })),
        report.classifyStaleMachineTask(row({ task_id: 13, source_type: 'hermes', creator_class: 'hermes' })),
        report.classifyStaleMachineTask(row({ task_id: 14, source_type: 'attendance' }))
    ];
    assert.ok(results.every(item => item.decision === 'protected'));
    assert.ok(results.some(item => item.cohort === 'protected_attendance'));
    assert.ok(results.some(item => item.cohort === 'protected_hermes_or_integration'));
    assert.ok(results.some(item => item.cohort === 'protected_ai_assisted'));
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

test('stale recurring/template generated tasks require valid lineage and stay protected', () => {
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

    assert.equal(result.decision, 'protected');
    assert.equal(result.cohort, 'protected_recurring_expected_template_series');
    assert.equal(result.candidateArchiveReason, undefined);

    const missing = report.classifyStaleMachineTask(row({
        task_id: 41,
        source_type: 'recurring',
        task_type: 'recurring',
        creator_class: 'system',
        booking_found: false,
        booking_date_bucket: 'missing',
        has_template_id: true,
        template_found: false
    }));
    assert.equal(missing.decision, 'protected');
    assert.equal(missing.cohort, 'protected_recurring_missing_or_orphan_template');

    assert.equal(report.classifyStaleMachineTask(row({
        task_id: 42,
        source_type: 'recurring',
        task_type: 'recurring',
        creator_class: 'system',
        booking_found: false,
        booking_date_bucket: 'missing',
        has_template_id: true,
        template_found: true,
        template_active: false,
        template_context_match: true
    })).cohort, 'protected_recurring_inactive_template_residual');

    assert.equal(report.classifyStaleMachineTask(row({
        task_id: 43,
        source_type: 'recurring',
        task_type: 'recurring',
        creator_class: 'system',
        booking_found: false,
        booking_date_bucket: 'missing',
        has_template_id: true,
        template_found: true,
        template_active: true,
        template_context_match: false
    })).cohort, 'protected_recurring_template_context_mismatch');

    assert.equal(report.classifyStaleMachineTask(row({
        task_id: 44,
        source_type: 'recurring',
        task_type: 'recurring',
        creator_class: 'system',
        booking_found: false,
        booking_date_bucket: 'missing',
        has_template_id: true,
        template_found: true,
        template_active: true,
        template_context_match: true,
        same_template_date_duplicate: true
    })).cohort, 'protected_recurring_same_template_date_duplicate_review');
});

test('stale machine report reconciles only automation-marker overdue cohorts and stdout summary contains no task IDs or PII keys', () => {
    const rows = [
        row({ task_id: 3, booking_status: 'confirmed' }),
        row({ task_id: 1, booking_status: 'cancelled' }),
        row({ task_id: 2, booking_status: 'cancelled', captured_at: '2026-08-10T12:05:00.000Z' }),
        row({ task_id: 4, source_type: 'manual', task_type: 'manual', creator_class: 'unknown' }),
        row({ task_id: 5, booking_status: 'cancelled', canonical_overdue: false })
    ];

    const first = report.buildStaleMachineReport(rows, { kyivToday: '2026-08-10', capturedAt: '2026-08-10T12:00:00.000Z' });
    const second = report.buildStaleMachineReport(rows.toReversed(), { kyivToday: '2026-08-10', capturedAt: '2026-08-10T13:00:00.000Z' });
    const summary = report.summaryForStdout(first);
    const serialized = JSON.stringify(summary);

    assert.equal(first.manifestChecksum, second.manifestChecksum);
    assert.equal(first.totals.reportCandidates, 2);
    assert.equal(first.totals.protected, 2);
    assert.equal(first.totals.ignored, 1);
    assert.equal(first.totals.automationOverdue, 3);
    assert.equal(first.totals.strictMachineOverdue, 3);
    assert.equal(first.totals.humanManualOverdue, 1);
    assert.equal(first.overdueReconciliation.ok, true);
    assert.equal(first.overdueReconciliation.reconciledTotal, 3);
    assert.match(first.overdueReconciliation.membershipChecksum, /^[a-f0-9]{64}$/);
    assert.match(first.overdueReconciliation.evidenceChecksum, /^[a-f0-9]{64}$/);
    assert.ok(first.cohorts.every(cohort => Array.isArray(cohort.records)));
    assert.ok(first.cohorts.some(cohort => cohort.records.some(record => record.taskId === 1)));
    assert.equal(serialized.includes('"ids"'), false);
    assert.equal(serialized.includes('"taskId"'), false);
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
    assert.match(sql, /same_template_date_duplicate/);
    assert.doesNotMatch(sql, /ANY\(ARRAY\[[^\]]*'manual'/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|MERGE|COMMIT)\b/i);
});

test('stale machine report accepts npm-forwarded positional output path', () => {
    assert.deepEqual(script.parseArgs(['.codex-temp/task-cleanup/stale-report.json']), {
        output: '.codex-temp/task-cleanup/stale-report.json',
        help: false
    });
});
