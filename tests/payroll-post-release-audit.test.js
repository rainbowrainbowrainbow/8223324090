'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const scriptPath = path.join(ROOT, 'scripts', 'audit-payroll-post-release.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const {
    FORBIDDEN_FLAGS,
    READ_ONLY_CONNECTION_ENV_KEYS,
    classifyPostReleaseAudit,
    mapCounterRow,
    parseArgs,
    poolConfig,
    renderMarkdown,
    resolveReadOnlyConnectionString,
    zeroCounters
} = require('../scripts/audit-payroll-post-release');

test('post-release audit requires activation month and refuses write-like flags', () => {
    assert.throws(
        () => parseArgs([]),
        error => error.code === 'PAYROLL_POST_RELEASE_ACTIVATION_MONTH_REQUIRED'
    );
    assert.throws(
        () => parseArgs(['--activation-month', '2026-13']),
        error => error.code === 'PAYROLL_POST_RELEASE_ACTIVATION_MONTH_INVALID'
    );
    assert.deepEqual(parseArgs(['--activation-month', '2026-08', '--format', 'markdown']), {
        activationMonth: '2026-08',
        aggregateOnly: true,
        format: 'markdown'
    });
    assert.deepEqual(parseArgs(['2026-08', 'markdown']), {
        activationMonth: '2026-08',
        aggregateOnly: true,
        format: 'markdown'
    });

    for (const flag of FORBIDDEN_FLAGS) {
        assert.throws(
            () => parseArgs(['--activation-month', '2026-08', flag]),
            error => error.code === 'PAYROLL_POST_RELEASE_READ_ONLY',
            `${flag} must be blocked`
        );
    }
});

test('post-release audit fails closed without dedicated read-only database URL', () => {
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
        error => error.code === 'PAYROLL_POST_RELEASE_READ_ONLY_DATABASE_REQUIRED'
    );
});

test('post-release audit resolves only dedicated read-only database URLs', () => {
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

    assert.deepEqual(poolConfig({
        PAYROLL_AUDIT_DATABASE_URL: 'postgres://audit.example.invalid/app',
        DATABASE_URL: 'postgres://writer.example.invalid/app',
        PGSSLMODE: 'disable'
    }), {
        connectionString: 'postgres://audit.example.invalid/app',
        ssl: false,
        application_name: 'payroll_post_release_readonly_audit'
    });
});

test('post-release audit source keeps read-only transaction guards and no write SQL', () => {
    assert.match(scriptSource, /BEGIN READ ONLY/);
    assert.match(scriptSource, /SHOW transaction_read_only/);
    assert.doesNotMatch(scriptSource, /\bINSERT\s+(?:INTO|OVERRIDING)/i);
    assert.doesNotMatch(scriptSource, /\bUPDATE\s+[a-z_"][\w"]*\s+SET\b/i);
    assert.doesNotMatch(scriptSource, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(scriptSource, /\bCREATE\s+(?:TABLE|INDEX|VIEW|FUNCTION|TRIGGER)\b/i);
});

test('post-release audit maps aggregate counters without PII fields', () => {
    assert.deepEqual(mapCounterRow({
        duplicate_payment_movements: '2',
        duplicate_finance_links: '1',
        movement_without_finance: '3',
        finance_payroll_without_movement: '4',
        amount_mismatch: '5',
        reversal_without_original_payment: '6',
        unresolved_overpayment: '7',
        outstanding_after_due_date: '8',
        mixed_settlement_models: '9',
        legacy_write_in_activation_month: '10',
        recognition_month_mismatch: '11',
        cash_flow_actual_date_mismatch: '12',
        legacy_accounted_reports: '13',
        staff_id: 99,
        staff_name: 'Should Not Surface',
        email: 'pii@example.invalid',
        phone: '+380000000000'
    }), {
        duplicatePaymentMovements: 2,
        duplicateFinanceLinks: 1,
        movementWithoutFinance: 3,
        financePayrollTransactionWithoutMovement: 4,
        paymentReversalAmountMismatch: 5,
        reversalWithoutOriginalPayment: 6,
        unresolvedOverpayment: 7,
        outstandingAfterDueDate: 8,
        mixedSettlementModels: 9,
        legacyWriteInActivationMonth: 10,
        recognitionMonthMismatch: 11,
        cashFlowActualDateMismatch: 12,
        legacyAccountedReports: 13
    });
});

test('post-release audit classifies stable, warning and hold states', () => {
    assert.equal(classifyPostReleaseAudit({ counters: zeroCounters(), schemaIssues: [] }).status, 'stable');

    const warning = classifyPostReleaseAudit({
        counters: { ...zeroCounters(), outstandingAfterDueDate: 2 },
        schemaIssues: []
    });
    assert.equal(warning.status, 'warning');
    assert.deepEqual(warning.warnings.map(item => item.key), ['outstandingAfterDueDate']);
    assert.deepEqual(warning.blockers, []);

    const hold = classifyPostReleaseAudit({
        counters: {
            ...zeroCounters(),
            duplicateFinanceLinks: 1,
            recognitionMonthMismatch: 2,
            paymentReversalAmountMismatch: 3
        },
        schemaIssues: []
    });
    assert.equal(hold.status, 'hold');
    assert.deepEqual(
        hold.blockers.map(item => item.key),
        ['duplicateFinanceLinks', 'paymentReversalAmountMismatch', 'recognitionMonthMismatch']
    );

    const schemaHold = classifyPostReleaseAudit({
        counters: zeroCounters(),
        schemaIssues: ['finance_transactions_recognition_date_missing']
    });
    assert.equal(schemaHold.status, 'hold');
    assert.equal(schemaHold.blockers[0].code, 'PAYROLL_POST_RELEASE_SCHEMA_INCOMPLETE');
});

test('post-release audit output is aggregate-only and preserves legacy_accounted semantics', () => {
    const markdown = renderMarkdown({
        generatedAt: '2026-08-20T00:00:00.000Z',
        scope: { activationMonth: '2026-08' },
        counters: {
            ...zeroCounters(),
            duplicateFinanceLinks: 1,
            outstandingAfterDueDate: 2,
            legacyAccountedReports: 3
        },
        legacySemantics: {
            legacyStatus: 'legacy_accounted',
            paymentFactVerifiedFromLegacyPaid: false,
            message: 'Історично враховано; факт виплати користувачем не підтверджено',
            staffName: 'Should Not Surface',
            email: 'pii@example.invalid'
        },
        staffId: 123,
        staffName: 'Should Not Surface',
        email: 'pii@example.invalid',
        decision: classifyPostReleaseAudit({
            counters: {
                ...zeroCounters(),
                duplicateFinanceLinks: 1,
                outstandingAfterDueDate: 2,
                legacyAccountedReports: 3
            },
            schemaIssues: []
        })
    });

    assert.match(markdown, /legacy_accounted/);
    assert.match(markdown, /payment fact verified from legacy paid: false/);
    assert.match(markdown, /legacyAccountedReports: 3/);
    assert.doesNotMatch(markdown, /Should Not Surface/);
    assert.doesNotMatch(markdown, /pii@example\.invalid/);
    assert.doesNotMatch(markdown, /staffId/i);
});

test('post-release audit package wiring is present and included in payroll contracts', () => {
    assert.equal(
        packageJson.scripts['audit:payroll-post-release'],
        'node scripts/audit-payroll-post-release.js'
    );
    assert.match(
        packageJson.scripts['test:payroll-contracts'],
        /tests\/payroll-post-release-audit\.test\.js/
    );
});
