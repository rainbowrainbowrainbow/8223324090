'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { REQUIRED_ENTRY_FAMILIES, buildCompatibilityTelemetryReport } = require('../scripts/sys-mb-compatibility-telemetry-report.cjs');

const NOW = '2026-09-22T12:00:00.000Z';
const START = '2026-09-08T00:00:00.000Z';
const RUNTIME = [{ eligible_count: 1000, persisted_count: 1000, failed_count: 0 }];

function measuredRows(contexts = Object.keys(REQUIRED_ENTRY_FAMILIES)) {
    const rows = [];
    for (const business_context of contexts) {
        for (const entry_family of REQUIRED_ENTRY_FAMILIES[business_context]) {
            for (let day = 0; day < 5; day++) {
                rows.push({ business_context, entry_family,
                    decision_stage: entry_family === 'http' ? 'admission' : entry_family === 'service' ? 'domain' : 'execution',
                    authority_source: 'membership', outcome: 'allowed',
                    observed_hour: `2026-09-${17 + day}T10:00:00.000Z`, eligible_count: 6, collected_count: 6, gap_count: 0 });
            }
            rows.push({ business_context, entry_family, decision_stage: 'admission', authority_source: 'compatibility', outcome: 'denied',
                observed_hour: '2026-09-21T11:00:00.000Z', eligible_count: 1, collected_count: 1, gap_count: 0 });
        }
    }
    return rows;
}

const options = { now: NOW, observationStartedAt: START, longestEnabledCycleHours: 24, runtimeRows: RUNTIME };

test('compatibility telemetry report passes only after the measured duration, traffic, family and reconciliation gates', () => {
    const report = buildCompatibilityTelemetryReport(measuredRows(), options);
    assert.equal(report.status, 'PASS_MEASURED');
    assert.deepEqual(report.blockers, []);
    assert.equal(report.unobserved.length, 0);
    assert.equal(report.insufficientTraffic.length, 0);
    assert.equal(report.runtimeReconciled, true);
    assert.equal(report.completeUtcDays, 14);
    assert.ok(report.contextTraffic.every(item => item.domainAllowed));
});

test('compatibility telemetry counts complete UTC days instead of rounding elapsed hours', () => {
    const report = buildCompatibilityTelemetryReport(measuredRows(), {
        ...options, observationStartedAt: '2026-09-08T12:01:00.000Z', now: '2026-09-22T23:59:00.000Z'
    });
    assert.equal(report.completeUtcDays, 13);
    assert.equal(report.status, 'HOLD');
    assert.ok(report.blockers.includes('observation_window_incomplete'));
});

test('compatibility telemetry report holds on missing family coverage or allowed legacy authority', () => {
    const rows = measuredRows();
    const missing = rows.filter(row => !(row.business_context === 'crm' && row.entry_family === 'job'));
    const missingReport = buildCompatibilityTelemetryReport(missing, options);
    assert.equal(missingReport.status, 'HOLD');
    assert.ok(missingReport.unobserved.includes('crm:job'));
    rows.push({ business_context: 'event_genix', entry_family: 'http', decision_stage: 'domain',
        authority_source: 'compatibility', outcome: 'allowed', observed_hour: '2026-09-21T12:00:00Z',
        eligible_count: 2, collected_count: 2, gap_count: 0 });
    const legacy = buildCompatibilityTelemetryReport(rows, options);
    assert.equal(legacy.status, 'HOLD');
    assert.equal(legacy.legacyAllowed, 2);
});

test('compatibility telemetry report cannot pass without cycle input, a complete window, real traffic and zero loss', () => {
    const rows = measuredRows();
    rows[0].eligible_count = 7;
    rows[0].gap_count = 1;
    const report = buildCompatibilityTelemetryReport(rows, {
        now: NOW, observationStartedAt: '2026-09-21T00:00:00Z', runtimeRows: [{ eligible_count: 10, persisted_count: 9, failed_count: 1 }]
    });
    assert.equal(report.status, 'HOLD');
    for (const blocker of ['longest_enabled_cycle_unknown', 'observation_window_incomplete', 'telemetry_reconciliation_failed']) {
        assert.ok(report.blockers.includes(blocker));
    }
});
