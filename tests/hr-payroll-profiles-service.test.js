'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    buildPayrollProfileVersionDiff,
    mergePayrollProfileSyncVersion
} = require('../services/hrPayrollProfiles');
const {
    payrollSchemeConfigFromRequest
} = require('../services/hrPayrollSchemes');

const ROOT = path.resolve(__dirname, '..');
const serviceCode = fs.readFileSync(path.join(ROOT, 'services', 'hrPayrollProfiles.js'), 'utf8');
const hrRouteCode = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
const hrPageCode = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
const hrHtmlCode = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
const hrCssCode = fs.readFileSync(path.join(ROOT, 'css', 'hr-page.css'), 'utf8');
const hrTeamBrowserSmokeCode = fs.readFileSync(path.join(ROOT, 'tests', 'browser', 'hr-team-browser-smoke.js'), 'utf8');

function functionBlock(source, name) {
    const start = source.indexOf(`async function ${name}`);
    assert.notEqual(start, -1, `missing async function ${name}`);
    const signature = source.slice(start).match(new RegExp(`async function ${name}([\\s\\S]*?)\\) \\{`));
    assert.ok(signature, `missing function body for ${name}`);
    const braceStart = start + signature[0].lastIndexOf('{');
    assert.notEqual(braceStart, -1, `missing function body for ${name}`);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    assert.fail(`unterminated async function ${name}`);
}

function version(overrides = {}) {
    return {
        id: overrides.id || 1,
        rateUnit: overrides.rateUnit || 'hour',
        defaultRate: overrides.defaultRate ?? 100,
        dayRates: overrides.dayRates || []
    };
}

test('payroll profile sync diff reports base-rate and weekday override changes', () => {
    const personal = version({
        defaultRate: 120,
        dayRates: [
            { isoWeekday: 6, rate: 160 },
            { isoWeekday: 7, rate: 170 }
        ]
    });
    const base = version({
        defaultRate: 140,
        dayRates: [
            { isoWeekday: 6, rate: 180 }
        ]
    });

    const diff = buildPayrollProfileVersionDiff(personal, base);

    assert.equal(diff.hasChanges, true);
    assert.deepEqual(diff.fields.map(field => field.field), [
        'default_rate',
        'day_rates.6',
        'day_rates.7'
    ]);
    assert.deepEqual(diff.fields.find(field => field.field === 'day_rates.7'), {
        field: 'day_rates.7',
        isoWeekday: 7,
        from: 170,
        to: null
    });
});

test('payroll profile sync merge applies only selected fields and keeps the clone independent', () => {
    const personal = version({
        defaultRate: 120,
        dayRates: [
            { isoWeekday: 6, rate: 160 },
            { isoWeekday: 7, rate: 170 }
        ]
    });
    const base = version({
        defaultRate: 140,
        dayRates: [
            { isoWeekday: 6, rate: 180 }
        ]
    });

    const merged = mergePayrollProfileSyncVersion(personal, base, new Set(['default_rate', 'day_rates.6']));

    assert.equal(merged.rateUnit, 'hour');
    assert.equal(merged.defaultRate, 140);
    assert.deepEqual(merged.dayRates, [
        { isoWeekday: 6, rate: 180 },
        { isoWeekday: 7, rate: 170 }
    ]);
});

test('payroll profile sync merge clears weekday overrides when selected rate unit becomes month', () => {
    const personal = version({
        rateUnit: 'hour',
        defaultRate: 120,
        dayRates: [{ isoWeekday: 6, rate: 160 }]
    });
    const base = version({
        rateUnit: 'month',
        defaultRate: 30000,
        dayRates: []
    });

    const merged = mergePayrollProfileSyncVersion(personal, base, new Set(['rate_unit', 'default_rate', 'day_rates']));

    assert.equal(merged.rateUnit, 'month');
    assert.equal(merged.defaultRate, 30000);
    assert.deepEqual(merged.dayRates, []);
});

test('payroll profile routes expose the requested payroll-rules API surface', () => {
    const viewRoutes = [
        "router.get('/payroll-profiles', requirePayrollView",
        "router.get('/payroll-profiles/diagnostics', requirePayrollView",
        "router.post('/payroll-profiles/simulator', requirePayrollView",
        "router.get('/payroll-profiles/forecast', requirePayrollView",
        "router.post('/payroll-profiles/bulk/preview', requirePayrollView",
        "router.get('/payroll-profiles/:id', requirePayrollView",
        "router.post('/payroll-profiles/:id/impact-preview', requirePayrollView",
        "router.get('/staff/:id/payroll-profile-assignments', requirePayrollView",
        "router.get('/staff/:id/payroll-profile-history', requirePayrollView"
    ];
    const mutationRoutes = [
        "router.post('/payroll-profiles/bulk/apply', requirePayrollRules",
        "router.post('/payroll-profiles', requirePayrollRules",
        "router.post('/payroll-profiles/:id/clone', requirePayrollRules",
        "router.post('/payroll-profiles/:id/versions', requirePayrollRules",
        "router.post('/payroll-profiles/:id/sync-from-base', requirePayrollRules",
        "router.put('/payroll-profiles/:id/archive', requirePayrollRules",
        "router.put('/staff/:id/payroll-profile-assignments', requirePayrollRules"
    ];
    for (const route of [...viewRoutes, ...mutationRoutes]) {
        assert.match(hrRouteCode, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(hrRouteCode, /sendPayrollProfileFailure/);
    assert.match(hrRouteCode, /payrollProfileActor\(req\)/);
    assert.ok(
        hrRouteCode.indexOf("router.get('/payroll-profiles/diagnostics'") < hrRouteCode.indexOf("router.get('/payroll-profiles/:id'"),
        'fixed payroll profile routes must be registered before /:id'
    );
});

test('payroll profile service is transactional, audited, and isolated from legacy payroll writes', () => {
    assert.match(serviceCode, /async function withTransaction/);
    assert.match(serviceCode, /await client\.query\('BEGIN'\)/);
    assert.match(serviceCode, /await client\.query\('COMMIT'\)/);
    assert.match(serviceCode, /await client\.query\('ROLLBACK'\)/);
    assert.match(serviceCode, /INSERT INTO hr_audit_log \(action, staff_id, performed_by, details, ip_address\)/);
    assert.match(serviceCode, /source_profile_id, source_version_id/);
    assert.match(serviceCode, /selectedChanges/);
    assert.match(serviceCode, /profile has active or future assignments/);
    assert.match(serviceCode, /new version must start after the latest profile version/);

    assert.doesNotMatch(serviceCode, /\bINSERT INTO staff_profession_rates\b/i);
    assert.doesNotMatch(serviceCode, /\bUPDATE payroll_schemes\b/i);
    assert.doesNotMatch(serviceCode, /\bUPDATE payroll_reports\b/i);
    assert.doesNotMatch(serviceCode, /\bDELETE FROM payroll_reports\b/i);
});

test('payroll profile and canonical payroll reads avoid concurrent query calls on a reused client', () => {
    const payrollServiceCode = fs.readFileSync(path.join(ROOT, 'services', 'payroll.js'), 'utf8');
    const profileContextBlock = functionBlock(payrollServiceCode, 'loadPayrollProfileContext');
    const buildContextBlock = functionBlock(payrollServiceCode, 'buildPayrollContext');
    const canonicalPreviewBlock = functionBlock(payrollServiceCode, 'buildCanonicalPayrollInstallmentPreview');
    const currentInstallmentBlock = functionBlock(payrollServiceCode, 'calculateCurrentPayrollInstallment');
    const forecastBlock = functionBlock(serviceCode, 'forecastPayrollProfiles');
    const diagnosticsBlock = functionBlock(serviceCode, 'diagnosePayrollProfiles');
    const impactBlock = functionBlock(serviceCode, 'impactPayrollProfilePreview');

    for (const block of [
        profileContextBlock,
        buildContextBlock,
        canonicalPreviewBlock,
        currentInstallmentBlock,
        forecastBlock,
        diagnosticsBlock,
        impactBlock
    ]) {
        assert.ok(block.length > 100);
        assert.doesNotMatch(block, /Promise\.all\(\[/);
    }
});

test('legacy payroll scheme advance compatibility label is user-facing ZRS only', () => {
    const config = payrollSchemeConfigFromRequest('hybrid', {
        baseKind: 'hourly',
        baseRate: 100,
        advanceAmount: 250
    }, 100);

    assert.deepEqual(config.advances, [{ kind: 'fixed', label: 'ЗРС', amount: 250 }]);
});

test('payroll profile catalog is wired into the existing HR payroll workspace', () => {
    assert.match(hrHtmlCode, /id="tab-profiles"/);
    assert.match(hrHtmlCode, /id="payrollProfilesList"/);
    assert.match(hrHtmlCode, /id="payrollProfileInspector"/);
    assert.match(hrHtmlCode, /id="payrollProfileReadinessFilter"/);

    assert.match(hrPageCode, /HR_PAYROLL_WORKSPACE_TABS = new Set\(\['salary', 'profiles', 'zrs', 'kpi'\]\)/);
    assert.match(hrPageCode, /profiles: loadPayrollProfilesCatalog/);
    assert.match(hrPageCode, /bindPayrollProfileCatalogControls/);
    assert.match(hrPageCode, /createPayrollProfileFromCatalog/);
    assert.match(hrPageCode, /clonePayrollProfileFromCatalog/);
    assert.match(hrPageCode, /savePayrollProfileVersionFromEditor/);
    assert.match(hrPageCode, /comparePayrollProfileFromCatalog/);
    assert.match(hrPageCode, /syncPayrollProfileFromComparison/);
    assert.match(hrPageCode, /archivePayrollProfileFromCatalog/);
    assert.match(hrPageCode, /payrollProfileImpactHtml/);
    assert.match(hrPageCode, /\/payroll-profiles\?include_archived=true/);

    assert.match(hrCssCode, /\.hr-payroll-profile-card/);
    assert.match(hrCssCode, /\.hr-payroll-profile-inspector/);
    assert.match(hrCssCode, /\.hr-payroll-profile-impact-grid/);
    assert.match(hrCssCode, /\.hr-payroll-profile-diff-row/);
});

test('payroll profile list exposes usage counts for catalog filters and archive warnings', () => {
    assert.match(serviceCode, /active_assignment_count/);
    assert.match(serviceCode, /default_staff_count/);
    assert.match(serviceCode, /affected_staff_count/);
    assert.match(serviceCode, /WITH profession_staff AS/);
    assert.match(serviceCode, /active_assignments AS/);
    assert.match(serviceCode, /default_profile_usage AS/);
});

test('payroll profile simulator, diagnostics, forecast, and bulk operations reuse the resolver path', () => {
    for (const fnName of [
        'simulatePayrollProfiles',
        'forecastPayrollProfiles',
        'diagnosePayrollProfiles',
        'impactPayrollProfilePreview',
        'previewPayrollProfileBulk',
        'applyPayrollProfileBulk'
    ]) {
        assert.match(serviceCode, new RegExp(`${fnName}`));
        assert.match(serviceCode, new RegExp(`${fnName},`));
    }

    assert.match(serviceCode, /resolveEffectivePayrollProfile/);
    assert.match(serviceCode, /calculateProfessionPay/);
    assert.match(serviceCode, /loadPayrollAttendanceMetrics/);
    assert.match(serviceCode, /source: 'hr_shifts'/);
    assert.match(serviceCode, /profile_profession_mismatch/);
    assert.match(serviceCode, /assignment_overlap/);
    assert.match(serviceCode, /legacy_fallback/);
    assert.match(serviceCode, /multiple_default_profiles/);
    assert.match(serviceCode, /requireBulkConfirmation/);
    assert.ok((serviceCode.match(/reuseClient: true/g) || []).length >= 4);
    assert.match(serviceCode, /assertPayrollPeriodOpen\(monthFromDate\(effectiveFrom\), db\)/);
    assert.match(serviceCode, /payroll_profile_bulk_apply/);

    assert.doesNotMatch(serviceCode, /\bINSERT INTO payroll_reports\b/i);
    assert.doesNotMatch(serviceCode, /\bINSERT INTO finance_/i);
});

test('staff card payroll tab exposes profile assignments, preview, onboarding hint, and legacy conversion', () => {
    assert.match(hrHtmlCode, /id="editStaffPayrollProfiles"/);
    assert.match(hrHtmlCode, /id="editPayrollProfilePreviewMonth"/);
    assert.match(hrHtmlCode, /id="editPayrollProfileSimulator"/);
    assert.match(hrHtmlCode, /id="editStaffPayrollProfilePreview"/);
    assert.match(hrHtmlCode, /id="accountOnboardingPayrollProfileHint"/);

    assert.match(hrPageCode, /loadStaffPayrollProfiles/);
    assert.match(hrPageCode, /staffPayrollPlanAssignmentReplacement/);
    assert.match(hrPageCode, /chooseStaffPayrollProfile/);
    assert.match(hrPageCode, /cloneStaffPayrollProfile/);
    assert.match(hrPageCode, /changeStaffPayrollProfileVersion/);
    assert.match(hrPageCode, /convertLegacyStaffPayrollProfile/);
    assert.match(hrPageCode, /loadStaffPayrollProfilePreview/);
    assert.match(hrPageCode, /showStaffPayrollProfileSimulator/);
    assert.match(hrPageCode, /\/payroll-profiles\/simulator/);
    assert.match(hrPageCode, /legacy не використовується/);
    assert.match(hrPageCode, /legacy fallback:/);
    assert.match(hrPageCode, /ensureStaffPayrollProfileCanMutate/);
    assert.match(hrPageCode, /ensureAccountOnboardingPayrollProfiles/);
    assert.match(hrPageCode, /Спершу збережіть робочі дані працівника/);

    assert.match(hrCssCode, /\.hr-staff-payroll-profile-panel/);
    assert.match(hrCssCode, /\.hr-staff-payroll-preview-summary/);
    assert.match(hrCssCode, /\.hr-staff-payroll-legacy-panel/);
    assert.match(hrCssCode, /\.hr-account-payroll-profile-hint/);
});

test('HR team browser smoke covers staff-card payroll profile panel', () => {
    assert.match(hrTeamBrowserSmokeCode, /\/payroll-profiles\?include_archived=true/);
    assert.match(hrTeamBrowserSmokeCode, /\/payroll-profile-assignments\?include_past=true/);
    assert.match(hrTeamBrowserSmokeCode, /#editStaffPayrollProfiles/);
    assert.match(hrTeamBrowserSmokeCode, /#editPayrollProfileSimulator/);
    assert.match(hrTeamBrowserSmokeCode, /legacy не використовується/);
});

test('payroll profile catalog exposes Task 6 planning and safety tools', () => {
    for (const id of [
        'btnPayrollProfileDiagnostics',
        'btnPayrollProfileForecast',
        'btnPayrollProfileBulk'
    ]) {
        assert.match(hrHtmlCode, new RegExp(`id="${id}"`));
    }
    assert.match(hrPageCode, /showPayrollProfileDiagnostics/);
    assert.match(hrPageCode, /showPayrollProfileForecast/);
    assert.match(hrPageCode, /showPayrollProfileBulkAssign/);
    assert.match(hrPageCode, /showPayrollProfileImpactForecast/);
    assert.match(hrPageCode, /\/payroll-profiles\/diagnostics/);
    assert.match(hrPageCode, /\/payroll-profiles\/forecast/);
    assert.match(hrPageCode, /\/payroll-profiles\/bulk\/preview/);
    assert.match(hrPageCode, /\/payroll-profiles\/bulk\/apply/);
    assert.match(hrPageCode, /\/impact-preview/);
});
