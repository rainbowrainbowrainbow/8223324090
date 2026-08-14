'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const HR_PAGE_CODE = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
const HR_HTML = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
const HR_CSS = fs.readFileSync(path.join(ROOT, 'css', 'hr-page.css'), 'utf8');
const USERS_ROUTE = fs.readFileSync(path.join(ROOT, 'routes', 'users.js'), 'utf8');
const UI_CODE = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
const STAFF_PAGE_CODE = fs.readFileSync(path.join(ROOT, 'js', 'staff-page.js'), 'utf8');
const HR_FULLSTACK_BROWSER_SMOKE = fs.readFileSync(path.join(ROOT, 'tests', 'browser', 'hr-onboarding-fullstack-browser-smoke.js'), 'utf8');

function between(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
    assert.ok(end > start, `Missing source marker: ${endMarker}`);
    return source.slice(start, end);
}

function response(status, payload = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return payload; }
    };
}

function loadHrFetchHarness(status, payload = {}) {
    const removedKeys = [];
    const location = { href: '/hr#accounts' };
    const context = {
        console,
        fetch: async () => response(status, payload),
        localStorage: { removeItem: key => removedKeys.push(key) },
        location
    };
    const source = between(HR_PAGE_CODE, 'async function hrFetch(', 'async function confirmHrAction(');
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'js/hr-page.js#account-fetch-contract' });
    return { context, removedKeys, location };
}

test('HR account fetch helpers preserve the authenticated session on a capability 403', async () => {
    const { context, removedKeys, location } = loadHrFetchHarness(403, { error: 'Forbidden' });

    const accountResult = await context.crmApiFetch('/api/users');
    const hrResult = await context.hrFetch('/staff');

    assert.equal(accountResult.success, false);
    assert.equal(accountResult.status, 403);
    assert.equal(hrResult.success, false);
    assert.equal(hrResult.status, 403);
    assert.deepEqual(removedKeys, []);
    assert.equal(location.href, '/hr#accounts');
});

test('HR account fetch helpers still clear the legacy token on a real 401', async () => {
    const { context, removedKeys, location } = loadHrFetchHarness(401, { error: 'Unauthorized' });

    assert.equal(await context.crmApiFetch('/api/users'), null);
    assert.deepEqual(removedKeys, ['pzp_token']);
    assert.equal(location.href, '/');
});

test('account center is a dense master-detail surface with conflict drill-down', () => {
    assert.match(HR_HTML, /id="accountCenterWorkspace"/);
    assert.match(HR_HTML, /id="accountDetailPanel"/);
    assert.match(HR_HTML, /id="accountCenterStatusFilter"/);
    assert.match(HR_HTML, /id="accountCenterLinkFilter"/);
    assert.match(HR_HTML, /id="accountCenterConflictFilter"/);
    assert.match(HR_PAGE_CODE, /function renderAccountDetailPanel/);
    assert.match(HR_PAGE_CODE, /function renderAccountConflictDrilldown/);
    assert.match(HR_PAGE_CODE, /data-account-menu-toggle/);
    assert.match(HR_PAGE_CODE, /function fixedMenuContainingBlockOrigin/);
    assert.match(HR_PAGE_CODE, /left - origin\.left/);
    assert.match(HR_PAGE_CODE, /top - origin\.top/);
    assert.doesNotMatch(HR_HTML, /id="accountCenterActiveOnly"/);
    assert.match(HR_CSS, /\.hr-account-workspace\s*\{/);
    assert.match(HR_CSS, /\.hr-account-row-open\s*\{/);
});

test('account creation uses the seven-step atomic onboarding workspace', () => {
    assert.equal((HR_HTML.match(/data-account-onboarding-step="\d"/g) || []).length, 7);
    assert.match(HR_HTML, /id="accountOnboardingReceipt"/);
    assert.match(HR_HTML, /Тимчасовий пароль буде показано один раз/);
    assert.match(HR_PAGE_CODE, /async function openAccountOnboardingWizard/);
    assert.match(HR_PAGE_CODE, /function buildAccountOnboardingPayload/);
    assert.match(HR_PAGE_CODE, /crmApiFetch\('\/api\/users\/onboarding\/options'\)/);
    assert.match(HR_PAGE_CODE, /crmApiFetch\('\/api\/users\/onboarding'/);
    assert.match(HR_PAGE_CODE, /rateMode !== 'keep'/);
    assert.match(USERS_ROUTE, /router\.post\('\/onboarding', requireAction\('manage_accounts'\), requireAction\('hr\.staff\.manage'\)/);
    assert.match(USERS_ROUTE, /router\.get\('\/onboarding\/options', requireAction\('manage_accounts'\), requireAction\('hr\.staff\.manage'\)/);
    assert.match(HR_PAGE_CODE, /function canRunAccountOnboarding/);
    assert.match(HR_HTML, /option value="unchanged"/);
    assert.match(HR_PAGE_CODE, /expectedRequestSeq !== accountOnboardingRequestSeq/);
    assert.match(HR_PAGE_CODE, /function prefillSelectedAccountOnboardingCondition/);
    assert.match(HR_PAGE_CODE, /accountOnboardingConditionProfession'\)\?\.addEventListener\('change'/);
    assert.match(HR_PAGE_CODE, /document\.body\.appendChild\(overlay\)/);
    assert.match(HR_PAGE_CODE, /document\.body\.appendChild\(panel\)/);
    assert.match(HR_PAGE_CODE, /panel\.setAttribute\('aria-modal', 'true'\)/);
    assert.match(HR_PAGE_CODE, /root\.focus\(\{ preventScroll: true \}\)/);
    assert.match(USERS_ROUTE, /createAccountOnboarding/);
    assert.match(USERS_ROUTE, /profession_conditions: conditionsByStaff/);
    assert.match(USERS_ROUTE, /const linkActive = row\.profile_active !== false && row\.staff_active !== false/);
    assert.match(UI_CODE, /disabled \? ' disabled aria-disabled="true"'/);
});

test('account onboarding commits async definitions and restores focus only through current visible targets', () => {
    const optionsSource = between(
        HR_PAGE_CODE,
        'async function loadAccountOnboardingOptions(',
        'function renderAccountOnboardingCheckboxList('
    );
    const guardIndex = optionsSource.indexOf('expectedRequestSeq !== accountOnboardingRequestSeq');
    const roleCommitIndex = optionsSource.indexOf('commitAccountRoleDefinitions(roleDefinitions)');
    assert.match(optionsSource, /fetchAccountRoleDefinitions\(\)/);
    assert.doesNotMatch(optionsSource, /loadAccountRoleDefinitions\(\)/);
    assert.ok(guardIndex >= 0 && roleCommitIndex > guardIndex, 'role definitions must commit only after the onboarding request guard');
    assert.match(HR_PAGE_CODE, /accountRoleDefinitionsPromise = crmApiFetch\('\/api\/users\/roles'\)/);

    const detailOpenSource = between(HR_PAGE_CODE, 'async function openAccountDetail(', 'async function loadAccountDetailWorkspace(');
    assert.match(detailOpenSource, /const returnFocus = options\.returnFocus \|\| document\.activeElement/);
    assert.match(detailOpenSource, /returnFocus \}\)/);
    assert.match(HR_PAGE_CODE, /\{ focus: true, returnFocus: open \}/);

    const focusGuardSource = between(HR_PAGE_CODE, 'function isUsableAccountFocusTarget(', 'function setAccountDetailMobileBackgroundInert(');
    assert.match(focusGuardSource, /target === document\.body/);
    assert.match(focusGuardSource, /target\.closest\?\.\('\[hidden\], \.hidden, \[inert\]'\)/);
    assert.match(focusGuardSource, /#hrNav \.hr-tab\.active/);

    const mobileCloseSource = between(HR_PAGE_CODE, 'function closeAccountDetailMobile(', 'async function unlinkAccountStaff(');
    assert.match(mobileCloseSource, /isUsableAccountFocusTarget\(portal\?\.returnFocus\)/);
    assert.match(mobileCloseSource, /accountFocusFallback\(\)/);

    const onboardingCloseSource = between(HR_PAGE_CODE, 'function closeAccountOnboardingWizard()', 'function setAccountOnboardingBackgroundInert(');
    assert.match(onboardingCloseSource, /isUsableAccountFocusTarget\(returnFocus\)/);
    assert.match(onboardingCloseSource, /accountFocusFallback\(\)/);
});

test('account onboarding recovers from request failures and never logs issued credentials', () => {
    const submitSource = between(HR_PAGE_CODE, 'async function submitAccountOnboarding()', 'function closeAccountOnboardingWizard()');
    assert.match(submitSource, /try\s*\{/);
    assert.match(submitSource, /catch\s*\(error\)/);
    assert.match(submitSource, /finally\s*\{/);
    assert.match(submitSource, /accountOnboardingState\.submitting = false/);
    assert.match(submitSource, /submit\.disabled = false/);

    const hrCredentialSource = between(HR_PAGE_CODE, 'function showOneTimeCredentialModal(', 'function showManualPasswordResetResult(');
    const staffCredentialSource = between(STAFF_PAGE_CODE, 'function showOneTimeCredential(', 'function suggestUsernameFromStaffInfo(');
    assert.doesNotMatch(hrCredentialSource, /console\.(?:log|info|warn|error)/);
    assert.doesNotMatch(staffCredentialSource, /console\.(?:log|info|warn|error)/);
});

test('HR onboarding full-stack browser smoke uses deterministic app readiness and vacancy reloads', () => {
    assert.match(HR_FULLSTACK_BROWSER_SMOKE, /async function waitForAppShell/);
    assert.match(HR_FULLSTACK_BROWSER_SMOKE, /document\.readyState === 'loading'/);
    assert.match(HR_FULLSTACK_BROWSER_SMOKE, /typeof window\.crmApiFetch !== 'function'/);
    assert.match(HR_FULLSTACK_BROWSER_SMOKE, /async function reloadVacanciesWithStatus/);
    assert.match(HR_FULLSTACK_BROWSER_SMOKE, /return window\.loadVacancies\(\)/);
    assert.doesNotMatch(HR_FULLSTACK_BROWSER_SMOKE, /selectOption\('all'\)/);
});
