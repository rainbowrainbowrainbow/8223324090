'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ENTRY_FAMILIES, buildCompatibilityTelemetryReport } = require('../scripts/sys-mb-compatibility-telemetry-report.cjs');

function rowsFor(contexts = ['event_genix', 'dar', 'maysternya_doli', 'crm']) {
    const rows = [];
    for (const business_context of contexts) {
        for (const entry_family of ENTRY_FAMILIES) {
            rows.push({ business_context, entry_family, authority_source: 'membership', outcome: 'allowed', decision_count: 1 });
            rows.push({ business_context, entry_family, authority_source: 'compatibility', outcome: 'denied', decision_count: 1 });
        }
    }
    return rows;
}

test('compatibility telemetry report requires measured coverage for every required family and context', () => {
    const report = buildCompatibilityTelemetryReport(rowsFor(), { windowHours: 24 });
    assert.equal(report.status, 'PASS_MEASURED');
    assert.equal(report.unobserved.length, 0);
    assert.equal(report.legacyAllowed, 0);
});

test('compatibility telemetry report holds on missing coverage or allowed legacy authority', () => {
    const missing = buildCompatibilityTelemetryReport(rowsFor(['event_genix']), { contexts: ['event_genix', 'crm'] });
    assert.equal(missing.status, 'HOLD');
    assert.ok(missing.unobserved.includes('crm:http'));
    const legacy = buildCompatibilityTelemetryReport([
        ...rowsFor(['event_genix']),
        { business_context: 'event_genix', entry_family: 'http', authority_source: 'compatibility', outcome: 'allowed', decision_count: 2 }
    ], { contexts: ['event_genix'] });
    assert.equal(legacy.status, 'HOLD');
    assert.equal(legacy.legacyAllowed, 2);
});
