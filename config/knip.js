const { readFileSync } = require('node:fs');
const { posix, resolve } = require('node:path');
const { ROOT_HTML_SURFACE, LANDING_SURFACE } = require('./staticSurface');
const { scripts } = require('../package.json');
const educationContracts = require('../tests/helpers/education-close-contracts.json');

const read = file => readFileSync(resolve(__dirname, '..', file), 'utf8');
const browserEntries = [...ROOT_HTML_SURFACE, ...LANDING_SURFACE].flatMap(({ file }) => {
    const html = read(file).replace(/<!--[\s\S]*?-->/g, '');
    const tags = html.matchAll(/<script\b[^>]*\ssrc\s*=\s*["']([^"'?#]+)[^"']*["']/gi);
    return [...tags].map(([, src]) => src).filter(src => {
        return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src) && /\.[cm]?js$/i.test(src);
    }).map(src => src.startsWith('/') ? src.slice(1) : posix.join(posix.dirname(file), src));
});

// Knip does not follow all npm exec shell commands or paths passed to the test runner.
const wrappedCommands = Object.values(scripts).filter(script => script.includes(' -c "')).join('\n');
const wrappedEntries = [...wrappedCommands.matchAll(/\bnode\s+((?:scripts|tests)\/[\w./-]+\.[cm]?js)\b/g)]
    .map(([, file]) => file);
const isolatedTestEntries = [...read('scripts/run-isolated-postgres-tests.js').matchAll(/['"](?:--require=)?(?:\.\/)?(tests\/(?:browser|integration|helpers)\/[\w./-]+\.[cm]?js)['"]/g)]
    .map(([, file]) => file);

// The manual Education launcher passes these paths to child processes.
const manualEducation = read('tests/integration/education-manual-runner.js');
const manualEducationBrowserEntries = [...manualEducation.matchAll(/\bbrowser\('([\w-]+)'\)/g)]
    .map(([, name]) => 'tests/browser/' + name + '.js');

module.exports = {
    entry: [...new Set([
        ...browserEntries,
        // Browser-dispatched scripts in auth.js, profile-page.js, hr-page.js and staff-schedule-loader.js.
        'sw.js',
        'js/{account-access-editor,assistant-foundation,assistant-output-format,assistant-rail,crm-feature-registry,global-task-timer,search,sidebar-smart-menu,telegram-crm-profile}.js',
        'js/{business-cabinet-manager,business-membership-manager,hr-structure-page,profile-employee-views,staff-page,staff-schedule-shell}.js',
        // Runtime worker fork in services/catalogImageThumbnails.js.
        'scripts/catalog-thumbnail-worker.js',
        // Computed require in scripts/check-access-matrix.js.
        'config/accessSurface.js',
        ...wrappedEntries,
        ...isolatedTestEntries,
        // The Education CI shard starts a child runner that dispatches files from the contract manifest.
        'tests/integration/run-education-close-ci.js',
        ...Object.values(educationContracts).map(contract => contract.file),
        'scripts/lib/education-ready-loopback.js',
        'tests/integration/run-education-close-{attendance,teachers,ux,visual}.js',
        'tests/integration/run-education-ready-{async,baseline,dataset,date,design,groups,lifecycle,mobile,teachers}.js',
        'tests/browser/education-ready-baseline.js',
        ...manualEducationBrowserEntries,
        // Spawned evidence verifiers and the Education report-clock preload.
        'tests/tools/verify-education-close-{attempt,pack}.js',
        'tests/tools/verify-education-close-device.js',
        'tests/helpers/education-ready-report-clock.js',
        // Spawned by the production block controller and timeline browser smoke, respectively.
        'scripts/trusted-qa-finance-run.js',
        'scripts/timeline-smoke-cleanup-preflight.js',
        // The SYS-MB runner passes these paths through spawn and NODE_OPTIONS.
        'tests/acceptance/sys-mb-browser-worker.cjs',
        'tests/acceptance/sys-mb-local-preload.cjs',
        // Child processes and source fixtures passed by path in the regression suites.
        'tests/fixtures/{crm-creative-kie-resume,dependency-process-regression,menu-paid-kill-worker}.cjs',
        'tests/browser/{products-demo.spec,sidebar-timeline-launcher-smoke}.js',
        // Browser test fixtures loaded through script tags or evaluated as text.
        'js/my-day-{classification,contribution,dependencies,habits,time-tracking}.js',
        'js/{profile-game-legacy,task-ai-draft}.js',
        'tests/benchmarks/runtime-artifact-smoke.js',
        'tests/acceptance/run-sys-mb-local.cjs',
        // Standalone commands in the operational runbooks and the seed's usage header.
        'scripts/audit-{certificate-types,graduation-business-readiness,payroll-freelance-drafts}.js',
        'scripts/audit-park-profession-ownership.cjs',
        'scripts/{build-hr-crm-ux-gallery,render-hr-crm-guide,report-native-ai-usage,run-hermes-attendance-read-postgres}.js',
        'scripts/trusted-qa-{certificate,hr}-run.js',
        'scripts/prepare-margarita-menu-image-payload.js',
        'scripts/sync-kitchen-menu-images.js',
        // Documented operator commands and booking reconciliation loaded by the VM contract test.
        'docs/workstreams/sys-multibusiness/asset-close-01/tools/catalog-asset-repair-controller.cjs',
        'scripts/{audit-hr-hiring-ownership,game-zone-classification,reconcile-banquet-groups}.js',
        'scripts/audit-park-hr-monthly-ownership.cjs',
        // The Education handoffs name these standalone runners and evidence verifiers.
        'scripts/{prepare-education-device-checklist,start-education-device-preview}.js',
        'tests/browser/{education-device-preview-preflight,education-ready-async-preview-readonly,education-ready-live-readonly,education-ready-report-directory-readonly}.js',
        'tests/tools/{audit-education-test-coverage,run-education-ready-final,verify-education-device-evidence,verify-education-device-preparation}.js',
        'tests/tools/verify-education-ready-{evidence,final}.js',
        'tests/tools/verify-education-ready-{async,dataset,date,design,groups,lifecycle,mobile,teachers}-evidence.js',
        // Explicit standalone browser QA commands in the Finance, Checkbox, Profile and redirect handoffs.
        'tests/browser/finance-customization-local-smoke.js',
        'tests/browser/{cashier-catalog-layout,cashier-next-customer,shared-test-day}-browser-smoke.js',
        'tests/browser/{profile-employee-cabinet,r10a-recovery-login-ui,redirect-regression-gate,timeline-afisha-dual}-browser-smoke.js',
        'tests/browser/{business-membership-editor,business-profile-access}.spec.js',
        // Standalone browser checks verified with local synthetic fixtures.
        'tests/browser/baseline-access-navigation-browser-smoke.js',
        'tests/browser/business-cabinet-manager.spec.js',
        'tests/browser/legacy-containment.spec.js',
        'tests/browser/telegram-crm-profile.spec.js',
        'tests/browser/login-signal.browser.cjs',
        'db/seeds/training_knowledge_base.js'
    ])]
};
