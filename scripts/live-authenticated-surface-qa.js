'use strict';

// Manual production release gate. It intentionally does not belong in CI:
// credentials are read only from the local, untracked EventGenix secrets file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SECRET_FILE = path.join(os.homedir(), '.eventgenix', 'codex-crm-secrets.ps1');
const MAX_RETRIES = 4;
const MAX_RETRY_AFTER_MS = 30_000;
const SAFE_BROWSER_METHODS = new Set(['GET', 'HEAD']);
const SAFE_BROWSER_POST_PATHS = new Set(['/api/auth/login', '/api/auth/refresh']);
const KNOWN_AUTOMATIC_BLOCKED_PATHS = new Set(['/api/wallet/daily-login']);
const QA_ROLE_MARKER = /(?:qa|test|codex|smoke|verifier)/i;

class QaError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function assert(condition, code) {
    if (!condition) throw new QaError(code);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRetryAfter(value, now = Date.now()) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    const dateMs = Date.parse(value || '');
    if (!Number.isFinite(dateMs)) return 1_000;
    return Math.min(Math.max(0, dateMs - now), MAX_RETRY_AFTER_MS);
}

function parseSecretAssignments(source) {
    const values = Object.create(null);
    const pattern = /^\s*\$env:(LIVE_SMOKE_URL|LIVE_SMOKE_USER|LIVE_SMOKE_PASS|LIVE_CREATOR_USER|LIVE_CREATOR_PASS)\s*=\s*(['"])(.*?)\2\s*$/gm;
    for (const match of source.matchAll(pattern)) values[match[1]] = match[3];
    return values;
}

function loadQaConfig(secretFile = SECRET_FILE) {
    assert(fs.existsSync(secretFile), 'qa_secret_file_missing');
    const values = parseSecretAssignments(fs.readFileSync(secretFile, 'utf8'));
    for (const key of ['LIVE_SMOKE_URL', 'LIVE_SMOKE_USER', 'LIVE_SMOKE_PASS', 'LIVE_CREATOR_USER', 'LIVE_CREATOR_PASS']) {
        assert(Boolean(values[key]), 'qa_secret_assignment_missing');
    }
    return values;
}

function normalizeProductionBase(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new QaError('qa_target_invalid');
    }
    assert(url.protocol === 'https:', 'qa_target_not_https');
    return url.origin;
}

function safeRequestPath(input) {
    try {
        return new URL(input).pathname;
    } catch {
        return String(input || '').split('?')[0];
    }
}

function sanitizedApiPath(input) {
    return safeRequestPath(input).replace(/\/\d+(?=\/|$)/g, '/:id');
}
function browserRequestIsAllowed(method, url) {
    const normalizedMethod = String(method || '').toUpperCase();
    if (SAFE_BROWSER_METHODS.has(normalizedMethod)) return true;
    return normalizedMethod === 'POST' && SAFE_BROWSER_POST_PATHS.has(safeRequestPath(url));
}

function safeResourceOrigin(input) {
    try {
        return new URL(input).origin;
    } catch {
        return 'unknown';
    }
}
function classifyConsoleError(message) {
    const value = String(message || '').toLowerCase();
    if (value.includes('wallet') || value.includes('daily-login')) return 'wallet_auto_request_blocked';
    if (value.includes('notallowederror') || value.includes('[checkin] initialization failed')) return 'checkin_camera_denial_expected';
    if (value.includes('content security policy') || value.includes('csp')) return 'csp_error';
    if (value.includes('blockedbyclient') || value.includes('net::err_failed')) return 'runner_blocked_request';
    if (value.includes('failed to load resource')) return 'resource_load_error';
    return 'other_console_error';
}

function incrementCount(target, key) {
    target[key] = (target[key] || 0) + 1;
}
function requirePlaywright() {
    try {
        return require('playwright');
    } catch {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
    }
    throw new QaError('qa_playwright_unavailable');
}
function tokenFromLogin(body) {
    const token = body?.accessToken || body?.token;
    assert(typeof token === 'string' && token.length > 20, 'qa_login_token_missing');
    return token;
}

async function fetchJson(base, route, options = {}) {
    const method = options.method || 'GET';
    const headers = {
        Accept: 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
    };
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
        let response;
        try {
            response = await fetch(`${base}${route}`, {
                method,
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: options.signal
            });
        } catch (error) {
            if (attempt + 1 < MAX_RETRIES && error?.name !== 'AbortError') {
                await sleep(500 * (attempt + 1));
                continue;
            }
            throw new QaError('qa_network_failure');
        }
        if (response.status === 429 && attempt + 1 < MAX_RETRIES) {
            await sleep(parseRetryAfter(response.headers.get('retry-after')));
            continue;
        }
        if (!response.ok) throw new QaError(`qa_http_${response.status}_${method.toLowerCase()}`);
        let body;
        try {
            body = await response.json();
        } catch {
            throw new QaError('qa_json_response_invalid');
        }
        assert(body && typeof body === 'object', 'qa_json_response_invalid');
        return body;
    }
    throw new QaError('qa_rate_limit_exhausted');
}

async function login(base, username, password) {
    return tokenFromLogin(await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    }));
}

async function verifyUser(base, token) {
    const body = await fetchJson(base, '/api/auth/verify', { token });
    assert(body.user && Number.isInteger(Number(body.user.id)), 'qa_verify_user_invalid');
    assert(typeof body.user.role === 'string' && body.user.role, 'qa_verify_role_invalid');
    return body.user;
}

async function readPermissions(base, token) {
    const permissions = await fetchJson(base, '/api/auth/permissions', { token });
    assert(permissions.capabilities && typeof permissions.capabilities === 'object', 'qa_permissions_invalid');
    return permissions;
}

function capabilityAllowed(permissions, type, key) {
    const explicit = permissions?.capabilities?.[`${type}:${key}`];
    if (explicit && typeof explicit.allowed === 'boolean') return explicit.allowed;
    const legacy = type === 'page' ? permissions?.pages : permissions?.actions;
    return Boolean(legacy?.[key]);
}

async function setQaRole(base, creatorToken, qaUserId, role) {
    const result = await fetchJson(base, `/api/users/${encodeURIComponent(qaUserId)}/access`, {
        method: 'PATCH',
        token: creatorToken,
        body: { role }
    });
    assert(result.success === true && result.newRole === role, 'qa_role_transition_failed');
}

async function waitFor(page, predicate, code, timeout = 35_000) {
    try {
        await page.waitForFunction(predicate, undefined, { timeout });
    } catch {
        throw new QaError(code);
    }
}

async function expectVisible(page, selector, code, timeout = 35_000) {
    try {
        await page.locator(selector).waitFor({ state: 'visible', timeout });
    } catch {
        throw new QaError(code);
    }
}

async function goto(page, base, pathname, code) {
    try {
        const response = await page.goto(`${base}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 35_000 });
        assert(response && response.ok(), code);
    } catch (error) {
        if (error instanceof QaError) throw error;
        throw new QaError(code);
    }
}

async function runBrowserChecks(base, config, report) {
    // Loaded lazily so static/unit checks never need Playwright installed.
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ permissions: [] });
    const page = await context.newPage();
    const browserMutations = [];
    const consoleState = { errors: 0, warnings: 0, cspErrors: 0, errorKinds: Object.create(null), requestFailures: Object.create(null) };
    const permissionResponses = [];
    await context.addInitScript(() => {
        window.__eventGenixLiveQaCameraCalls = 0;
        navigator.mediaDevices = navigator.mediaDevices || {};
        navigator.mediaDevices.getUserMedia = async () => {
            window.__eventGenixLiveQaCameraCalls += 1;
            throw new DOMException('QA camera access denied', 'NotAllowedError');
        };
    });
    page.on('console', message => {
        if (message.type() === 'error') {
            consoleState.errors += 1;
            incrementCount(consoleState.errorKinds, classifyConsoleError(message.text()));
        }
        if (message.type() === 'warning') consoleState.warnings += 1;
        if (/content security policy|\bcsp\b/i.test(message.text())) consoleState.cspErrors += 1;
    });
    page.on('requestfailed', request => {
        const resourceType = request.resourceType() || 'unknown';
        const origin = safeResourceOrigin(request.url());
        const requestPath = sanitizedApiPath(request.url());
        const label = KNOWN_AUTOMATIC_BLOCKED_PATHS.has(requestPath) ? 'blocked_automatic' : resourceType;
        incrementCount(consoleState.requestFailures, `${label}@${origin}`);
    });
    page.on('response', response => {
        if (safeRequestPath(response.url()) === '/api/auth/permissions') permissionResponses.push(response.status());
    });
    await page.route('**/api/**', route => {
        const request = route.request();
        if (browserRequestIsAllowed(request.method(), request.url())) return route.continue();
        browserMutations.push({ method: request.method().toUpperCase(), path: sanitizedApiPath(request.url()) });
        return route.abort('blockedbyclient');
    });
    await page.route('https://www.clarity.ms/**', route => route.fulfill({ status: 204, contentType: 'application/javascript', body: '' }));
    try {
        await goto(page, base, '/', 'qa_root_open_failed');
        await expectVisible(page, '#username', 'qa_login_form_missing');
        await page.locator('#username').fill(config.LIVE_SMOKE_USER);
        await page.locator('#password').fill(config.LIVE_SMOKE_PASS);
        await page.locator('#loginForm button[type="submit"]').click();
        await expectVisible(page, '#mainApp:not(.hidden)', 'qa_browser_login_failed');
        await waitFor(page, () => Boolean(window.AppState?.authPermissions || window.AppState?.currentUser?.permissions), 'qa_root_permission_hydration_failed');
        assert(permissionResponses.includes(200), 'qa_root_permissions_request_failed');
        await expectVisible(page, 'a[href="/finance"]', 'qa_root_finance_navigation_missing');
        report.routes.root = { ok: true, permissionHydrated: true };

        await goto(page, base, '/hr', 'qa_hr_open_failed');
        await expectVisible(page, '.hr-pulse-card[data-nav-id="today"]', 'qa_hr_today_missing');
        await expectVisible(page, '.hr-pulse-card[data-nav-id="schedule"]', 'qa_hr_schedule_missing');
        await expectVisible(page, '.hr-pulse-card[data-nav-id="reports"]', 'qa_hr_reports_missing');
        const hrFalseEmpty = await page.locator('body').innerText().then(text => text.includes('Немає доступних HR-розділів'));
        assert(!hrFalseEmpty, 'qa_hr_false_empty_state');
        for (const navId of ['today', 'schedule', 'reports']) {
            await page.locator(`.hr-pulse-card[data-nav-id="${navId}"]`).click();
        }
        report.routes.hr = { ok: true, pulseCards: 3, falseEmptyState: false };

        await goto(page, base, '/staff', 'qa_staff_open_failed');
        await expectVisible(page, '[data-staff-schedule-shell="standalone"]', 'qa_staff_shell_missing');
        await waitFor(page, () => typeof window.canUseAction === 'function', 'qa_staff_capability_bootstrap_failed');
        const staffCapabilities = await page.evaluate(() => ({
            scheduleView: window.canUseAction('hr.schedule.view'),
            scheduleManage: window.canUseAction('hr.schedule.manage'),
            staffView: window.canUseAction('hr.staff.view'),
            staffManage: window.canUseAction('hr.staff.manage')
        }));
        assert(Object.values(staffCapabilities).every(Boolean), 'qa_staff_capability_mismatch');
        report.routes.staff = { ok: true, capabilities: staffCapabilities };

        await goto(page, base, '/training', 'qa_training_open_failed');
        await expectVisible(page, 'button.training-tab[data-tab="onboarding"]', 'qa_training_onboarding_tab_missing');
        await page.locator('button.training-tab[data-tab="onboarding"]').click();
        await expectVisible(page, '#trainingOnboardingList', 'qa_training_onboarding_missing');
        await waitFor(page, () => typeof window.canUseAction === 'function' && window.canUseAction('manage_staff'), 'qa_training_capability_mismatch');
        await expectVisible(page, '#trainingStartOnboarding:not(.hidden)', 'qa_training_management_control_missing');
        report.routes.training = { ok: true, manageStaff: true };

        await goto(page, base, '/finance', 'qa_finance_open_failed');
        await expectVisible(page, '#addTransactionBtn', 'qa_finance_management_control_missing');
        await expectVisible(page, '#addExpenseBtn', 'qa_finance_expense_control_missing');
        const financeAllowed = await page.evaluate(() => typeof window.canUseAction === 'function' && window.canUseAction('finance.manage'));
        assert(financeAllowed, 'qa_finance_capability_mismatch');
        report.routes.finance = { ok: true, managementControls: true };

        await goto(page, base, '/checkin', 'qa_checkin_open_failed');
        await waitFor(page, () => {
            const status = document.getElementById('statusMsg');
            return status && !status.classList.contains('loading');
        }, 'qa_checkin_loading_timeout', 50_000);
        const checkin = await page.evaluate(() => ({
            isError: document.getElementById('statusMsg')?.classList.contains('error'),
            retryVisible: document.getElementById('statusActions')?.hidden === false,
            cameraCalls: window.__eventGenixLiveQaCameraCalls || 0
        }));
        assert(checkin.isError && checkin.retryVisible && checkin.cameraCalls === 1, 'qa_checkin_camera_denial_failed');
        report.routes.checkin = { ok: true, modelExitedLoading: true, cameraDenied: true };
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
    if (browserMutations.length) report.blockedBrowserRequests = browserMutations;
    const unexpectedBrowserMutations = browserMutations.filter(request => !KNOWN_AUTOMATIC_BLOCKED_PATHS.has(request.path));
    assert(unexpectedBrowserMutations.length === 0, 'qa_browser_mutation_blocked');
    report.permissionLifecycle = { permissionsResponses: permissionResponses.filter(status => status === 200).length, ready: true };
    report.console = consoleState;
    assert(consoleState.cspErrors === 0, 'qa_csp_error');
    report.businessMutations = 0;
}

async function main() {
    const config = loadQaConfig();
    const base = normalizeProductionBase(process.argv[2] || config.LIVE_SMOKE_URL);
    const report = {
        ok: false,
        target: base,
        routes: Object.create(null),
        businessMutations: 0,
        temporaryCreator: { applied: false, restored: false }
    };
    let qaUser;
    let originalRole;
    let originalFinanceAccess;
    let elevationApplied = false;
    let primaryFailure = null;
    try {
        const version = await fetchJson(base, '/api/version');
        report.release = {
            version: typeof version.version === 'string' ? version.version : null,
            commitSha: typeof version.commitSha === 'string' ? version.commitSha : null,
            sourceBranch: typeof version.sourceBranch === 'string' ? version.sourceBranch : null
        };
        assert(report.release.version && report.release.commitSha && report.release.sourceBranch, 'qa_release_metadata_invalid');
        const creatorToken = await login(base, config.LIVE_CREATOR_USER, config.LIVE_CREATOR_PASS);
        const creatorPermissions = await readPermissions(base, creatorToken);
        assert(capabilityAllowed(creatorPermissions, 'action', 'manage_accounts'), 'qa_creator_account_access_missing');
        const qaToken = await login(base, config.LIVE_SMOKE_USER, config.LIVE_SMOKE_PASS);
        qaUser = await verifyUser(base, qaToken);
        originalFinanceAccess = capabilityAllowed(await readPermissions(base, qaToken), 'page', '/finance');
        originalRole = qaUser.role;
        assert(qaUser.role !== 'creator', 'qa_account_already_creator');
        assert(QA_ROLE_MARKER.test(`${qaUser.username || ''} ${qaUser.name || ''}`), 'qa_account_marker_missing');
        await setQaRole(base, creatorToken, qaUser.id, 'creator');
        elevationApplied = true;
        report.temporaryCreator.applied = true;
        await runBrowserChecks(base, config, report);
    } catch (error) {
        primaryFailure = error instanceof QaError ? error : new QaError('qa_unexpected_failure');
    } finally {
        if (elevationApplied && qaUser && originalRole) {
            try {
                const creatorToken = await login(base, config.LIVE_CREATOR_USER, config.LIVE_CREATOR_PASS);
                await setQaRole(base, creatorToken, qaUser.id, originalRole);
                const restoredToken = await login(base, config.LIVE_SMOKE_USER, config.LIVE_SMOKE_PASS);
                const restoredUser = await verifyUser(base, restoredToken);
                const restoredPermissions = await readPermissions(base, restoredToken);
                assert(restoredUser.role === originalRole, 'qa_role_restore_verification_failed');
                assert(capabilityAllowed(restoredPermissions, 'page', '/finance') === originalFinanceAccess, 'qa_role_restore_capability_failed');
                report.temporaryCreator.restored = true;
                report.finalQaRole = restoredUser.role;
            } catch (error) {
                report.temporaryCreator.restored = false;
                primaryFailure = new QaError(error?.code || 'qa_role_restore_failed');
            }
        }
    }
    report.ok = !primaryFailure && report.temporaryCreator.restored;
    report.failure = primaryFailure ? primaryFailure.code : null;
    console.log(JSON.stringify(report));
    if (primaryFailure) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(() => {
        console.log(JSON.stringify({ ok: false, failure: 'qa_runner_fatal' }));
        process.exitCode = 1;
    });
}

module.exports = {
    SAFE_BROWSER_METHODS,
    SAFE_BROWSER_POST_PATHS,
    browserRequestIsAllowed,
    parseRetryAfter,
    parseSecretAssignments,
    safeRequestPath
};
