'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING,
    MACHINE_LIFECYCLE_MARKER_VERSION,
    OWNER_ACCEPTANCE_ACTIONS,
    TASK_AUTOMATION_POLICY_VERSION,
    buildMachineTaskControlMetaPatch,
    classifyTaskAutomation,
    classifyTaskKpiEligibility,
    hasAutomationMarkerScope,
    hasStrictMachineProvenance,
    isTrustedCancelledBookingAutoArchiveMarked,
    taskKpiEligibleSql,
    taskProtectedKpiSignalSql,
    taskOwnerAcceptedSql
} = require('../services/taskAutomationPolicy');
const { TASK_ACTION_TYPES } = require('../services/taskActionConstants');

const ROOT = path.join(__dirname, '..');

test('shared automation policy uses canonical owner action types only', () => {
    assert.equal(TASK_AUTOMATION_POLICY_VERSION, 'task_automation_policy_v1');
    for (const action of [
        TASK_ACTION_TYPES.ACKNOWLEDGED,
        TASK_ACTION_TYPES.COMPLETED,
        TASK_ACTION_TYPES.STATUS_CHANGED,
        TASK_ACTION_TYPES.RESCHEDULED,
        TASK_ACTION_TYPES.SNOOZED,
        TASK_ACTION_TYPES.COMMENTED
    ]) {
        assert.ok(OWNER_ACCEPTANCE_ACTIONS.includes(action));
    }
    for (const stale of ['completed', 'status_changed', 'rescheduled', 'snoozed', 'commented', 'urgent_commitment']) {
        assert.equal(OWNER_ACCEPTANCE_ACTIONS.includes(stale), false);
    }
});

test('machine owner acceptance requires owner-authored task_action_history evidence', () => {
    const accepted = taskOwnerAcceptedSql('t');
    assert.match(accepted, /task_action_history/);
    assert.match(accepted, /actor_user_id = t\.owner_user_id/);
    assert.match(accepted, /actor_user_id IS NOT NULL/);
    assert.doesNotMatch(accepted, /LOWER\(COALESCE\(t\.status, 'todo'\)\) IN \('done', 'completed'\)/);

    const eligible = taskKpiEligibleSql('t');
    assert.match(eligible, /task_action_history/);
    assert.doesNotMatch(eligible, /status, 'todo'\)\) IN \('done', 'completed'\)\s+OR EXISTS/);
});

test('classification protects manual private AI integration and unknown provenance fail-closed', () => {
    assert.equal(classifyTaskAutomation({ created_by_user_id: 7 }).classification, 'human_created');
    assert.equal(classifyTaskAutomation({ visibility: 'private' }).classification, 'ambiguous_protected');
    assert.equal(classifyTaskAutomation({ source_type: 'ai_draft', created_by_user_id: 8 }).classification, 'ambiguous_protected');
    assert.equal(classifyTaskAutomation({ source_type: 'hermes' }).classification, 'ambiguous_protected');
    assert.equal(classifyTaskAutomation({ source_type: 'manual', type: 'auto', created_by: 'rule_engine' }).classification, 'ambiguous_protected');
});

test('strict machine provenance is explicit and narrow', () => {
    assert.equal(hasStrictMachineProvenance({
        source_type: 'booking',
        type: 'auto_complete',
        created_by: 'rule_engine',
        created_by_user_id: null
    }), true);
    assert.equal(hasStrictMachineProvenance({
        source_type: 'booking',
        type: 'auto_complete',
        created_by: 'rule_engine',
        created_by_user_id: 4
    }), false);
    assert.equal(hasStrictMachineProvenance({
        source_type: 'recurring',
        type: 'recurring',
        created_by: 'system',
        created_by_user_id: null
    }), true);
});

test('trusted machine lifecycle marker is versioned and not sufficient without explicit auto-archive policy', () => {
    const recurring = buildMachineTaskControlMetaPatch('recurring_task_template', { ruleId: 42 });
    assert.equal(recurring.machineLifecycle.markerVersion, MACHINE_LIFECYCLE_MARKER_VERSION);
    assert.equal(recurring.machineLifecycle.serviceOwned, true);
    assert.equal(recurring.machineLifecycle.autoArchivePolicy, null);
    assert.equal(isTrustedCancelledBookingAutoArchiveMarked({ control_meta: recurring }), false);

    const booking = buildMachineTaskControlMetaPatch('booking_automation', {
        lifecycleAutoArchivePolicy: MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING
    });
    assert.equal(booking.machineLifecycle.autoArchivePolicy, MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING);
    assert.equal(isTrustedCancelledBookingAutoArchiveMarked({ control_meta: booking }), true);

    assert.equal(isTrustedCancelledBookingAutoArchiveMarked({
        control_meta: {
            machineLifecycle: {
                markerVersion: MACHINE_LIFECYCLE_MARKER_VERSION,
                serviceOwned: true,
                autoArchivePolicy: null
            }
        }
    }), false);
});

test('booking/event creation paths opt into cancelled-booking auto-archive while recurring stays report-only', () => {
    const bookingAutomation = fs.readFileSync(path.join(ROOT, 'services', 'bookingAutomation.js'), 'utf8');
    const eventBus = fs.readFileSync(path.join(ROOT, 'services', 'eventBus.js'), 'utf8');
    const scheduler = fs.readFileSync(path.join(ROOT, 'services', 'scheduler.js'), 'utf8');

    assert.match(bookingAutomation, /MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING/);
    assert.match(bookingAutomation, /lifecycleAutoArchivePolicy: bookingId \? MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING : null/);
    assert.match(eventBus, /lifecycleAutoArchivePolicy: bookingSourceId \? MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING : null/);
    assert.doesNotMatch(scheduler, /MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING/);
    assert.match(scheduler, /buildMachineTaskControlMetaPatch\('recurring_task_template'/);
});

test('KPI eligibility classifies owner-accepted, system-completed, human, terminal and ambiguous cases', () => {
    assert.deepEqual(classifyTaskKpiEligibility({
        source_type: 'booking',
        type: 'auto_complete',
        created_by: 'rule_engine',
        owner_accepted: true,
        status: 'todo'
    }), { eligible: true, classification: 'machine_owner_accepted', reason: 'owner_action_history' });

    assert.deepEqual(classifyTaskKpiEligibility({
        source_type: 'booking',
        type: 'auto_complete',
        created_by: 'rule_engine',
        status: 'done'
    }), { eligible: false, classification: 'machine_unaccepted', reason: 'missing_owner_action_history' });

    assert.deepEqual(classifyTaskKpiEligibility({
        source_type: 'manual',
        type: 'manual',
        created_by_user_id: 7,
        status: 'completed'
    }), { eligible: true, classification: 'human_created', reason: 'human_created' });

    assert.deepEqual(classifyTaskKpiEligibility({
        source_type: 'manual',
        type: 'manual',
        created_by_user_id: 7,
        status: 'archived',
        archived_at: '2026-08-10T10:00:00.000Z'
    }), { eligible: false, classification: 'terminal_excluded', reason: 'archived_or_cancelled' });

    assert.deepEqual(classifyTaskKpiEligibility({
        source_type: '',
        type: '',
        created_by: ''
    }), { eligible: false, classification: 'ambiguous_excluded', reason: 'ambiguous_provenance' });

    for (const row of [
        {
            source_type: 'booking',
            type: 'auto_complete',
            created_by: 'rule_engine',
            created_by_user_id: 9,
            status: 'done'
        },
        {
            source_type: 'ai_draft',
            type: 'manual',
            created_by_user_id: 9,
            status: 'done'
        },
        {
            source_type: 'hermes',
            type: 'manual',
            created_by_user_id: 9,
            status: 'done'
        },
        {
            source_type: 'attendance',
            type: 'manual',
            created_by_user_id: 9,
            status: 'done'
        },
        {
            source_type: 'manual',
            type: 'manual',
            created_by_user_id: 9,
            visibility: 'private',
            status: 'done'
        }
    ]) {
        assert.equal(
            classifyTaskKpiEligibility(row).eligible,
            false,
            'typed creator must not override machine/protected provenance'
        );
    }
});

test('KPI SQL applies protected and machine precedence before typed human creator', () => {
    const eligible = taskKpiEligibleSql('t');
    assert.match(eligible, /AND NOT \(\s*LOWER\(COALESCE\(t\.visibility, ''\)\) IN/);
    assert.match(eligible, /NOT \(\s*LOWER\(COALESCE\(t\.created_by, ''\)\) IN/);
    assert.match(eligible, /COALESCE\(t\.created_by_user_id, 0\) > 0/);
    assert.match(eligible, /OR \(\s*\(\s*LOWER\(COALESCE\(t\.created_by, ''\)\) IN[\s\S]*AND EXISTS \(/);

    const protectedSql = taskProtectedKpiSignalSql('t');
    assert.match(protectedSql, /'private'/);
    assert.match(protectedSql, /'ai_draft'/);
    assert.match(protectedSql, /'hermes'/);
    assert.match(protectedSql, /'attendance'/);
});

test('automation marker scope excludes plain manual but keeps unanchored rule_engine/manual automation', () => {
    assert.equal(hasAutomationMarkerScope({
        source_type: 'manual',
        type: 'manual',
        created_by: 'sergiy',
        created_by_user_id: 7
    }), false);
    assert.equal(hasAutomationMarkerScope({
        source_type: 'manual',
        type: 'auto',
        created_by: 'rule_engine',
        created_by_user_id: null
    }), true);
    assert.equal(hasAutomationMarkerScope({
        source_type: 'booking',
        type: 'manual',
        created_by: 'booking_legacy'
    }), true);
    assert.equal(hasAutomationMarkerScope({
        source_type: 'manual',
        type: 'manual',
        source_module: 'hermes',
        created_by_user_id: 12
    }), true);
});

test('task subsystems import the shared automation policy', () => {
    for (const file of [
        ['services', 'taskPerformancePolicy.js'],
        ['services', 'taskLifecycle.js'],
        ['services', 'taskStaleMachineReport.js'],
        ['services', 'bookingAutomation.js'],
        ['services', 'eventBus.js'],
        ['services', 'scheduler.js']
    ]) {
        const source = fs.readFileSync(path.join(ROOT, ...file), 'utf8');
        assert.match(source, /taskAutomationPolicy/);
    }
});
