const test = require('node:test');
const assert = require('node:assert/strict');

const {
    APPLY_CONFIRMATION,
    SAFE_COHORT,
    buildAggregateAuditSql,
    buildRedactedCandidateManifest,
    buildRedactedManualReviewManifest,
    buildManualReviewSql,
    buildSafeOwnerCandidateSql,
    buildTerminalWorkflowMismatchSql,
    manifestHash,
    parseArgs
} = require('../scripts/task-legacy-data-remediation');

test('task legacy remediation defaults to dry-run and read-only audit credential', () => {
    const parsed = parseArgs([]);

    assert.equal(parsed.mode, 'dry-run');
    assert.equal(parsed.cohort, SAFE_COHORT);
});

test('task legacy remediation apply requires explicit guarded arguments', () => {
    assert.throws(
        () => parseArgs(['apply', '--cohort', 'unknown']),
        /Unsupported cohort/
    );

    const parsed = parseArgs([
        'apply',
        '--expected-count=0',
        '--manifest-hash=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        '--confirm',
        APPLY_CONFIRMATION
    ]);

    assert.equal(parsed.mode, 'apply');
    assert.equal(parsed.expectedCount, 0);
    assert.equal(parsed.confirmation, APPLY_CONFIRMATION);
});

test('task legacy remediation SQL uses canonical duplicate signature and read-safe aggregates', () => {
    const aggregateSql = buildAggregateAuditSql();
    const candidateSql = buildSafeOwnerCandidateSql();
    const manualReviewSql = buildManualReviewSql();
    const terminalSql = buildTerminalWorkflowMismatchSql();

    assert.match(aggregateSql, /active_duplicate_groups/);
    assert.match(aggregateSql, /duplicate_signature/);
    assert.match(aggregateSql, /task_action_history/);
    assert.match(aggregateSql, /my_day_task_impacts/);
    assert.match(candidateSql, /owner_user_id IS NULL/);
    assert.match(candidateSql, /matched_user_count = 1/);
    assert.match(candidateSql, /COALESCE\(u\.is_active, true\) IS TRUE/);
    assert.match(manualReviewSql, /OWNER_TOKEN_MANUAL_REVIEW/);
    assert.match(manualReviewSql, /TERMINAL_STATUS_WORKFLOW_MISMATCH/);
    assert.match(manualReviewSql, /DATE_DEADLINE_DISAGREEMENT/);
    assert.match(manualReviewSql, /PARTIAL_SOURCE_REFERENCE/);
    assert.match(terminalSql, /workflow_state/);
});

test('task legacy remediation redacted manifest does not expose task text or raw ids', () => {
    const manifest = buildRedactedCandidateManifest([
        {
            task_id: 12345,
            user_id: 7,
            business_context: 'event_genix',
            owner_token_source: 'assigned_to',
            title: 'SHOULD_NOT_APPEAR',
            customer_name: 'SHOULD_NOT_APPEAR'
        }
    ], 'fixed-salt');
    const encoded = JSON.stringify(manifest);

    assert.equal(manifest.length, 1);
    assert.match(manifest[0].opaqueTaskId, /^task_[a-f0-9]{20}$/);
    assert.doesNotMatch(encoded, /12345/);
    assert.doesNotMatch(encoded, /SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(encoded, /customer/i);
    assert.equal(typeof manifestHash(manifest), 'string');
    assert.equal(manifestHash(manifest).length, 64);
});

test('task legacy remediation manifest hash is stable for the same candidate snapshot', () => {
    const rows = [
        { task_id: 1001, business_context: 'event_genix', owner_token_source: 'owner' },
        { task_id: 1002, business_context: 'event_genix', owner_token_source: 'assigned_to' }
    ];

    const first = buildRedactedCandidateManifest(rows, 'stable-salt');
    const second = buildRedactedCandidateManifest(rows, 'stable-salt');

    assert.deepEqual(first, second);
    assert.equal(manifestHash(first), manifestHash(second));
});

test('task legacy remediation manual-review manifest contains only redacted classification data', () => {
    const manifest = buildRedactedManualReviewManifest([
        {
            task_id: 555,
            reason_code: 'PARTIAL_SOURCE_REFERENCE',
            affected_fields: ['source_type', 'source_id'],
            evidence_status: 'MISSING_SOURCE_COUNTERPART_OR_EXTERNAL_LEGACY_SOURCE',
            title: 'SHOULD_NOT_APPEAR'
        }
    ], 'manual-review-salt');
    const encoded = JSON.stringify(manifest);

    assert.equal(manifest.length, 1);
    assert.match(manifest[0].opaqueTaskId, /^task_[a-f0-9]{20}$/);
    assert.equal(manifest[0].reasonCode, 'PARTIAL_SOURCE_REFERENCE');
    assert.deepEqual(manifest[0].affectedFields, ['source_type', 'source_id']);
    assert.doesNotMatch(encoded, /555/);
    assert.doesNotMatch(encoded, /SHOULD_NOT_APPEAR/);
});
