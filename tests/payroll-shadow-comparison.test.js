'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const scriptSource = fs.readFileSync(
    path.join(ROOT, 'scripts', 'shadow-payroll-installment-comparison.js'),
    'utf8'
);

const {
    FORBIDDEN_FLAGS,
    READ_ONLY_CONNECTION_ENV_KEYS,
    buildPayrollShadowComparisonRow,
    classifyPayrollShadowDelta,
    collectPayrollShadowComparison,
    parseArgs,
    resolveReadOnlyConnectionString,
    resolveRequestedMonths,
    summarizeRows
} = require('../scripts/shadow-payroll-installment-comparison');

function fakeShadowClient({ hasInstallments = false, legacyRows = [], closedMonths = ['2026-07', '2026-06', '2026-05'] } = {}) {
    const queries = [];
    const columns = new Set([
        'payroll_reports.net_amount',
        'payroll_reports.status',
        'payroll_reports.voided_at',
        'payroll_reports.breakdown_json'
    ]);
    return {
        queries,
        async query(text, params = []) {
            queries.push(String(text));
            if (/to_regclass\(\$1\)/i.test(text)) {
                const rel = String(params[0] || '');
                const exists = rel === 'public.payroll_reports'
                    || (hasInstallments && ['public.payroll_installments', 'public.payroll_payment_movements'].includes(rel));
                return { rowCount: 1, rows: [{ rel: exists ? rel : null }] };
            }
            if (/information_schema\.columns/i.test(text)) {
                return { rowCount: columns.has(`${params[0]}.${params[1]}`) ? 1 : 0, rows: columns.has(`${params[0]}.${params[1]}`) ? [{ '?column?': 1 }] : [] };
            }
            if (/SELECT period_month\s+FROM payroll_reports/i.test(text)) {
                return { rowCount: closedMonths.length, rows: closedMonths.map(period_month => ({ period_month })) };
            }
            if (/SELECT id AS report_id/i.test(text)) {
                return { rowCount: legacyRows.length, rows: legacyRows };
            }
            if (/JOIN payroll_installments/i.test(text)) {
                return { rowCount: 0, rows: [] };
            }
            throw new Error(`Unexpected query in fake payroll shadow client: ${text.slice(0, 120)}`);
        }
    };
}

test('payroll shadow comparison script is read-only and refuses write-like flags', () => {
    assert.match(scriptSource, /BEGIN READ ONLY/);
    assert.match(scriptSource, /SHOW transaction_read_only/);
    assert.doesNotMatch(scriptSource, /\bINSERT\s+/i);
    assert.doesNotMatch(scriptSource, /\bUPDATE\s+/i);
    assert.doesNotMatch(scriptSource, /\bDELETE\s+/i);
    assert.doesNotMatch(scriptSource, /\bCREATE\s+/i);

    for (const flag of FORBIDDEN_FLAGS) {
        assert.throws(
            () => parseArgs(['--month', '2026-07', flag]),
            error => error.code === 'PAYROLL_SHADOW_READ_ONLY'
        );
    }
});

test('shadow comparison fails closed without explicit read-only database URL', () => {
    assert.deepEqual(READ_ONLY_CONNECTION_ENV_KEYS, [
        'PAYROLL_AUDIT_DATABASE_URL',
        'PRODUCTION_READONLY_DATABASE_URL'
    ]);
    assert.doesNotMatch(scriptSource, /require\(['"]\.\.\/db['"]\)/);
    assert.doesNotMatch(scriptSource, /process\.env\.DATABASE_URL/);

    assert.throws(
        () => resolveReadOnlyConnectionString({
            DATABASE_URL: 'postgres://writer.example.invalid/app'
        }),
        error => error.code === 'PAYROLL_SHADOW_READ_ONLY_DATABASE_REQUIRED'
    );
});

test('shadow comparison resolves only dedicated read-only database URLs', () => {
    assert.deepEqual(resolveReadOnlyConnectionString({
        DATABASE_URL: 'postgres://writer.example.invalid/app',
        PRODUCTION_READONLY_DATABASE_URL: 'postgres://readonly.example.invalid/app'
    }), {
        key: 'PRODUCTION_READONLY_DATABASE_URL',
        connectionString: 'postgres://readonly.example.invalid/app'
    });

    assert.deepEqual(resolveReadOnlyConnectionString({
        DATABASE_URL: 'postgres://writer.example.invalid/app',
        PRODUCTION_READONLY_DATABASE_URL: 'postgres://readonly.example.invalid/app',
        PAYROLL_AUDIT_DATABASE_URL: 'postgres://audit.example.invalid/app'
    }), {
        key: 'PAYROLL_AUDIT_DATABASE_URL',
        connectionString: 'postgres://audit.example.invalid/app'
    });
});

test('activation mode selects the latest closed months before activation month', async () => {
    const client = fakeShadowClient({
        legacyRows: ['2026-05', '2026-06', '2026-07'].map((period_month, index) => ({
            report_id: index + 1,
            period_month,
            staff_id: 10,
            old_monthly_total: 1000,
            breakdown_json: {}
        }))
    });
    const result = await collectPayrollShadowComparison(client, {
        activationMonth: '2026-08',
        closedMonths: 3,
        previewBuilder: async () => ({
            advanceAmount: 400,
            finalAmount: 600,
            combinedAmount: 1000,
            blockers: [],
            advanceInstallment: { calculationSnapshot: { roundedOnce: true } },
            finalInstallment: { calculationSnapshot: {} }
        })
    });

    assert.deepEqual(result.selectedMonths, ['2026-05', '2026-06', '2026-07']);
    assert.equal(result.rows[0].newAdvance, 400);
    assert.equal(result.rows[0].newFinal, 600);
    assert.deepEqual(result.rows[0].categories, ['matched']);
    assert.equal(result.summary.activationBlocked, false);
    assert.deepEqual(result.summary.sourceCoverage, {
        requestedClosedMonths: 3,
        selectedClosedMonths: 3,
        comparedClosedMonths: 3,
        missingClosedMonths: 0,
        unrepresentedClosedMonths: 0,
        comparableRowsPresent: true
    });
});

test('activation shadow comparison blocks when closed-month source coverage is missing', async () => {
    const client = fakeShadowClient({ closedMonths: [], legacyRows: [] });
    const result = await collectPayrollShadowComparison(client, {
        activationMonth: '2026-08',
        closedMonths: 3,
        previewBuilder: async () => ({ advanceAmount: 0, finalAmount: 0, combinedAmount: 0, blockers: [] })
    });

    assert.deepEqual(result.selectedMonths, []);
    assert.equal(result.rows.length, 0);
    assert.equal(result.summary.activationBlocked, true);
    assert.equal(result.summary.categoryCounts.missing_source_data, 3);
    assert.deepEqual(result.summary.sourceCoverage, {
        requestedClosedMonths: 3,
        selectedClosedMonths: 0,
        comparedClosedMonths: 0,
        missingClosedMonths: 3,
        unrepresentedClosedMonths: 0,
        comparableRowsPresent: false
    });
});

test('shadow comparison does not require payroll_installments before migrations 302-306', async () => {
    const client = fakeShadowClient({
        hasInstallments: false,
        legacyRows: [{
            report_id: 2,
            period_month: '2026-07',
            staff_id: 11,
            old_monthly_total: 1250,
            breakdown_json: {}
        }]
    });
    const result = await collectPayrollShadowComparison(client, {
        month: '2026-07',
        previewBuilder: async () => ({
            advanceAmount: 500,
            finalAmount: 750,
            combinedAmount: 1250,
            blockers: []
        })
    });

    assert.equal(result.summary.schema.payrollReports, true);
    assert.equal(result.summary.schema.payrollInstallments, false);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0].categories, ['matched']);
});

test('fixed, hourly and piece canonical previews compare advance plus final to monthly net', async () => {
    const fixtures = [
        { type: 'fixed', old: 3000, advance: 1450, final: 1550 },
        { type: 'hourly', old: 2600, advance: 1200, final: 1400 },
        { type: 'piece', old: 435, advance: 125, final: 310 }
    ];

    for (const fixture of fixtures) {
        const row = await buildPayrollShadowComparisonRow({
            period_month: '2026-07',
            staff_id: 12,
            old_monthly_total: fixture.old,
            canonicalPreview: {
                advanceAmount: fixture.advance,
                finalAmount: fixture.final,
                combinedAmount: fixture.advance + fixture.final,
                blockers: [],
                advanceInstallment: { kind: 'advance', schemeType: fixture.type },
                finalInstallment: { kind: 'final', schemeType: fixture.type }
            }
        });
        assert.equal(row.newAdvance + row.newFinal, fixture.old);
        assert.deepEqual(row.categories, ['matched']);
        assert.equal(row.activationBlocked, false);
    }
});

test('rounding is absorbed by final and remains non-blocking', () => {
    const rounding = classifyPayrollShadowDelta({
        oldMonthlyTotal: 999,
        newAdvance: 484,
        newFinal: 516,
        signals: ['rounding']
    });

    assert.equal(rounding.delta, 1);
    assert.deepEqual(rounding.categories, ['rounding']);
    assert.equal(rounding.activationBlocked, false);
});

test('known deltas are categorized and policy/data blockers stop activation', () => {
    const legacyZrs = classifyPayrollShadowDelta({
        oldMonthlyTotal: 1000,
        newAdvance: 400,
        newFinal: 550,
        signals: ['legacy_zrs']
    });
    assert.equal(legacyZrs.delta, -50);
    assert.deepEqual(legacyZrs.categories, ['legacy_zrs']);
    assert.equal(legacyZrs.activationBlocked, false);

    const leavePolicy = classifyPayrollShadowDelta({
        oldMonthlyTotal: 1000,
        newAdvance: 400,
        newFinal: 500,
        blockers: [{ code: 'PAYROLL_LEAVE_POLICY_UNDEFINED' }]
    });
    assert.equal(leavePolicy.delta, -100);
    assert.deepEqual(leavePolicy.categories, ['leave_policy']);
    assert.equal(leavePolicy.activationBlocked, true);
});

test('unknown delta blocks activation', () => {
    const unknown = classifyPayrollShadowDelta({
        oldMonthlyTotal: 1000,
        newAdvance: 400,
        newFinal: 500
    });

    assert.equal(unknown.delta, -100);
    assert.deepEqual(unknown.categories, ['unknown_delta']);
    assert.equal(unknown.activationBlocked, true);
});

test('aggregate summary contains no PII fields', () => {
    const summary = summarizeRows([
        { month: '2026-07', staffId: 1, categories: ['matched'], activationBlocked: false },
        { month: '2026-07', staffId: 2, categories: ['unknown_delta'], activationBlocked: true }
    ], { hasReports: true, hasInstallments: false, hasMovements: false });

    assert.deepEqual(summary, {
        rowCount: 2,
        months: { '2026-07': 2 },
        categoryCounts: { matched: 1, unknown_delta: 1 },
        activationBlocked: true,
        schema: {
            payrollReports: true,
            payrollInstallments: false,
            payrollPaymentMovements: false
        }
    });
    assert.equal(JSON.stringify(summary).includes('staffId'), false);
});

test('argument parser supports activation CLI and aggregate-only output mode', () => {
    assert.deepEqual(parseArgs([
        '--activation-month', '2026-08',
        '--closed-months', '3',
        '--aggregate-only',
        '--format', 'markdown'
    ]), {
        format: 'markdown',
        closedMonths: 3,
        aggregateOnly: true,
        activationMonth: '2026-08'
    });

    assert.deepEqual(resolveRequestedMonths({ activationMonth: '2026-08' }, []), {
        from: '2026-07',
        to: '2026-07',
        months: []
    });
});
