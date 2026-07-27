const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const hrPage = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
const hrRoute = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
const payrollRoute = fs.readFileSync(path.join(ROOT, 'routes', 'payroll.js'), 'utf8');
const reportsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'reports.js'), 'utf8');
const staffRoute = fs.readFileSync(path.join(ROOT, 'routes', 'staff.js'), 'utf8');
const packageJson = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
const payrollSettlementService = fs.readFileSync(path.join(ROOT, 'services', 'payrollSettlement.js'), 'utf8');
const attendanceAuditScript = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-attendance-historical-impact.js'), 'utf8');
const preflightScript = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-payroll-activation-preflight.js'), 'utf8');

const {
    isPayrollInstallmentsActivationMonth,
    configuredPayrollInstallmentsActivationMonth
} = require('../services/payrollSettlement');
const {
    READ_ONLY_CONNECTION_ENV_KEYS,
    parseArgs,
    payrollActivationBlockers,
    poolConfig,
    renderMarkdown,
    resolveReadOnlyConnectionString
} = require('../scripts/audit-payroll-activation-preflight');
const {
    poolConfig: attendanceAuditPoolConfig
} = require('../scripts/audit-attendance-historical-impact');
const reportsRouter = require('../routes/reports');
const payrollRouter = require('../routes/payroll');

function block(source, startNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `${startNeedle} not found`);
    const nextRoute = source.indexOf("\nrouter.", start + startNeedle.length);
    return source.slice(start, nextRoute === -1 ? source.length : nextRoute);
}

test('activation month helper is opt-in and blocks months at or after activation', () => {
    assert.equal(configuredPayrollInstallmentsActivationMonth({}), null);
    assert.equal(configuredPayrollInstallmentsActivationMonth({ PAYROLL_INSTALLMENTS_ACTIVATION_MONTH: '2026-08' }), '2026-08');
    assert.equal(isPayrollInstallmentsActivationMonth('2026-07', { PAYROLL_INSTALLMENTS_ACTIVATION_MONTH: '2026-08' }), false);
    assert.equal(isPayrollInstallmentsActivationMonth('2026-08', { PAYROLL_INSTALLMENTS_ACTIVATION_MONTH: '2026-08' }), true);
    assert.equal(isPayrollInstallmentsActivationMonth('2026-09', { PAYROLL_INSTALLMENTS_ACTIVATION_MONTH: '2026-08' }), true);
});

test('legacy salary commit fails closed for both historical and activation months', () => {
    const commitBlock = block(hrRoute, "router.post('/salary/commit'");
    assert.match(commitBlock, /isPayrollInstallmentsActivationMonth\(month\)/);
    assert.match(commitBlock, /PAYROLL_LEGACY_COMMIT_DISABLED/);
    assert.match(commitBlock, /Historical payroll months are read-only/);
    assert.match(commitBlock, /'\/api\/hr\/salary\/installments\/calculate'/);
    assert.doesNotMatch(commitBlock, /INSERT INTO finance_transactions/i);
    assert.doesNotMatch(commitBlock, /status\s*=\s*'paid'/i);
    assert.doesNotMatch(commitBlock, /generatePayrollReports/);
});

test('legacy salary reverse is fail-closed and contains no destructive implementation', () => {
    const reverseBlock = block(hrRoute, "router.post('/salary/reverse'");
    assert.match(reverseBlock, /PAYROLL_LEGACY_REVERSE_DISABLED/);
    assert.match(reverseBlock, /replacementEndpoint: '\/api\/payroll\/payments\/:id\/reverse'/);
    assert.doesNotMatch(reverseBlock, /INSERT INTO finance_transactions/i);
    assert.doesNotMatch(reverseBlock, /DELETE FROM payroll_entries/i);
    assert.doesNotMatch(reverseBlock, /status\s*=\s*'voided'/i);
    assert.doesNotMatch(reverseBlock, /await client\.query\('BEGIN'\)/);
});

test('direct period reopen always fails closed', () => {
    const periodLockBlock = block(hrRoute, "router.post('/salary/period-lock'");
    assert.match(periodLockBlock, /if \(!locked\)/);
    assert.match(periodLockBlock, /PAYROLL_LEGACY_PERIOD_REOPEN_DISABLED/);
    assert.match(periodLockBlock, /replacementEndpoint: '\/api\/payroll\/period\/close'/);
    assert.doesNotMatch(periodLockBlock, /setPayrollPeriodLock\(month, false/);
});

test('HR activation UI uses canonical calculate and shows controlled legacy 409 messages', () => {
    assert.match(hrPage, /function normalizeSalaryPayrollActivation/);
    assert.match(hrPage, /function salaryPayrollLegacyBlockedMessage/);
    assert.match(hrPage, /\/salary\/installments\/calculate/);
    assert.match(hrPage, /PAYROLL_LEGACY_COMMIT_DISABLED/);
    assert.match(hrPage, /PAYROLL_LEGACY_REVERSE_DISABLED/);
    assert.match(hrPage, /PAYROLL_LEGACY_PERIOD_REOPEN_DISABLED/);
    assert.match(hrPage, /financeChanged === false/);
    assert.match(hrPage, /salaryPayrollActivationState\.legacyReverseDisabled/);
    assert.match(hrPage, /salaryPayrollActivationState\.legacyReopenDisabled/);
});

test('reports payroll templates do not auto-create generic finance report transactions', () => {
    assert.match(reportsRoute, /function isPayrollReportRow/);
    assert.match(reportsRoute, /function reportsPayrollReadOnlyPayload/);
    assert.match(reportsRoute, /REPORTS_PAYROLL_READ_ONLY/);
    assert.match(reportsRoute, /canonical_payroll_service_required/);
    assert.match(reportsRoute, /payroll payments are managed by payroll movements/);
    const schedulerBlock = block(reportsRoute, 'function scheduleFinanceTransactionForReport');
    assert.match(schedulerBlock, /if \(isPayrollReportRow\(report\)\)/);
    const putBlock = block(reportsRoute, "router.put('/:id'");
    assert.match(putBlock, /existingPayrollReport/);
    assert.match(putBlock, /incomingPayrollTable/);
    assert.match(putBlock, /incomingPayrollReport/);
    assert.match(putBlock, /payrollMutationRequested/);
    assert.match(putBlock, /payrollReportsReadOnlyError/);
    const hashtagToggleBlock = block(reportsRoute, "router.patch('/hashtags/toggle'");
    assert.match(hashtagToggleBlock, /candidates\.rows\.find\(isPayrollReportRow\)/);
    assert.match(hashtagToggleBlock, /payrollReportsReadOnlyError\(/);
    const assignBlock = block(reportsRoute, "router.post('/:id/assign'");
    assert.match(assignBlock, /isPayrollReportRow\(existing\.rows\[0\]\)/);
    assert.match(assignBlock, /payrollReportsReadOnlyError\(/);
});

test('Reports classifies exact ZP categories as payroll and fails closed before generic writes', () => {
    const hooks = reportsRouter.__payrollReportsTestHooks;
    assert.equal(hooks.isPayrollReportRow({ category: 'ЗП' }), true);
    assert.equal(hooks.isPayrollReportRow({ category: '  зп  ' }), true);
    assert.equal(hooks.isPayrollReportRow({ hashtags: ['#ЗП'] }), true);
    assert.equal(hooks.isPayrollTable({ defaultReport: { category: 'ЗП' } }), true);
    assert.equal(hooks.isPayrollReportRow({ category: 'Операційні витрати' }), false);

    const createBlock = block(reportsRoute, "router.post('/', async");
    assert.match(createBlock, /isPayrollReportRow\(incomingReport\)/);
    assert.match(createBlock, /payrollReportsReadOnlyError\('report create'/);
});

test('canonical payroll export derives legacy_accounted and preserves the raw legacy report status', () => {
    const fields = payrollRouter.__payrollExportTestHooks.payrollReportStatusExportFields({
        status: 'paid',
        payrollSettlement: {
            settlementModel: 'legacy_v1',
            legacy: {
                historicalStatus: 'legacy_accounted',
                reportStatus: 'paid'
            }
        }
    });
    assert.deepEqual(fields, {
        report_status: 'legacy_accounted',
        legacy_report_status: 'paid'
    });
    assert.deepEqual(
        payrollRouter.__payrollExportTestHooks.payrollReportStatusExportFields({ status: 'approved' }),
        { report_status: 'approved', legacy_report_status: '' }
    );
    assert.match(payrollRoute, /legacy_report_status/);
});

test('HR payment history displays the immutable movement confirmation timestamp', () => {
    const movementHistoryBlock = block(hrPage, 'function renderPayrollMovementHistory');
    assert.match(movementHistoryBlock, /movement\.createdAt \|\| movement\.created_at/);
    assert.match(movementHistoryBlock, /formatPayrollEventTime/);
    assert.match(movementHistoryBlock, /recordedAtLabel/);
});

test('legacy staff payroll endpoint is read-only canonical adapter', () => {
    const staffPayrollBlock = block(staffRoute, "router.get('/payroll'");
    assert.match(staffPayrollBlock, /getPayrollRangePreview/);
    assert.match(staffPayrollBlock, /source: 'canonical_payroll_service'/);
    assert.match(staffPayrollBlock, /deprecatedAdapter: true/);
    assert.doesNotMatch(staffPayrollBlock, /INSERT INTO finance_transactions/i);
});

test('offboarding and delete readiness include outstanding payroll installments', () => {
    assert.match(payrollSettlementService, /async function loadStaffOutstandingPayrollInstallments/);
    assert.match(payrollSettlementService, /payroll_payment_movements/);
    assert.match(payrollSettlementService, /GREATEST\(COALESCE\(mt\.payments, 0\) - COALESCE\(mt\.reversals, 0\), 0\)/);
    assert.match(hrRoute, /payroll_installments_settled/);
    assert.match(hrRoute, /outstanding_payroll_installment_count/);
    assert.match(hrRoute, /payroll_installments_outstanding/);
});

test('staff offboarding and archive paths fail closed when payroll installments are outstanding', () => {
    const offboardingBlock = block(hrRoute, "router.post('/staff/:id/offboarding'");
    assert.match(offboardingBlock, /loadStaffOutstandingPayrollInstallments\(req\.params\.id, client\)/);
    assert.match(offboardingBlock, /staffPayrollOutstandingBlockerPayload\(outstandingInstallments\)/);
    assert.match(hrRoute, /code: 'PAYROLL_INSTALLMENTS_OUTSTANDING'/);
    assert.ok(
        offboardingBlock.indexOf('loadStaffOutstandingPayrollInstallments') < offboardingBlock.indexOf('INSERT INTO staff_offboarding_events'),
        'offboarding blocker must run before offboarding event insert'
    );

    const statusBlock = block(hrRoute, "router.put('/staff/:id/status'");
    assert.match(statusBlock, /if \(!isActive\)/);
    assert.match(statusBlock, /loadStaffOutstandingPayrollInstallments\(req\.params\.id, client\)/);
    assert.match(statusBlock, /staffPayrollOutstandingBlockerPayload\(outstandingInstallments\)/);

    const legacyStaffDeleteBlock = block(staffRoute, "router.delete('/:id'");
    assert.match(legacyStaffDeleteBlock, /loadStaffOutstandingPayrollInstallments\(req\.params\.id, client\)/);
    assert.match(legacyStaffDeleteBlock, /staffPayrollOutstandingBlockerPayload\(outstandingInstallments\)/);
    assert.match(staffRoute, /code: 'PAYROLL_INSTALLMENTS_OUTSTANDING'/);
    assert.ok(
        legacyStaffDeleteBlock.indexOf('loadStaffOutstandingPayrollInstallments') < legacyStaffDeleteBlock.indexOf('UPDATE staff'),
        'legacy staff archive blocker must run before staff update'
    );
});

test('attendance historical impact audit reports outstanding installment exposure', () => {
    assert.match(attendanceAuditScript, /payrollInstallmentsTablePresent/);
    assert.match(attendanceAuditScript, /outstandingInstallments/);
    assert.match(attendanceAuditScript, /outstandingInstallmentAmount/);
    assert.match(attendanceAuditScript, /BEGIN READ ONLY/);
    assert.match(attendanceAuditScript, /--backfill/);
});

test('attendance historical impact audit also fails closed without a dedicated read-only URL', () => {
    assert.doesNotMatch(attendanceAuditScript, /process\.env\.DATABASE_URL/);
    assert.doesNotMatch(attendanceAuditScript, /PG\* environment variables/);
    assert.throws(
        () => attendanceAuditPoolConfig({
            DATABASE_URL: 'postgres://writer.example.invalid/app',
            PGDATABASE: 'writer_db'
        }),
        error => error.code === 'ATTENDANCE_AUDIT_READ_ONLY_DATABASE_REQUIRED'
    );
    assert.deepEqual(attendanceAuditPoolConfig({
        ATTENDANCE_AUDIT_DATABASE_URL: 'postgres://readonly.example.invalid/app',
        DATABASE_URL: 'postgres://writer.example.invalid/app',
        PGSSLMODE: 'disable'
    }), {
        connectionString: 'postgres://readonly.example.invalid/app',
        ssl: false,
        application_name: 'attendance_historical_readonly_audit'
    });
});

test('payroll activation preflight is read-only and classifies history as legacy_accounted', () => {
    assert.throws(() => parseArgs(['--fix']), /read-only only/);
    assert.throws(() => parseArgs(['--backfill']), /read-only only/);
    assert.deepEqual(parseArgs(['--month', '2026-07']), {
        month: '2026-07',
        from: '2026-07',
        to: '2026-07',
        format: 'json'
    });
    assert.match(preflightScript, /BEGIN READ ONLY/);
    assert.match(preflightScript, /legacy_accounted/);
    assert.match(preflightScript, /paymentFactVerified: false/);
    assert.match(preflightScript, /safeToAutoBackfill: false/);
    assert.match(packageJson, /"audit:payroll-activation-preflight": "node scripts\/audit-payroll-activation-preflight\.js"/);
    const markdown = renderMarkdown({
        generatedAt: '2026-07-27T00:00:00.000Z',
        scope: { month: '2026-07' },
        legacyReports: { paidReports: 1, legacyAccountedReports: 1, paidWithoutFinance: 0, amountMismatch: 1 },
        financeOrphans: { orphanFinance: 0, financeWithoutPayrollSource: 2 },
        legacyAdvance: { salaryAdjustmentLegacyAdvance: 2, salaryAdjustmentZrs: 3 },
        installments: { outstandingInstallments: 4, outstandingAmount: 5000, overpaymentInstallments: 1, overpaymentAmount: 25, duplicateFinanceLinks: 1, missingFinanceLinks: 2, amountMismatch: 3, reversalMismatch: 4, financeWithoutPayrollSource: 5 },
        settlementModels: { mixedSettlementMonths: 0, mixedOwnershipReports: 0 }
    });
    assert.match(markdown, /legacy_accounted/);
    assert.match(markdown, /Outstanding installments: 4/);
    assert.match(markdown, /Installment finance link mismatches: duplicates=1, missing=2, amount=3, reversal=4, source=5/);
});

test('payroll activation remains blocked until every legacy advance is classified as ZRS', () => {
    assert.deepEqual(
        payrollActivationBlockers({
            legacyAdvance: {
                salaryAdjustmentLegacyAdvance: 2,
                payrollEntryLegacyAdvance: 3
            }
        }),
        [
            { code: 'LEGACY_ADVANCE_ADJUSTMENTS_UNCLASSIFIED', count: 2 },
            { code: 'LEGACY_ADVANCE_PAYROLL_ENTRIES_UNCLASSIFIED', count: 3 }
        ]
    );
    assert.deepEqual(
        payrollActivationBlockers({
            legacyAdvance: {
                salaryAdjustmentLegacyAdvance: 0,
                payrollEntryLegacyAdvance: 0,
                salaryAdjustmentZrs: 5,
                payrollEntryZrs: 4
            }
        }),
        []
    );
});

test('payroll activation preflight fails closed without explicit read-only database URL', () => {
    assert.deepEqual(READ_ONLY_CONNECTION_ENV_KEYS, [
        'PAYROLL_AUDIT_DATABASE_URL',
        'PRODUCTION_READONLY_DATABASE_URL'
    ]);
    assert.doesNotMatch(preflightScript, /require\(['"]\.\.\/db['"]\)/);
    assert.doesNotMatch(preflightScript, /process\.env\.DATABASE_URL/);
    assert.doesNotMatch(preflightScript, /PG\* environment variables/);

    assert.throws(
        () => resolveReadOnlyConnectionString({
            DATABASE_URL: 'postgres://writer.example.invalid/app'
        }),
        error => error.code === 'PAYROLL_PREFLIGHT_READ_ONLY_DATABASE_REQUIRED'
    );
});

test('payroll activation preflight resolves only dedicated read-only database URLs', () => {
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
        PRODUCTION_READONLY_DATABASE_URL: 'postgres://readonly.example.invalid/app',
        PGSSLMODE: 'disable'
    }), {
        connectionString: 'postgres://readonly.example.invalid/app',
        ssl: false
    });
});

test('payroll settlement legacy read model never invents payment fact metadata', () => {
    assert.match(payrollSettlementService, /LEGACY_PAYROLL_ACCOUNTED_STATUS = 'legacy_accounted'/);
    assert.match(payrollSettlementService, /Історично враховано; факт виплати користувачем не підтверджено/);
    assert.match(payrollSettlementService, /paymentFactVerified: false/);
    assert.match(payrollSettlementService, /actualPaymentDate: null/);
    assert.match(payrollSettlementService, /confirmedBy: null/);
    assert.match(payrollSettlementService, /confirmedAt: null/);
});
