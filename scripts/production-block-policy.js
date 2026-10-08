'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const MAX_VALIDITY_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const TARGET = Object.freeze({
    branch: 'codex/eventgenix-production',
    railwayProjectId: 'bc28b46c-d4bc-491c-893a-d8401c633668',
    railwayEnvironment: 'production',
    railwayServiceId: '8223324090',
    liveUrl: 'https://8223324090-production.up.railway.app'
});
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const BLOCK_ID_PATTERN = /^EG-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/;
const SENSITIVE_KEY = /(secret|token|password|database.?url|authorization|cookie)/i;
const PROTECTED_WORKFLOWS = Object.freeze({
    SYS_MB_AUTH_CUTOVER: 'sys-mb-auth-cutover',
    CERTIFICATE_QA_ISOLATION: 'certificate-qa-isolation',
    CERTIFICATE_CI_GATE: 'certificate-ci-gate',
    LEAD_UI_CI_GATE: 'lead-ui-ci-gate',
    HR_PAYROLL: 'hr-payroll',
    FINANCE_MANUAL_QA: 'finance-manual-qa'
});
const CERTIFICATE_QA_RED_PATHS = Object.freeze(['routes/auth.js', 'routes/finance.js']);
const CERTIFICATE_QA_MIGRATION = 'db/migrations/371_trusted_qa_certificate_lookup.sql';
const CERTIFICATE_CI_RED_PATHS = Object.freeze(['.github/workflows/ci.yml']);
const CERTIFICATE_CI_CHANGED_PATHS = Object.freeze([
    '.github/workflows/ci.yml',
    'config/schedulerSurface.js',
    'docs/CERTIFICATE_CI_GATE.md',
    'docs/CERTIFICATE_POST_02_READ_ONLY_AUDIT_2026-09-26.md',
    'docs/CERT_POST_FIX_01_RELEASE_NOTES.json',
    'docs/CODEX_PRODUCTION_AUTONOMY.md',
    'docs/SCHEDULER_SURFACE.md',
    'package.json',
    'scripts/production-block-policy.js',
    'server.js',
    'services/scheduler.js',
    'tests/browser/certificate-booking-precheck-app-smoke.js',
    'tests/integration/certificate-redemption-postgres.test.js',
    'tests/production-block-controller.test.js',
    'tests/scheduler-guard-contract.test.js',
    'tests/scheduler-notification-jobs-hardening.test.js'
]);
const LEAD_UI_CI_RED_PATHS = Object.freeze(['.github/workflows/ci.yml']);
const LEAD_UI_CI_CHANGED_PATHS = Object.freeze([
    '.github/workflows/ci.yml',
    'css/omni-workspace.css',
    'css/pages-leads.css',
    'docs/CERTIFICATE_CLOSE_03_RELEASE_PLAN.md',
    'docs/CODEX_PRODUCTION_AUTONOMY.md',
    'docs/LEAD_UI_1_HANDOFF_2026-09-27.md',
    'docs/LEAD_UI_2_HANDOFF_2026-09-27.md',
    'docs/LEAD_UI_3_HANDOFF_2026-09-27.md',
    'docs/LEAD_UI_4_RELEASE_NOTES.json',
    'docs/LEAD_UI_4_CI_PROPOSAL.patch',
    'docs/LEAD_WORKSPACE_UI_CONTRACT.md',
    'docs/OMNI_LEAD_CONVERSATION_LINKS.md',
    'js/customers-page.js',
    'js/leads-page.js',
    'leads.html',
    'omni.html',
    'package.json',
    'scripts/production-block-policy.js',
    'services/taskDetailContract.js',
    'tests/browser/checkin-journal-browser-smoke.js',
    'tests/browser/lead-communication-selection-fixtures.js',
    'tests/browser/lead-editor-mode-fixtures.js',
    'tests/browser/lead-editor-navigation-fixtures.js',
    'tests/browser/lead-unified-card-live-readonly.js',
    'tests/browser/omni-layout.checks.cjs',
    'tests/browser/omni-lead-links-actual-app-browser-smoke.js',
    'tests/browser/omni-native-zoom.cjs',
    'tests/browser/omni-workspace-navigation-fixtures.js',
    'tests/browser/task-center-parity-browser-smoke.js',
    'tests/dashboard-leads-drilldown.test.js',
    'tests/lead-workspace-navigation.test.js',
    'tests/production-block-controller.test.js',
    'tests/task-detail-drawer.test.js',
    'tests/ui-check.js'
]);
const HR_PAYROLL_MIGRATION = 'db/migrations/374_payroll_day_exceptions.sql';
const HR_PAYROLL_RED_PATHS = Object.freeze(['.github/workflows/ci.yml', 'routes/payroll.js']);
// Exact reviewed HR implementation and generated release inventory; no path prefixes or globs.
const HR_PAYROLL_CHANGED_PATHS = Object.freeze([
    // Exact v0.82.57 generated release/cache files, reviewed separately from HR runtime.
    "CHANGELOG.md",
    "accounting-deposits.html",
    "afisha.html",
    "art-director.html",
    "booking-summary.html",
    "cashier-payments.html",
    "center.html",
    "certificates.html",
    "chat-settings.html",
    "chat.html",
    "checkin.html",
    "content.html",
    "copilot.html",
    "css/assistant-rail.css",
    "css/pages-shell.css",
    "css/pages.css",
    "css/sidebar-aurora.css",
    "customers.html",
    "dashboard.html",
    "data-deletion.html",
    "demo.html",
    "designer.html",
    "designs.html",
    "docs/integrations/checkbox/IMPLEMENTATION_STATUS.md",
    "finance.html",
    "game.html",
    "graduation.html",
    "guardian-ops.html",
    "hermes-studio.html",
    "index.html",
    "invite.html",
    "js/designs-page.js",
    "landing/index.html",
    "leads.html",
    "omni.html",
    "package-lock.json",
    "privacy-policy.html",
    "profile.html",
    "programs.html",
    "quiz.html",
    "report-agent.html",
    "reports.html",
    "room.html",
    "server.js",
    "shop.html",
    "sound.html",
    "staff.html",
    "status.html",
    "sw.js",
    "tasks.html",
    "terms-of-service.html",
    "tests/ui-check.js",
    "timeline-settings.html",
    "training.html",
    "warehouse.html",
    "docs/HR_PAY_RELEASE_NOTES.json",

    "services/parkHrPayrollAccess.js",
    "tests/park-hr-payroll-access.test.js",
    "tests/park-hr-staff-card-routes.test.js",
    "tests/park-hr-today-routes.test.js",
    "tests/park-staff-schedule-routes.test.js",
    ".github/workflows/ci.yml",
    "tests/browser/hr-pay-actual-app-browser-smoke.js",
    "css/hr-page.css",
    "css/pages-hr-staff.css",
    "db/migrations/374_payroll_day_exceptions.sql",
    "docs/CODEX_PRODUCTION_AUTONOMY.md",
    "docs/HR_PAY_PROTECTED_RELEASE.md",
    "docs/HR_PAY_RELEASE_READINESS_2026-10-03.md",
    "hr.html",
    "js/finance-page.js",
    "js/hr-page.js",
    "js/staff-page.js",
    "package.json",
    "routes/hr.js",
    "routes/payroll.js",
    "routes/staff.js",
    "scripts/audit-hr-pay-readiness.js",
    "scripts/production-block-controller.js",
    "scripts/production-block-policy.js",
    "scripts/run-isolated-postgres-tests.js",
    "services/hrAttendance.js",
    "services/hrPayReadiness.js",
    "services/hrPayrollConditions.js",
    "services/hrPayrollProfiles.js",
    "services/hrShiftSegments.js",
    "services/parkStaffScheduleProjection.js",
    "services/payroll.js",
    "services/payrollConditionCalculation.js",
    "services/professions.js",
    "tests/backoffice-foundation.test.js",
    "tests/browser/hr-team-browser-smoke.js",
    "tests/browser/staff-schedule-custom-range-browser-smoke.js",
    "tests/hr-attendance-clock-in.test.js",
    "tests/hr-attendance-segments.test.js",
    "tests/hr-pay-conditions-server.test.js",
    "tests/hr-pay-conditions-ui.test.js",
    "tests/hr-pay-rate-safety.test.js",
    "tests/hr-pay-readiness.test.js",
    "tests/hr-pay-schedule-draft.test.js",
    "tests/hr-payroll-profiles-service.test.js",
    "tests/hr-profession-readiness-static.test.js",
    "tests/hr-shift-segments-service.test.js",
    "tests/integration/hr-attendance-compensation-snapshot.integration.test.js",
    "tests/integration/payroll-profiles-conditions.integration.test.js",
    "tests/integration/payroll-profiles.integration.test.js",
    "tests/integration/payroll-fullstack-settlement.integration.test.js",
    "tests/isolated-postgres-test-flow.test.js",
    "tests/integration/payroll-simultaneous-additional.integration.test.js",
    "tests/payroll-profession-allocation.test.js",
    "tests/payroll-reporting-routes.contract.js",
    "tests/production-block-controller.test.js",
    "tests/staff-schedule-business-context.test.js",
    "tests/staff-schedule-history-static.test.js",
    "tests/staff-schedule-segments-ui.test.js"
]);
const SYS_MB_PROTECTED_PATH_PATTERNS = Object.freeze([
    /^config\/permissionRegistry\.js$/,
    /^middleware\/auth\.js$/,
    /^routes\/(?:auth|organizations|finance|payroll)\.js$/,
    /^services\/(?:accountAccessPolicy|businessContext|businessCutover|businessMembership|businessModuleRegistry|businessUserAccess|legacyBusinessSurface|websocketEventAccess)\.js$/,
    /^db\/migrations\/(?:357_organizations_business_memberships|363_multibusiness_cutover_journal_telemetry|364_catalog_ownership_markers|365_business_cutover_journal_approval_receipts)\.sql$/,
    /^scripts\/(?:audit-multibusiness-ownership|production-block-controller|production-block-policy|sys-mb-[a-z0-9-]+)\.cjs$/,
    /^tests\/(?:business-cutover|business-membership-security|business-module-registry|legacy-business-surface|multibusiness-ownership-preflight|production-block-controller)\.test\.js$/,
    /^tests\/integration\/(?:business-cutover-journal-postgres|sys-mb-[a-z0-9-]+)\.test\.js$/,
    /^docs\/workstreams\/sys-multibusiness\//
]);
const RED_PATH_PATTERNS = Object.freeze([
    /^\.github\/workflows\//,
    /(^|\/)railway(?:\.json|\.toml|\/)/i,
    /(^|\/)(?:\.env|secrets?)(?:\.|$)/i,
    /^config\/timelineProtectedSurface\.js$/,
    /^middleware\/auth\.js$/,
    /^routes\/(?:auth|payments?|payroll|finance)\.js$/
]);

// Exact finance implementation and release markers; no auth, provider, CI or settings paths.
const FINANCE_MANUAL_RED_PATHS = Object.freeze(['routes/finance.js', 'routes/payroll.js']);
const FINANCE_MANUAL_CHANGED_PATHS = Object.freeze([
    'config/cssSurface.js', 'css/dark-mode.css', 'css/finance-money.css', 'css/finance-redesign.css',
    'db/migrations/381_finance_manual_money.sql', 'db/migrations/382_finance_trusted_qa.sql',
    'docs/CSS_SURFACE.md', 'docs/FINANCE_MONEY_FLOW_CONTRACT_DRAFT.md',
    'docs/FINANCE_MONEY_LOCAL_STATUS_2026-10-07.md', 'docs/FINANCE_PRODUCTION_QA_PLAN_2026-10-07.md',
    'docs/FINANCE_WORKFLOW_WAVE1_STATUS_2026-10-07.md', 'docs/CODEX_PRODUCTION_AUTONOMY.md',
    'docs/FINANCE_PRODUCTION_QA_STATUS_2026-10-08.md', 'docs/FINANCE_PRODUCTION_QA_RELEASE_NOTES.json',
    'js/analytics-page.js', 'js/finance-money.js', 'js/finance-page.js',
    'routes/finance.js', 'routes/analytics.js', 'routes/payroll.js', 'routes/report-bot.js',
    'routes/dashboard.js', 'routes/stats.js', 'routes/board.js', 'routes/center.js',
    'services/financeMoneyMovements.js', 'services/financeMoneyQa.js', 'services/trustedQaRuns.js',
    'services/financeQaReadScope.js',
    'scripts/production-block-policy.js', 'scripts/production-block-controller.js',
    'scripts/run-isolated-postgres-tests.js', 'scripts/trusted-qa-finance-run.js',
    'tests/analytics-widgets-ui.test.js', 'tests/browser/finance-money-actual-app-browser-smoke.js',
    'tests/browser/finance-money-production-qa.js', 'tests/finance-money-production-qa.test.js',
    'tests/browser/finance-workflow-fixture.js', 'tests/chat-task-authz.test.js',
    'tests/finance-money-service-boundaries.test.js', 'tests/finance-money-ui.test.js',
    'tests/finance-money-qa-ui.test.js', 'tests/finance-money-qa.test.js',
    'tests/finance-qa-read-scope.test.js', 'tests/finance-business-isolation.test.js',
    'tests/finance-qa-report-scope.test.js',
    'tests/finance-workflow-ui.test.js', 'tests/integration/finance-money-movements.integration.test.js',
    'tests/integration/finance-money-qa.integration.test.js', 'tests/integration/finance-transactions-pnl.integration.test.js',
    'tests/integration/costing-management-postgres.test.js',
    'tests/isolated-postgres-test-flow.test.js', 'tests/operational-business-context.test.js',
    'tests/payroll-finance-workflow-contract.test.js', 'tests/production-block-controller.test.js', 'tests/route-smoke.test.js',
    // Generated version/cache inventory is enumerated independently of other protected workflows.
    'CHANGELOG.md', 'accounting-deposits.html', 'afisha.html', 'art-director.html', 'booking-summary.html',
    'cashier-payments.html', 'center.html', 'certificates.html', 'chat-settings.html', 'chat.html',
    'checkin.html', 'content.html', 'copilot.html', 'css/assistant-rail.css', 'css/pages-shell.css',
    'css/pages.css', 'css/sidebar-aurora.css', 'customers.html', 'dashboard.html', 'data-deletion.html',
    'demo.html', 'designer.html', 'designs.html', 'docs/integrations/checkbox/IMPLEMENTATION_STATUS.md',
    'finance.html', 'game.html', 'graduation.html', 'guardian-ops.html', 'hermes-studio.html', 'hr.html',
    'index.html', 'invite.html', 'js/designs-page.js', 'landing/index.html', 'leads.html', 'omni.html',
    'package-lock.json', 'package.json', 'privacy-policy.html', 'profile.html', 'programs.html', 'quiz.html',
    'report-agent.html', 'reports.html', 'room.html', 'server.js', 'shop.html', 'sound.html', 'staff.html',
    'status.html', 'sw.js', 'tasks.html', 'terms-of-service.html', 'tests/ui-check.js',
    'timeline-settings.html', 'training.html', 'warehouse.html'
]);
const FINANCE_MANUAL_REQUIRED_PATHS = Object.freeze([
    'routes/finance.js', 'services/financeMoneyMovements.js', 'services/financeMoneyQa.js',
    'services/trustedQaRuns.js', 'scripts/trusted-qa-finance-run.js', 'scripts/run-isolated-postgres-tests.js',
    'db/migrations/381_finance_manual_money.sql', 'db/migrations/382_finance_trusted_qa.sql',
    'tests/integration/finance-money-movements.integration.test.js',
    'tests/integration/finance-money-qa.integration.test.js', 'tests/browser/finance-money-actual-app-browser-smoke.js'
]);
// Hash the exact reviewed SQL after CRLF -> LF only; preserve every other byte.
const FINANCE_MANUAL_SQL_HASHES = Object.freeze({
    'db/migrations/381_finance_manual_money.sql': '087fd042bc05ba204157757bedb8404f4eee826974a38615680a54abd97c39aa',
    'db/migrations/382_finance_trusted_qa.sql': '019eb1422489f2f25c091bbe0b18b31a86a6b73db9d58b3538abe0511253ef05'
});
const FINANCE_SQL_EXCEPTION = 'finance-manual-qa:reviewed-exact-sql';

class ProductionBlockError extends Error {
    constructor(message, code = 'PRODUCTION_BLOCK_FAILED', details = {}) {
        super(message);
        this.name = 'ProductionBlockError';
        this.code = code;
        this.details = details;
    }
}

function fail(condition, message, code, details = {}) {
    if (!condition) throw new ProductionBlockError(message, code, details);
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableJson(value) {
    return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function hashValue(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function hashableManifest(manifest) {
    const { manifestHash, runtimeState, ...signed } = manifest || {};
    return signed;
}

function manifestHash(manifest) {
    return hashValue(hashableManifest(manifest));
}

function sanitize(value, key = '') {
    if (SENSITIVE_KEY.test(key)) return '[redacted]';
    if (Array.isArray(value)) return value.map(item => sanitize(item));
    if (value && typeof value === 'object') {
        if (value instanceof Date) return value.toISOString();
        return Object.fromEntries(Object.entries(value).map(([nextKey, nextValue]) => [nextKey, sanitize(nextValue, nextKey)]));
    }
    if (typeof value === 'string') {
        return value
            .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
            .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-database-url]');
    }
    return value;
}

function migrationNumber(file) {
    const match = path.basename(file).match(/^(\d{3})_/);
    return match ? Number(match[1]) : null;
}

function migrationSqlHash(sql) {
    return crypto.createHash('sha256').update(String(sql).replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

function isPreparedProtectedRelease(manifest) {
    return [PROTECTED_WORKFLOWS.HR_PAYROLL, PROTECTED_WORKFLOWS.FINANCE_MANUAL_QA]
        .includes(manifest.allowedProtectedWorkflow?.kind);
}

function migrationHeader(sql, name) {
    const match = String(sql || '').match(new RegExp(`^\\s*--\\s*${name}:\\s*(.+)$`, 'im'));
    return match ? match[1].trim() : '';
}

function classifyMigration(file, sql) {
    const headerKind = migrationHeader(sql, 'MIGRATION_KIND').toLowerCase();
    const normalized = String(sql || '')
        .replace(/--.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .toLowerCase();
    const destructive = /\b(drop|truncate|delete\s+from)\b/.test(normalized)
        || /\balter\s+table\b[\s\S]*?\bdrop\b/.test(normalized);
    const dataMutation = /\b(insert\s+into|update\s+|delete\s+from|merge\s+into)\b/.test(normalized);
    const schemaMutation = /\b(create|alter|drop)\s+(table|index|type|function|trigger|view|extension)\b/.test(normalized);
    let kind = headerKind || (schemaMutation && dataMutation ? 'mixed' : schemaMutation ? 'schema' : dataMutation ? 'data-fix' : 'unknown');
    if (destructive) kind = 'cleanup';
    const safety = migrationHeader(sql, 'SAFETY');
    const rollback = migrationHeader(sql, 'ROLLBACK');
    const dataScope = migrationHeader(sql, 'DATA_SCOPE');
    const sensitiveDataScope = /\b(customer|client|booking|staff|employee|finance|payroll|payment|auth|session|role|permission)\b/i.test(dataScope);
    const incompleteDataFix = kind === 'data-fix' && (!safety || !rollback || !dataScope);
    const redReason = kind === 'cleanup'
        ? 'cleanup/destructive migration'
        : (kind === 'mixed'
            ? 'mixed schema/data migration'
            : (kind === 'unknown'
                ? 'unknown migration classification'
                : (sensitiveDataScope
                    ? 'real or protected data scope'
                    : (incompleteDataFix ? 'data-fix migration lacks SAFETY, ROLLBACK, or DATA_SCOPE evidence' : ''))));
    return {
        file: file.replaceAll('\\', '/'),
        number: migrationNumber(file),
        kind,
        safety,
        rollback,
        dataScope: dataScope || null,
        destructive,
        red: Boolean(redReason),
        redReason: redReason || null
    };
}

function normalizePathList(paths = []) {
    return [...new Set(paths.map(file => String(file || '').replaceAll('\\', '/')).filter(Boolean))].sort();
}

function redChangedPaths(paths = []) {
    return normalizePathList(paths).filter(file => RED_PATH_PATTERNS.some(pattern => pattern.test(file)));
}

function isSysMbProtectedPath(file) {
    const normalized = String(file || '').replaceAll('\\', '/');
    return SYS_MB_PROTECTED_PATH_PATTERNS.some(pattern => pattern.test(normalized));
}

function validateProtectedWorkflow(workflow, changedPaths = [], redPaths = []) {
    if (!workflow || workflow === 'none') {
        fail(redPaths.length === 0, 'Candidate changes include Red protected paths', 'PRODUCTION_BLOCK_RED_PATHS', { paths: redPaths });
        return { enabled: false, kind: null, protectedChangedPaths: [] };
    }
    fail(Object.values(PROTECTED_WORKFLOWS).includes(workflow),
        'Unsupported protected production workflow', 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_INVALID');
    if (workflow === PROTECTED_WORKFLOWS.FINANCE_MANUAL_QA) {
        const changed = normalizePathList(changedPaths);
        fail(redPaths.includes('routes/finance.js') && redPaths.every(file => FINANCE_MANUAL_RED_PATHS.includes(file)),
            'Finance permits only its finance route and payroll selector guard', 'PRODUCTION_BLOCK_RED_PATHS', { paths: redPaths });
        fail(changed.every(file => FINANCE_MANUAL_CHANGED_PATHS.includes(file))
            && FINANCE_MANUAL_REQUIRED_PATHS.every(file => changed.includes(file)),
            'Finance requires the exact journal, QA isolation, migrations and actual PostgreSQL/browser regressions',
            'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
        return { enabled: true, kind: workflow, protectedChangedPaths: [...redPaths] };
    }
    if (workflow === PROTECTED_WORKFLOWS.HR_PAYROLL) {
        const changed = normalizePathList(changedPaths);
        fail(redPaths.includes('routes/payroll.js') && redPaths.every(file => HR_PAYROLL_RED_PATHS.includes(file)),
            'HR/payroll permits only its exact payroll route and optional HR CI gate', 'PRODUCTION_BLOCK_RED_PATHS', { paths: redPaths });
        fail(changed.every(file => HR_PAYROLL_CHANGED_PATHS.includes(file))
            && ['services/hrPayrollConditions.js', 'services/payrollConditionCalculation.js',
                'tests/integration/payroll-profiles-conditions.integration.test.js', HR_PAYROLL_MIGRATION].every(file => changed.includes(file)),
            'HR/payroll requires its exact implementation, isolated regressions and additive migration',
            'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
        return { enabled: true, kind: workflow, protectedChangedPaths: [...redPaths] };
    }
    if (workflow === PROTECTED_WORKFLOWS.LEAD_UI_CI_GATE) {
        const changed = normalizePathList(changedPaths);
        fail(JSON.stringify(redPaths) === JSON.stringify(LEAD_UI_CI_RED_PATHS),
            'Lead UI CI workflow permits only its approved Red path',
            'PRODUCTION_BLOCK_RED_PATHS', { paths: redPaths });
        fail(changed.every(file => LEAD_UI_CI_CHANGED_PATHS.includes(file))
            && !changed.some(file => file.startsWith('db/migrations/'))
            && changed.includes('js/leads-page.js')
            && changed.includes('leads.html')
            && changed.includes('tests/browser/omni-lead-links-actual-app-browser-smoke.js')
            && changed.includes('tests/browser/omni-workspace-navigation-fixtures.js'),
        'Lead UI CI workflow is limited to the unified lead card and Omni regression release',
        'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
        return { enabled: true, kind: workflow, protectedChangedPaths: [...LEAD_UI_CI_RED_PATHS] };
    }
    if (workflow === PROTECTED_WORKFLOWS.CERTIFICATE_CI_GATE) {
        const changed = normalizePathList(changedPaths);
        fail(JSON.stringify(redPaths) === JSON.stringify(CERTIFICATE_CI_RED_PATHS),
            'Certificate CI workflow permits only its approved Red path',
            'PRODUCTION_BLOCK_RED_PATHS', { paths: redPaths });
        fail(changed.every(file => CERTIFICATE_CI_CHANGED_PATHS.includes(file))
            && !changed.some(file => file.startsWith('db/migrations/'))
            && changed.includes('services/scheduler.js')
            && changed.includes('tests/browser/certificate-booking-precheck-app-smoke.js'),
        'Certificate CI workflow is limited to the expiry and booking precheck release',
        'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
        return { enabled: true, kind: workflow, protectedChangedPaths: [...CERTIFICATE_CI_RED_PATHS] };
    }
    if (workflow === PROTECTED_WORKFLOWS.CERTIFICATE_QA_ISOLATION) {
        const changed = normalizePathList(changedPaths);
        fail(JSON.stringify(redPaths) === JSON.stringify(CERTIFICATE_QA_RED_PATHS),
            'Certificate QA workflow permits only its two approved Red paths',
            'PRODUCTION_BLOCK_RED_PATHS', { paths: redPaths });
        fail(changed.includes('services/certificateQa.js')
            && changed.includes('scripts/trusted-qa-certificate-run.js')
            && JSON.stringify(changed.filter(file => /^db\/migrations\//.test(file)))
                === JSON.stringify([CERTIFICATE_QA_MIGRATION]),
        'Certificate QA workflow requires its exact implementation and additive migration',
        'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
        return { enabled: true, kind: workflow, protectedChangedPaths: [...CERTIFICATE_QA_RED_PATHS] };
    }
    const protectedChangedPaths = normalizePathList(changedPaths).filter(isSysMbProtectedPath);
    const unauthorizedRedPaths = redPaths.filter(file => !isSysMbProtectedPath(file));
    fail(unauthorizedRedPaths.length === 0,
        'Protected SYS-MB workflow cannot authorize these Red paths',
        'PRODUCTION_BLOCK_RED_PATHS', { paths: unauthorizedRedPaths });
    fail(protectedChangedPaths.length > 0,
        'Protected SYS-MB workflow requires a concrete protected path in the candidate',
        'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_EMPTY');
    return {
        enabled: true,
        kind: PROTECTED_WORKFLOWS.SYS_MB_AUTH_CUTOVER,
        protectedChangedPaths
    };
}

function validateQaScope(scope) {
    const value = scope || { enabled: false };
    fail(value && typeof value === 'object' && !Array.isArray(value),
        'QA scope must be an object', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    if (value.enabled !== true) {
        fail(value.enabled === false && Object.keys(value).length === 1,
            'Disabled QA scope may not contain executable options', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
        return value;
    }
    const allowedKeys = new Set(['enabled', 'kind', 'date', 'ttlMinutes', 'animators', 'fixtureLimit',
        'runId', 'testAccountId', 'businessContext', 'planFile', 'planHash']);
    fail(Object.keys(value).every(key => allowedKeys.has(key)),
        'QA scope contains unsupported options', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    fail(['timeline', 'canary', 'certificate', 'finance'].includes(value.kind),
        'QA kind must be timeline, canary, certificate, or finance', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    if (value.kind === 'finance') {
        fail(Object.keys(value).every(key => ['enabled', 'kind', 'runId', 'testAccountId',
            'businessContext', 'ttlMinutes', 'planFile', 'planHash'].includes(key))
            && /^[a-zA-Z0-9_-]{8,64}$/.test(String(value.runId || ''))
            && Number.isSafeInteger(value.testAccountId) && value.testAccountId > 0
            && value.businessContext === 'event_genix'
            && Number.isInteger(value.ttlMinutes) && value.ttlMinutes >= 1 && value.ttlMinutes <= 30
            && /^[a-f0-9]{64}$/.test(String(value.planHash || ''))
            && typeof value.planFile === 'string' && value.planFile.length <= 2000
            && value.planFile === value.planFile.trim() && !/[\u0000-\u001f]/.test(value.planFile)
            && /\.json$/i.test(value.planFile)
            && (/^[a-zA-Z]:[\\/]/.test(value.planFile) || /^\/(?!\/)/.test(value.planFile)),
        'Finance QA requires one exact Park account, bounded run, 1-30 minute TTL and a local absolute hash-bound JSON plan',
        'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
        return value;
    }
    if (value.kind === 'certificate') {
        fail(Object.keys(value).every(key => ['enabled', 'kind', 'runId', 'testAccountId',
            'businessContext', 'ttlMinutes', 'fixtureLimit'].includes(key))
            && /^[a-zA-Z0-9_-]{8,80}$/.test(String(value.runId || ''))
            && Number.isSafeInteger(value.testAccountId) && value.testAccountId > 0
            && value.businessContext === 'event_genix'
            && Number.isInteger(value.ttlMinutes) && value.ttlMinutes >= 1 && value.ttlMinutes <= 30
            && value.fixtureLimit === 1,
        'Certificate QA requires one exact Park account, run, certificate, and 1-30 minute TTL',
        'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
        return value;
    }
    fail(!Object.keys(value).some(key => ['runId', 'testAccountId', 'businessContext', 'planFile', 'planHash'].includes(key)),
        'Timeline QA does not accept certificate options', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    fail(/^\d{4}-\d{2}-\d{2}$/.test(String(value.date || '')),
        'QA scope requires an exact YYYY-MM-DD date', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    fail(Number.isInteger(value.ttlMinutes) && value.ttlMinutes >= 5 && value.ttlMinutes <= 240,
        'QA TTL must be 5-240 minutes', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    fail(/^[1-5](?:,[1-5]){0,4}$/.test(String(value.animators || ''))
        && new Set(String(value.animators).split(',')).size === String(value.animators).split(',').length,
    'QA animators must be a unique comma-separated subset of 1-5', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    if (value.kind === 'canary') fail(value.fixtureLimit === 1,
        'Canary QA scope must be limited to exactly one fixture', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    if (value.kind === 'timeline') fail(value.fixtureLimit === undefined,
        'Timeline QA scope does not accept a fixture limit', 'PRODUCTION_BLOCK_QA_SCOPE_INVALID');
    return value;
}

function validateReleaseNotes(notes = []) {
    fail(Array.isArray(notes) && notes.length <= 6,
        'Release notes must contain at most six items', 'PRODUCTION_BLOCK_RELEASE_NOTES_INVALID');
    for (const item of notes) {
        fail(item && typeof item === 'object' && !Array.isArray(item)
            && Object.keys(item).sort().join(',') === 'text,title'
            && typeof item.title === 'string' && item.title === item.title.trim()
            && item.title.length >= 1 && item.title.length <= 80
            && typeof item.text === 'string' && item.text === item.text.trim()
            && item.text.length >= 1 && item.text.length <= 260
            && !/[<>\r\n]/.test(item.title + item.text),
        'Release notes contain an unsupported item', 'PRODUCTION_BLOCK_RELEASE_NOTES_INVALID');
    }
    return notes;
}

function buildBlockId(now, head) {
    const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    return `EG-${timestamp}-${head.slice(0, 8)}`;
}

function buildManifest(facts, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const validityMinutes = Number(options.validityMinutes || 360);
    fail(Number.isInteger(validityMinutes) && validityMinutes >= 5 && validityMinutes <= 360,
        'Production block validity must be 5-360 minutes', 'PRODUCTION_BLOCK_VALIDITY_INVALID');
    const head = String(facts.head || '').toLowerCase();
    const baseLiveSha = String(facts.live?.commitSha || facts.baseLiveSha || '').toLowerCase();
    fail(SHA_PATTERN.test(head) && SHA_PATTERN.test(baseLiveSha),
        'Prepare requires exact candidate and live SHAs', 'PRODUCTION_BLOCK_SHA_INVALID');
    const migrations = (facts.migrations || []).map(item => classifyMigration(item.file, item.sql));
    const changed = normalizePathList(facts.changedPaths || []);
    const redPaths = redChangedPaths(changed);
    const protectedWorkflow = validateProtectedWorkflow(options.protectedWorkflow || 'none', changed, redPaths);
    const qaScope = validateQaScope(options.qaScope || { enabled: false });
    fail(qaScope.kind !== 'finance' || protectedWorkflow.kind === PROTECTED_WORKFLOWS.FINANCE_MANUAL_QA,
        'Finance QA scope requires the dedicated finance workflow', 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    if (protectedWorkflow.kind === PROTECTED_WORKFLOWS.CERTIFICATE_CI_GATE) {
        fail(qaScope.enabled === false && migrations.length === 0,
            'Certificate CI release cannot include migrations or QA records',
            'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    }
    if (protectedWorkflow.kind === PROTECTED_WORKFLOWS.LEAD_UI_CI_GATE) {
        fail(qaScope.enabled === false && migrations.length === 0,
            'Lead UI CI release cannot include migrations or production QA records',
            'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    }
    if (protectedWorkflow.kind === PROTECTED_WORKFLOWS.HR_PAYROLL) {
        validateHrPayrollScope(qaScope, migrations);
        fail(isNewerVersion(facts.releaseVersion, facts.live?.version),
            'HR/payroll needs a prepared release commit newer than live', 'PRODUCTION_BLOCK_RELEASE_NOT_PREPARED');
    }
    if (protectedWorkflow.kind === PROTECTED_WORKFLOWS.FINANCE_MANUAL_QA) {
        migrations.forEach((item, index) => {
            item.sqlHash = migrationSqlHash(facts.migrations[index].sql);
            item.protectedException = FINANCE_SQL_EXCEPTION;
        });
        validateFinanceScope(qaScope, migrations);
        fail(isNewerVersion(facts.releaseVersion, facts.live?.version),
            'Finance needs a prepared release commit newer than live', 'PRODUCTION_BLOCK_RELEASE_NOT_PREPARED');
    }
    const redMigrations = migrations.filter(item => item.red
        && protectedWorkflow.kind !== PROTECTED_WORKFLOWS.FINANCE_MANUAL_QA);
    fail(facts.descendsFromLive === true, 'Candidate HEAD is not a descendant of live SHA', 'PRODUCTION_BLOCK_NOT_DESCENDANT');
    fail(redMigrations.length === 0, 'Candidate includes a Red migration', 'PRODUCTION_BLOCK_RED_MIGRATION', {
        migrations: redMigrations.map(item => ({ file: item.file, reason: item.redReason }))
    });
    const manifest = {
        schemaVersion: SCHEMA_VERSION,
        blockId: buildBlockId(now, head),
        createdAt: now.toISOString(),
        validUntil: new Date(now.valueOf() + (validityMinutes * 60_000)).toISOString(),
        baseLiveSha,
        initialHeadSha: head,
        allowedBranch: TARGET.branch,
        railwayProjectId: TARGET.railwayProjectId,
        railwayEnvironment: TARGET.railwayEnvironment,
        railwayServiceId: TARGET.railwayServiceId,
        liveUrl: TARGET.liveUrl,
        allowedMigrationFiles: migrations.map(item => item.file).sort(),
        migrationClassifications: migrations.sort((left, right) => left.file.localeCompare(right.file)),
        allowedQaScope: qaScope,
        allowedProtectedWorkflow: protectedWorkflow,
        releaseLabel: String(options.releaseLabel || 'Autonomy Hardening').trim().slice(0, 120),
        releaseNotes: validateReleaseNotes(options.releaseNotes || []),
        maxReleaseAttempts: Number(options.maxReleaseAttempts || DEFAULT_MAX_ATTEMPTS),
        realDataMutationAllowed: false,
        settingsMutationAllowed: false,
        secretsMutationAllowed: false,
        protectedContractMutationAllowed: false,
        rollbackReference: options.rollbackReference || {
            previousProductionSha: baseLiveSha,
            ...(protectedWorkflow.kind === PROTECTED_WORKFLOWS.FINANCE_MANUAL_QA
                ? { compatibleBinaryRequired: true, pre381RollbackProhibited: true, preserveJournalEvidence: true } : {}),
            migrations: Object.fromEntries(migrations.map(item => [item.file, item.rollback || 'No automatic rollback documented']))
        },
        changedPaths: changed,
        ...([PROTECTED_WORKFLOWS.HR_PAYROLL, PROTECTED_WORKFLOWS.FINANCE_MANUAL_QA].includes(protectedWorkflow.kind) ? {
            preparedRelease: { sha: head, version: facts.releaseVersion, baseVersion: facts.live.version }
        } : {}),
        runtimeState: {
            releaseAttempts: 0,
            lastAttemptAt: null,
            lastFailureCode: null,
            releaseSha: null,
            releaseCompletedAt: null,
            qa: null
        }
    };
    fail(Number.isInteger(manifest.maxReleaseAttempts) && manifest.maxReleaseAttempts >= 1 && manifest.maxReleaseAttempts <= 3,
        'Release attempt budget must be 1-3', 'PRODUCTION_BLOCK_ATTEMPTS_INVALID');
    manifest.manifestHash = manifestHash(manifest);
    return manifest;
}

function validateManifest(manifest, options = {}) {
    fail(manifest && typeof manifest === 'object' && !Array.isArray(manifest),
        'Production block manifest is invalid', 'PRODUCTION_BLOCK_MANIFEST_INVALID');
    fail(manifest.schemaVersion === SCHEMA_VERSION && BLOCK_ID_PATTERN.test(String(manifest.blockId || '')),
        'Production block schema or block ID is invalid', 'PRODUCTION_BLOCK_MANIFEST_INVALID');
    fail(manifest.manifestHash === manifestHash(manifest),
        'Production block manifest hash differs', 'PRODUCTION_BLOCK_HASH_MISMATCH');
    const createdAt = new Date(manifest.createdAt);
    const validUntil = new Date(manifest.validUntil);
    fail(!Number.isNaN(createdAt.valueOf()) && !Number.isNaN(validUntil.valueOf())
        && validUntil > createdAt && validUntil.valueOf() - createdAt.valueOf() <= MAX_VALIDITY_MS,
    'Production block validity envelope is invalid', 'PRODUCTION_BLOCK_VALIDITY_INVALID');
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    if (options.requireUnexpired !== false) fail(now <= validUntil,
        'Production block has expired', 'PRODUCTION_BLOCK_EXPIRED');
    fail(manifest.allowedBranch === TARGET.branch
        && manifest.railwayProjectId === TARGET.railwayProjectId
        && manifest.railwayEnvironment === TARGET.railwayEnvironment
        && manifest.railwayServiceId === TARGET.railwayServiceId
        && manifest.liveUrl === TARGET.liveUrl,
    'Production target differs from the fixed EventGenix envelope', 'PRODUCTION_BLOCK_TARGET_MISMATCH');
    fail(manifest.realDataMutationAllowed === false
        && manifest.settingsMutationAllowed === false
        && manifest.secretsMutationAllowed === false
        && manifest.protectedContractMutationAllowed === false,
    'Production block attempts to permit a Red action', 'PRODUCTION_BLOCK_RED_PERMISSION');
    const qaScope = validateQaScope(manifest.allowedQaScope);
    validateReleaseNotes(manifest.releaseNotes);
    const changed = normalizePathList(manifest.changedPaths || []);
    const protectedWorkflow = manifest.allowedProtectedWorkflow || { enabled: false, kind: null, protectedChangedPaths: [] };
    fail(qaScope.kind !== 'finance' || protectedWorkflow.kind === PROTECTED_WORKFLOWS.FINANCE_MANUAL_QA,
        'Finance QA scope requires the dedicated finance workflow', 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    const validatedProtectedWorkflow = validateProtectedWorkflow(
        protectedWorkflow.enabled ? protectedWorkflow.kind : 'none',
        changed,
        redChangedPaths(changed)
    );
    fail(JSON.stringify(validatedProtectedWorkflow) === JSON.stringify(protectedWorkflow),
        'Protected workflow envelope differs from candidate paths', 'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_DRIFT');
    if (protectedWorkflow.kind === PROTECTED_WORKFLOWS.CERTIFICATE_CI_GATE) {
        fail(qaScope.enabled === false && manifest.allowedMigrationFiles.length === 0
            && manifest.migrationClassifications.length === 0,
            'Certificate CI release cannot include migrations or QA records',
            'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    }
    if (protectedWorkflow.kind === PROTECTED_WORKFLOWS.LEAD_UI_CI_GATE) {
        fail(qaScope.enabled === false && manifest.allowedMigrationFiles.length === 0
            && manifest.migrationClassifications.length === 0,
            'Lead UI CI release cannot include migrations or production QA records',
            'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    }
    if (protectedWorkflow.kind === PROTECTED_WORKFLOWS.HR_PAYROLL) {
        validateHrPayrollScope(qaScope, manifest.migrationClassifications);
        fail(JSON.stringify(manifest.allowedMigrationFiles) === JSON.stringify([HR_PAYROLL_MIGRATION]),
            'HR/payroll migration inventory differs', 'PRODUCTION_BLOCK_MIGRATION_DRIFT');
        fail(manifest.preparedRelease?.sha === manifest.initialHeadSha
            && isNewerVersion(manifest.preparedRelease?.version, manifest.preparedRelease?.baseVersion),
            'HR/payroll requires an exact prepared release SHA', 'PRODUCTION_BLOCK_RELEASE_NOT_PREPARED');
    }
    if (protectedWorkflow.kind === PROTECTED_WORKFLOWS.FINANCE_MANUAL_QA) {
        validateFinanceScope(qaScope, manifest.migrationClassifications);
        fail(JSON.stringify(manifest.allowedMigrationFiles) === JSON.stringify(Object.keys(FINANCE_MANUAL_SQL_HASHES).sort()),
            'Finance migration inventory differs', 'PRODUCTION_BLOCK_MIGRATION_DRIFT');
        fail(manifest.preparedRelease?.sha === manifest.initialHeadSha
            && isNewerVersion(manifest.preparedRelease?.version, manifest.preparedRelease?.baseVersion),
            'Finance requires an exact prepared release SHA', 'PRODUCTION_BLOCK_RELEASE_NOT_PREPARED');
        fail(Number.isInteger(manifest.maxReleaseAttempts) && manifest.maxReleaseAttempts >= 1 && manifest.maxReleaseAttempts <= 3,
            'Finance release attempt budget must be 1-3', 'PRODUCTION_BLOCK_ATTEMPTS_INVALID');
    }
    return manifest;
}

function isNewerVersion(candidate, base) {
    if (!/^\d+\.\d+\.\d+$/.test(String(candidate)) || !/^\d+\.\d+\.\d+$/.test(String(base))) return false;
    const left = candidate.split('.').map(Number), right = base.split('.').map(Number);
    const first = left.findIndex((value, index) => value !== right[index]);
    return first >= 0 && left[first] > right[first];
}
function validateHrPayrollScope(qa, migrations) {
    fail(qa.enabled === false && migrations.length === 1 && migrations[0].file === HR_PAYROLL_MIGRATION
        && migrations[0].kind === 'schema' && migrations[0].red === false,
        'HR/payroll permits only migration 374 schema and read-only production QA',
        'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
}

function validateFinanceScope(qa, migrations) {
    const files = Object.keys(FINANCE_MANUAL_SQL_HASHES).sort();
    fail((qa.enabled === false || qa.kind === 'finance') && Array.isArray(migrations)
        && JSON.stringify(migrations.map(item => item.file).sort()) === JSON.stringify(files),
    'Finance permits only the two exact reviewed migrations and optional bounded manual finance QA',
    'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    for (const item of migrations) {
        const isJournal = item.file === 'db/migrations/381_finance_manual_money.sql';
        fail(item.sqlHash === FINANCE_MANUAL_SQL_HASHES[item.file],
            'Finance migration SQL differs from the reviewed hash', 'PRODUCTION_BLOCK_MIGRATION_HASH_DRIFT', { file: item.file });
        fail(item.protectedException === FINANCE_SQL_EXCEPTION
            && item.number === (isJournal ? 381 : 382)
            && (isJournal
                ? item.kind === 'cleanup' && item.red === true && item.destructive === true
                : item.kind === 'schema' && item.red === false && item.destructive === false),
        'Finance migration must retain its exact classification and explicit SQL exception',
        'PRODUCTION_BLOCK_PROTECTED_WORKFLOW_SCOPE_INVALID');
    }
}

function confirmationValue(manifest) {
    validateManifest(manifest, { requireUnexpired: false });
    return `ALLOW_PRODUCTION_BLOCK:${manifest.blockId}:${manifest.manifestHash.slice(0, 12)}`;
}

function warningText(manifest) {
    const migrations = manifest.allowedMigrationFiles.length ? manifest.allowedMigrationFiles.join(', ') : 'none';
    const qa = manifest.allowedQaScope?.kind === 'finance'
        ? `finance: manual-only, run ${manifest.allowedQaScope.runId}, account ${manifest.allowedQaScope.testAccountId}, TTL ${manifest.allowedQaScope.ttlMinutes} хв; plan hash ${manifest.allowedQaScope.planHash}; controller не створює записи`
        : manifest.allowedQaScope?.kind === 'certificate'
        ? `certificate: 1 запис, run ${manifest.allowedQaScope.runId}, account ${manifest.allowedQaScope.testAccountId}, TTL ${manifest.allowedQaScope.ttlMinutes} хв`
        : manifest.allowedQaScope?.enabled
            ? `${manifest.allowedQaScope.kind || 'trusted QA'}, TTL ${manifest.allowedQaScope.ttlMinutes || '?'} хв`
            : 'none';
    const protectedWorkflow = manifest.allowedProtectedWorkflow?.enabled
        ? `${manifest.allowedProtectedWorkflow.kind}; protected paths: ${manifest.allowedProtectedWorkflow.protectedChangedPaths.join(', ')}`
        : 'none';
    return [
        `УВАГА · ${manifest.blockId}`,
        '',
        `Дія: випуск ${manifest.releaseLabel}.`,
        '',
        'Наслідки:',
        manifest.preparedRelease
            ? `1. Точний готовий release SHA ${manifest.initialHeadSha} буде запушено у ${manifest.allowedBranch}.`
            : `1. Release commit — descendant candidate SHA ${manifest.initialHeadSha} — буде запушено у ${manifest.allowedBranch}.`,
        '2. Запуск exact-SHA GitHub CI.',
        `3. Deploy у Railway service ${manifest.railwayServiceId}.`,
        `4. Застосування migrations: ${migrations}.`,
        `5. Disposable QA: ${qa}.`,
        `6. Protected workflow: ${protectedWorkflow}.`,
        `7. Release notes: ${manifest.releaseNotes.length} підписаних пунктів.`,
        ...(manifest.renewalFrom
            ? [`8. Окремо погоджений ${manifest.renewalFrom.humanBlockId}: одна нова спроба до ${manifest.validUntil}; історія ${manifest.renewalFrom.attemptsUsed} попередніх спроб збережена.`]
            : []),
        ...(manifest.allowedProtectedWorkflow?.kind === PROTECTED_WORKFLOWS.CERTIFICATE_CI_GATE
            ? ['8. Окремий Red-ефект після deploy: scheduler може перевести лише active із valid_until < поточної київської дати в expired (до 1000 записів); потрібні свіжий read-only підрахунок і прямий дозвіл власника.']
            : []),
        '',
        'Межі: тільки зафіксовані branch/service/migrations/QA scope/protected workflow; прямі зміни реальних даних через controller, налаштувань і секретів заборонені.',
        manifest.allowedProtectedWorkflow?.kind === PROTECTED_WORKFLOWS.FINANCE_MANUAL_QA
            ? 'Відкат фінансів: тільки сумісний binary зі збереженими журналом, ownership guards і поділом змін. Після записів відкат на pre381 SHA та видалення журналу заборонені; QA завершення зберігає evidence.'
            : `Відкат: production SHA ${manifest.baseLiveSha}; migration mapping у block manifest; exact QA cleanup.`,
        `Потрібний дозвіл: «Дозволяю блок ${manifest.blockId}» або exact controller confirmation ${confirmationValue(manifest)}.`
    ].join('\n');
}

module.exports = {
    DEFAULT_MAX_ATTEMPTS,
    MAX_VALIDITY_MS,
    ProductionBlockError,
    PROTECTED_WORKFLOWS,
    RED_PATH_PATTERNS,
    SCHEMA_VERSION,
    TARGET,
    buildManifest,
    classifyMigration,
    confirmationValue,
    manifestHash,
    migrationSqlHash,
    isPreparedProtectedRelease,
    isSysMbProtectedPath,
    redChangedPaths,
    sanitize,
    stableJson,
    validateManifest,
    validateProtectedWorkflow,
    validateQaScope,
    validateReleaseNotes,
    warningText
};
