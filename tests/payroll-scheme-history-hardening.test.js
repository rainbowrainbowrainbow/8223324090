const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    applyReportSnapshot,
    createPayrollScheme,
    loadActivePayrollSchemeMap,
    payrollInstallmentSnapshot,
    payrollSchemeConfigHash,
    updatePayrollScheme
} = require('../services/payroll');

const ROOT = path.join(__dirname, '..');

test('scheme config hash is stable by key order and changes with calculation config', () => {
    assert.equal(
        payrollSchemeConfigHash({ monthlyAmount: 30000, nested: { b: 2, a: 1 } }),
        payrollSchemeConfigHash({ nested: { a: 1, b: 2 }, monthlyAmount: 30000 })
    );
    assert.notEqual(
        payrollSchemeConfigHash({ monthlyAmount: 30000 }),
        payrollSchemeConfigHash({ monthlyAmount: 33000 })
    );
});

test('reviewed, approved, and paid read models restore immutable scheme and norm metadata', () => {
    for (const status of ['reviewed', 'approved', 'paid']) {
        const restored = applyReportSnapshot({
            schemeId: 202,
            schemeVersionId: 202,
            schemeType: 'monthly_fixed',
            schemeTitle: 'Live v2',
            schemeConfigHash: 'new-hash',
            schemeEffectiveFrom: '2026-08-01',
            plannedMinutes: 10080,
            paidPlannedMinutes: 10080,
            monthlyNormMinutes: 10080,
            monthlyNormSource: 'live',
            monthlyNormConfirmed: true,
            monthlyNormMonth: '2026-08',
            physicalMinutes: 9000,
            lines: [],
            summary: { base: 33000, net: 33000 }
        }, {
            status,
            gross_amount: 30000,
            deductions_amount: 0,
            advances_amount: 0,
            net_amount: 30000,
            breakdown_json: {
                scheme: {
                    id: 101,
                    versionId: 101,
                    type: 'monthly_fixed',
                    title: 'Snapshot v1',
                    configHash: 'old-hash',
                    effectiveFrom: '2026-07-01',
                    effectiveTo: null,
                    updatedAt: '2026-06-20T10:00:00.000Z'
                },
                metrics: {
                    plannedMinutes: 10560,
                    paidPlannedMinutes: 9600,
                    monthlyNormMinutes: 10560,
                    monthlyNormSource: 'approved_schedule_v1',
                    monthlyNormConfirmed: true,
                    monthlyNormMonth: '2026-07',
                    physicalMinutes: 9000
                },
                lines: [{ group: 'base', amount: 30000 }],
                summary: { base: 30000, net: 30000 }
            }
        });

        assert.equal(restored.schemeId, 101);
        assert.equal(restored.schemeConfigHash, 'old-hash');
        assert.equal(restored.schemeEffectiveFrom, '2026-07-01');
        assert.equal(restored.plannedMinutes, 10560);
        assert.equal(restored.paidPlannedMinutes, 9600);
        assert.equal(restored.monthlyNormMinutes, 10560);
        assert.equal(restored.monthlyNormSource, 'approved_schedule_v1');
        assert.equal(restored.monthlyNormMonth, '2026-07');
        assert.equal(restored.summary.base, 30000);
    }
});

test('installment fingerprint includes immutable scheme version and config metadata', () => {
    const row = {
        staffId: 7,
        name: 'Test User',
        schemeId: 101,
        schemeVersionId: 101,
        schemeType: 'monthly_fixed',
        schemeTitle: 'Snapshot v1',
        schemeConfigHash: 'hash-v1',
        schemeEffectiveFrom: '2026-07-01',
        schemeEffectiveTo: null,
        netAmount: 30000,
        lines: []
    };
    const first = payrollInstallmentSnapshot('final', row, {
        calculatedAmount: 30000,
        calculationSnapshot: { monthlyNetAmount: 30000 }
    });
    const second = payrollInstallmentSnapshot('final', {
        ...row,
        schemeId: 102,
        schemeVersionId: 102,
        schemeConfigHash: 'hash-v2'
    }, {
        calculatedAmount: 30000,
        calculationSnapshot: { monthlyNetAmount: 30000 }
    });

    assert.equal(first.payrollReport.versionId, 101);
    assert.equal(first.payrollReport.configHash, 'hash-v1');
    assert.notEqual(first.sourceFingerprint, second.sourceFingerprint);
});

test('scheme creation rejects missing effectiveFrom before any calculation write', async () => {
    const queries = [];
    const client = {
        async query(sql) {
            queries.push(String(sql));
            if (/SELECT id FROM staff/i.test(sql)) return { rowCount: 1, rows: [{ id: 7 }] };
            return { rowCount: 0, rows: [] };
        },
        release() {}
    };
    const db = { connect: async () => client };

    await assert.rejects(
        createPayrollScheme({ staffId: 7, schemeType: 'hourly', config: { hourlyRate: 100 } }, {}, { db }),
        error => error.code === 'PAYROLL_SCHEME_EFFECTIVE_FROM_REQUIRED' && error.status === 400
    );
    assert.equal(queries.some(sql => /INSERT INTO payroll_schemes/i.test(sql)), false);
});

test('superseding scheme requires a strictly later effectiveFrom', async () => {
    const queries = [];
    const source = {
        id: 101,
        staff_id: 7,
        scheme_type: 'hourly',
        config_json: { hourlyRate: 100 },
        effective_from: '2026-07-01',
        is_active: true
    };
    const client = {
        async query(sql) {
            queries.push(String(sql));
            if (/SELECT id FROM staff/i.test(sql)) return { rowCount: 1, rows: [{ id: 7 }] };
            if (/SELECT \* FROM payroll_schemes/i.test(sql)) return { rowCount: 1, rows: [source] };
            return { rowCount: 0, rows: [] };
        },
        release() {}
    };
    const db = {
        async query() {
            return { rowCount: 1, rows: [{ staff_id: 7 }] };
        },
        async connect() {
            return client;
        }
    };

    await assert.rejects(
        updatePayrollScheme(101, {
            staffId: 7,
            schemeType: 'hourly',
            effectiveFrom: '2026-07-01',
            config: { hourlyRate: 110 }
        }, {}, { db }),
        error => error.code === 'PAYROLL_SCHEME_EFFECTIVE_FROM_NOT_AFTER_SOURCE' && error.status === 409
    );
    assert.equal(queries.some(sql => /INSERT INTO payroll_schemes/i.test(sql)), false);
});

test('pg DATE normalization keeps local calendar components instead of UTC shifting', async () => {
    const effectiveFrom = new Date('2026-06-30T21:00:00.000Z');
    effectiveFrom.getFullYear = () => 2026;
    effectiveFrom.getMonth = () => 6;
    effectiveFrom.getDate = () => 1;
    const db = {
        async query() {
            return {
                rows: [{
                    id: 101,
                    staff_id: 7,
                    scheme_type: 'hourly',
                    config_json: { hourlyRate: 100 },
                    effective_from: effectiveFrom,
                    is_active: true
                }]
            };
        }
    };

    const scheme = (await loadActivePayrollSchemeMap([7], '2026-07', db)).get(7);
    assert.equal(scheme.effectiveFrom, '2026-07-01');
});

test('service and Finance UI enforce copy-on-write and preserve legacy finance links', () => {
    const service = fs.readFileSync(path.join(ROOT, 'services', 'payroll.js'), 'utf8');
    const finance = fs.readFileSync(path.join(ROOT, 'js', 'finance-page.js'), 'utf8');
    const saveStart = finance.indexOf('async function saveSalaryScheme()');
    const saveEnd = finance.indexOf('async function generateSalaryReport()', saveStart);
    const saveBody = finance.slice(saveStart, saveEnd);

    assert.doesNotMatch(service, /UPDATE payroll_schemes SET\s+scheme_type/i);
    assert.match(service, /PAYROLL_SCHEME_EFFECTIVE_FROM_REQUIRED/);
    assert.match(service, /lockPayrollPeriodMutation\(month, client\)/);
    assert.match(service, /PAYROLL_LEGACY_FINANCE_LINK_CONFLICT/);
    assert.doesNotMatch(service, /finance_transaction_id\s*=\s*NULL/i);
    assert.doesNotMatch(service, /reversal_transaction_id\s*=\s*NULL/i);
    assert.match(finance, /Нова версія діє з/);
    assert.match(saveBody, /effectiveFrom:\s*draft\.effectiveFrom/);
    assert.match(saveBody, /apiRequest\('POST', '\/api\/payroll\/schemes', body\)/);
    assert.doesNotMatch(saveBody, /apiRequest\('PATCH'/);
});
