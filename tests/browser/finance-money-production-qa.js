'use strict';

// Explicit operator-run production QA. It neither creates access leases nor
// changes fiscal/provider settings. The server-issued run owns every fixture.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseSecretAssignments } = require('../../scripts/live-authenticated-surface-qa');

const ROOT = path.resolve(__dirname, '../..');
const ORIGIN = 'https://8223324090-production.up.railway.app';
const BASE = '/api/finance/manual-money';
const CONFIRM = 'EXECUTE_EXACT_FINANCE_QA_RUN';
const SAFE_AUTH = new Set(['/api/auth/login', '/api/auth/refresh']);
const SAFE_API_READS = new Set(['/api/auth/verify', '/api/auth/permissions', '/api/auth/business-profile',
    '/api/version', '/api/finance/dashboard', '/api/finance/transactions',
    '/api/finance/shift/current', '/api/finance/shift/history']);
const QA_READS = new Set([BASE, '/api/finance/accounts', '/api/finance/categories']);
const QA_CREATES = new Set(['/api/finance/accounts', '/api/finance/categories']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function check(condition, code) { if (!condition) throw Object.assign(new Error(code), { code }); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function externalFile(file) {
    check(path.isAbsolute(file || ''), 'finance_qa_absolute_file_required');
    const resolved = fs.realpathSync(file);
    const relative = path.relative(ROOT, resolved);
    check(relative && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'finance_qa_private_file_inside_repository');
    return resolved;
}
function validatePlan(plan) {
    check(plan && typeof plan === 'object' && !Array.isArray(plan), 'finance_qa_plan_invalid');
    check(typeof plan.runId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(plan.runId), 'finance_qa_run_invalid');
    check(Number.isSafeInteger(plan.testAccountId) && plan.testAccountId > 0, 'finance_qa_actor_invalid');
    check(plan.businessContext === 'event_genix', 'finance_qa_business_invalid');
    check(Number.isInteger(plan.ttlMinutes) && plan.ttlMinutes >= 1 && plan.ttlMinutes <= 30, 'finance_qa_ttl_invalid');
    check(Array.isArray(plan.accountTypes) && plan.accountTypes.length === 3 && plan.accountTypes[0] === 'cash' && plan.accountTypes[1] === 'cash' && ['bank', 'card'].includes(plan.accountTypes[2]), 'finance_qa_account_plan_invalid');
    check(JSON.stringify(plan.categoryTypes) === JSON.stringify(['income', 'expense']), 'finance_qa_category_plan_invalid');
    check(Number.isInteger(plan.maxOperations) && plan.maxOperations >= 15 && plan.maxOperations <= 40, 'finance_qa_operation_cap_invalid');
    for (const field of ['maxAmountMinor', 'maxPositiveMinor']) check(/^\d+$/.test(String(plan[field])), 'finance_qa_amount_cap_invalid');
    // Closing a till records its actual balance, which may include the partial
    // receipt above the opening 1000 UAH. Reserve that cap before any write.
    check(BigInt(plan.maxAmountMinor) >= 110000n && BigInt(plan.maxAmountMinor) <= 1000000n, 'finance_qa_amount_cap_invalid');
    check(BigInt(plan.maxPositiveMinor) >= 150000n && BigInt(plan.maxPositiveMinor) <= 3000000n, 'finance_qa_positive_cap_invalid');
    check(BigInt(plan.maxPositiveMinor) >= BigInt(plan.maxAmountMinor), 'finance_qa_positive_cap_invalid');
    check(Array.isArray(plan.bookingFixtures) && plan.bookingFixtures.length >= 1 && plan.bookingFixtures.length <= 2, 'finance_qa_booking_fixture_required');
    const keys = new Set(['requestId', 'programId', 'productId', 'lineId', 'secondAnimatorLineId', 'secondAnimator', 'roomResourceId', 'room', 'date', 'time', 'duration', 'programCode', 'programName', 'label', 'category', 'hosts', 'status', 'pinataMode', 'pinataNumber']);
    for (const fixture of plan.bookingFixtures) {
        check(fixture && Object.keys(fixture).every(key => keys.has(key)), 'finance_qa_booking_fixture_fields');
        check(typeof fixture.requestId === 'string' && fixture.requestId.length > 0 && fixture.requestId.length <= 160, 'finance_qa_booking_request_id');
        for (const key of ['programId', 'lineId', 'roomResourceId', 'room', 'date', 'time']) check(typeof fixture[key] === 'string' && fixture[key], 'finance_qa_booking_fixture_incomplete');
        check(Number.isInteger(fixture.duration) && fixture.duration > 0 && fixture.duration <= 1440, 'finance_qa_booking_duration');
        check((!fixture.productId || fixture.productId === fixture.programId)
            && (!fixture.status || fixture.status === 'confirmed') && (!fixture.hosts || fixture.hosts === 1)
            && !fixture.secondAnimatorLineId && !fixture.secondAnimator && !fixture.pinataNumber
            && (!fixture.pinataMode || fixture.pinataMode === 'none')
            && !/banquet|kitchen|certificate|банкет|кух/i.test([fixture.category, fixture.programName, fixture.programCode, fixture.label, fixture.lineId].join(' ')),
        'finance_qa_booking_scope_invalid');
    }
    check(new Set(plan.bookingFixtures.map(row => row.requestId)).size === plan.bookingFixtures.length, 'finance_qa_booking_duplicate_request');
    return plan;
}
function publicQaContext(qa, plan) {
    check(qa && qa.runId === plan.runId && Number(qa.actorId) === plan.testAccountId && qa.businessContext === plan.businessContext, 'finance_qa_workspace_scope_mismatch');
    check(Date.parse(qa.expiresAt) > Date.now(), 'finance_qa_run_expired');
    return { runId: qa.runId, actorId: Number(qa.actorId), businessContext: qa.businessContext, expiresAt: qa.expiresAt };
}
function bookingPayload(fixture, businessContext) {
    const { requestId, ...body } = fixture;
    return { ...body, businessContext };
}
function decimal(minor) {
    const amount = BigInt(minor);
    check(amount >= 0n, 'finance_qa_negative_input');
    return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
}

// No global header injection: even provider reads and same-origin unrelated
// writes are blocked. A QA token is attached only to the enumerated paths.
function createRequestPolicy({ plan, token, expiresAt }) {
    const bookingIds = new Set();
    const issuedCreates = new Set();
    const commands = new Map();
    const issuedBookings = new Set();
    const report = { blockedWrites: 0, blockedReads: 0, suppressedDailyLogin: 0, commandRequests: 0, repeatedCommandRequests: 0 };
    function decide({ method, url, body = null, headers = {} }) {
        const target = new URL(url);
        const verb = String(method).toUpperCase();
        const pathname = target.pathname;
        const safeHeaders = { ...headers };
        for (const key of Object.keys(safeHeaders)) if (/^x-(?:qa-run|disposable-qa)/i.test(key)) delete safeHeaders[key];
        if (target.origin !== ORIGIN) return { allow: false, expected: true };
        if (pathname === '/api/payments' || pathname.startsWith('/api/payments/')) return { allow: false, code: 'finance_qa_fiscal_request_denied' };
        if (SAFE_AUTH.has(pathname) && verb === 'POST') return { allow: true, headers: safeHeaders };
        const isBookingRead = [...bookingIds].some(id => pathname === `${BASE}/bookings/${encodeURIComponent(id)}`);
        const qaRead = QA_READS.has(pathname) || isBookingRead;
        if (['GET', 'HEAD'].includes(verb)) {
            if (pathname.startsWith(`${BASE}/`) && !isBookingRead) return { allow: false, code: 'finance_qa_manual_read_denied' };
            if (!qaRead) {
                if (pathname.startsWith('/api/') && !SAFE_API_READS.has(pathname)) {
                    report.blockedReads++;
                    return { allow: false, expected: true };
                }
                return { allow: true, headers: safeHeaders };
            }
            if (!(Date.parse(expiresAt) > Date.now())) return { allow: false, code: 'finance_qa_run_expired' };
            return { allow: true, headers: { ...safeHeaders, 'X-QA-Run-Token': token } };
        }
        if (pathname.includes('/daily-login')) {
            report.suppressedDailyLogin++;
            return { allow: false, expected: true };
        }
        const reject = code => { report.blockedWrites++; return { allow: false, code }; };
        if (!(Date.parse(expiresAt) > Date.now())) return reject('finance_qa_run_expired');
        if (verb !== 'POST') return reject('finance_qa_method_denied');
        const requestedBusiness = target.searchParams.get('businessContext') || target.searchParams.get('business_context')
            || body?.businessContext || body?.business_context || safeHeaders['x-business-context'];
        if (requestedBusiness && requestedBusiness !== plan.businessContext) return reject('finance_qa_business_mismatch');
        let requestId;
        if (pathname === `${BASE}/commands`) {
            if (!body || !UUID.test(body.idempotencyKey)) return reject('finance_qa_command_identity_missing');
            const fingerprint = sha256(JSON.stringify(body));
            const previous = commands.get(body.idempotencyKey);
            if (previous && previous !== fingerprint) return reject('finance_qa_command_identity_changed');
            if (!previous && commands.size >= plan.maxOperations) return reject('finance_qa_command_limit');
            if (previous) report.repeatedCommandRequests++;
            commands.set(body.idempotencyKey, fingerprint);
            report.commandRequests++;
            requestId = body.idempotencyKey;
        } else if (QA_CREATES.has(pathname)) {
            const fingerprint = `${pathname}:${sha256(JSON.stringify(body))}`;
            // Creation endpoints lack money-command replay semantics. Never
            // silently repeat them after an unknown response.
            if (issuedCreates.has(fingerprint)) return reject('finance_qa_fixture_create_repeated');
            issuedCreates.add(fingerprint);
            requestId = crypto.randomUUID();
        } else if (pathname === '/api/bookings') {
            const fixture = plan.bookingFixtures.find(row => JSON.stringify(bookingPayload(row, plan.businessContext)) === JSON.stringify(body));
            if (!fixture || issuedBookings.has(fixture.requestId)) return reject('finance_qa_booking_not_planned');
            issuedBookings.add(fixture.requestId);
            requestId = fixture.requestId;
        } else return reject('finance_qa_endpoint_denied');
        return { allow: true, headers: { ...safeHeaders, 'X-QA-Run-Token': token, 'X-QA-Run-Request-Id': requestId } };
    }
    return { decide, report, bookingIds };
}

async function jsonFetch(route, { token, body, qaToken, requestId } = {}) {
    const response = await fetch(`${ORIGIN}${route}`, { method: body ? 'POST' : 'GET', redirect: 'error',
        signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(qaToken ? { 'X-QA-Run-Token': qaToken } : {}), ...(requestId ? { 'X-QA-Run-Request-Id': requestId } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    check(response.ok, 'finance_qa_http_request_failed');
    return response.json();
}
function playwright() {
    try { return require('playwright'); } catch (_) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
            if (!/node_modules[\\/]\.bin[\\/]?$/.test(entry)) continue;
            const candidate = path.join(path.dirname(entry.replace(/[\\/]$/, '')), 'playwright');
            if (fs.existsSync(candidate)) return require(candidate);
        }
    }
    throw Object.assign(new Error('finance_qa_playwright_missing'), { code: 'finance_qa_playwright_missing' });
}

async function run(options) {
    check(options.confirm === CONFIRM, 'finance_qa_confirmation_required');
    check(/^[a-f0-9]{40}$/i.test(options.expectedSha || ''), 'finance_qa_live_sha_required');
    const inMemory = Object.hasOwn(options, 'plan') || Object.hasOwn(options, 'qaToken');
    let plan;
    let token;
    if (inMemory) {
        check(options.plan && typeof options.qaToken === 'string' && !options.planFile
            && !options.tokenFile && !options.planFileSha256, 'finance_qa_input_sources_mixed');
        // Snapshot the operator's normalized plan before asynchronous checks.
        plan = validatePlan(JSON.parse(JSON.stringify(options.plan)));
        token = options.qaToken;
    } else {
        const planBytes = fs.readFileSync(externalFile(options.planFile));
        check(sha256(planBytes) === options.planFileSha256, 'finance_qa_plan_file_hash_mismatch');
        plan = validatePlan(JSON.parse(planBytes.toString('utf8').replace(/^\uFEFF/, '')));
        token = fs.readFileSync(externalFile(options.tokenFile), 'utf8').trim();
    }
    check(/^[a-f0-9]{64}$/.test(options.planHash || '') && sha256(JSON.stringify(plan)) === options.planHash,
        'finance_qa_plan_hash_mismatch');
    check(token.length >= 32 && token.length <= 300 && !/\s/.test(token), 'finance_qa_token_invalid');
    const credentials = parseSecretAssignments(fs.readFileSync(path.join(os.homedir(), '.eventgenix/codex-crm-secrets.ps1'), 'utf8'));
    check(credentials.LIVE_SMOKE_URL && new URL(credentials.LIVE_SMOKE_URL).origin === ORIGIN, 'finance_qa_secret_target_mismatch');
    check(credentials.LIVE_SMOKE_USER && credentials.LIVE_SMOKE_PASS, 'finance_qa_login_missing');
    const release = await jsonFetch('/api/version');
    check(release.commitSha === options.expectedSha && release.sourceBranch === 'codex/eventgenix-production', 'finance_qa_live_release_mismatch');
    const login = await jsonFetch('/api/auth/login', { body: { username: credentials.LIVE_SMOKE_USER, password: credentials.LIVE_SMOKE_PASS } });
    const authToken = login.accessToken || login.token;
    check(typeof authToken === 'string', 'finance_qa_login_failed');
    const verified = await jsonFetch('/api/auth/verify', { token: authToken });
    const user = verified.user || verified;
    check(Number(user.id) === plan.testAccountId && /qa|test|codex|smoke|verifier/i.test(`${user.username || ''} ${user.name || ''}`), 'finance_qa_actor_mismatch');
    const permissions = await jsonFetch('/api/auth/permissions', { token: authToken });
    check(permissions.capabilities?.['action:finance.manage'] === true, 'finance_qa_finance_access_missing');
    const workspace = await jsonFetch(`${BASE}?businessContext=${encodeURIComponent(plan.businessContext)}`, { token: authToken, qaToken: token });
    const qa = publicQaContext(workspace.qa, plan);
    check(workspace.available !== false && Array.isArray(workspace.accounts) && workspace.accounts.length === 0
        && Number(workspace.qa.counts?.operations) === 0, 'finance_qa_run_not_pristine');
    const policy = createRequestPolicy({ plan, token, expiresAt: qa.expiresAt });
    const output = path.resolve(options.outputDirectory || path.join(ROOT, 'output/playwright/finance-money-production', plan.runId));
    fs.mkdirSync(output, { recursive: true });
    const report = { ok: false, runId: plan.runId, release: { version: release.version, commitSha: release.commitSha },
        scenarios: [], browserErrors: 0, screenshots: [], cleanupRequired: true };
    let browser;
    try {
        browser = await playwright().chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
        check(typeof context.routeWebSocket === 'function', 'finance_qa_websocket_guard_required');
        await context.routeWebSocket('**/*', socket => socket.close());
        let loseExpenseResponse = true;
        let lostCommand;
        let routeFailure = false;
        await context.route('**/*', async route => {
            try {
                const request = route.request();
                let body = null;
                try { body = request.postDataJSON(); } catch (_) {}
                const decision = policy.decide({ method: request.method(), url: request.url(), body, headers: request.headers() });
                if (!decision.allow) return await route.abort('blockedbyclient');
                if (loseExpenseResponse && new URL(request.url()).pathname === `${BASE}/commands` && body?.command === 'expense') {
                    loseExpenseResponse = false;
                    const response = await route.fetch({ headers: decision.headers, maxRedirects: 0, timeout: 20000 });
                    check(response.ok() && (await response.json()).success === true, 'finance_qa_lost_response_not_committed');
                    lostCommand = body;
                    return await route.abort('failed');
                }
                return await route.continue({ headers: decision.headers });
            } catch (_) {
                routeFailure = true;
                await route.abort('failed').catch(() => {});
            }
        });
        await context.addInitScript(value => {
            window.FINANCE_QA_CONTEXT = value;
            window.__eventGenixLiveQaReadOnly = true; // Suppress unrelated automatic daily-login reward.
        }, qa);
        const page = await context.newPage();
        page.on('pageerror', () => { report.browserErrors++; });
        page.setDefaultTimeout(20000);
        await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
        await page.locator('#username').fill(credentials.LIVE_SMOKE_USER);
        await page.locator('#password').fill(credentials.LIVE_SMOKE_PASS);
        await page.locator('#loginForm button[type="submit"]').click();
        await page.waitForFunction(() => Boolean(window.AppState?.currentUser));
        check(await page.evaluate(actor => Number(window.AppState.currentUser.id) === actor, plan.testAccountId), 'finance_qa_browser_actor_mismatch');
        await page.goto(`${ORIGIN}/finance?businessContext=${plan.businessContext}&tab=shift`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-finance-group="cash"]').click();
        await page.locator('.fin-tab[data-tab="shift"]').click();
        await page.locator('#fmCreateAccount').waitFor({ state: 'visible' });

        async function workspaceNow() {
            const data = await page.evaluate(async ({ base, business }) => {
                const response = await apiFetchWithAuthRetry(`${base}?businessContext=${encodeURIComponent(business)}`, { headers: getAuthHeaders(false) });
                if (!response.ok) return null;
                return response.json();
            }, { base: BASE, business: plan.businessContext });
            check(data, 'finance_qa_workspace_unavailable'); publicQaContext(data.qa, plan); return data;
        }
        async function submit() {
            const pendingResponse = page.waitForResponse(response => new URL(response.url()).pathname === `${BASE}/commands` && response.request().method() === 'POST');
            await page.locator('#fmSubmit').click();
            const response = await pendingResponse;
            check(response.ok(), 'finance_qa_command_rejected');
            const result = await response.json(); check(result.success === true, 'finance_qa_command_unconfirmed');
            await page.waitForFunction(() => !document.querySelector('#fmSubmit').disabled && /підтверджено|Дубль не створено/.test(document.querySelector('#fmCommandStatus').textContent));
            return result;
        }
        async function action(command, values = {}) {
            await page.locator('#fmAction').selectOption(command);
            for (const [id, value] of Object.entries(values)) await page.locator(`#${id}`).fill(String(value));
        }
        async function select(id) { await page.locator('#fmAccount').selectOption(String(id)); }
        async function createAccount(index) {
            const before = new Set((await workspaceNow()).accounts.map(row => String(row.id)));
            await page.locator('#fmCreateAccount').click();
            await page.locator('#accName').fill(`QA account ${index + 1}`);
            await page.locator('#accEmoji').selectOption('💼');
            await page.locator('#accType').selectOption(plan.accountTypes[index]);
            await page.locator('#addAccountModal button', { hasText: 'Зберегти' }).click();
            await page.locator('#addAccountModal').waitFor({ state: 'hidden' });
            const rows = (await workspaceNow()).accounts.filter(row => !before.has(String(row.id)));
            check(rows.length === 1, 'finance_qa_account_create_ambiguous');
            await page.waitForFunction(id => Array.from(document.querySelector('#fmAccount').options).some(option => option.value === id), String(rows[0].id));
            await select(rows[0].id); return rows[0].id;
        }
        async function createCategory(type) {
            await page.locator('#fmCreateCategory').click();
            check(await page.locator('#financeCategoryType').inputValue() === type, 'finance_qa_category_type_mismatch');
            await page.locator('#financeCategoryName').fill(`QA ${type}`);
            await page.locator('#saveFinanceCategoryBtn').click();
            await page.locator('#financeCategoryModal').waitFor({ state: 'hidden' });
            check(await page.locator('#fmCategory').inputValue(), 'finance_qa_created_category_not_selected');
        }
        const first = await createAccount(0);
        await action('enroll', { fmAmount: '1000.00', fmReason: 'QA counted opening' }); await submit();
        await action('open_shift'); await submit();
        const second = await createAccount(1);
        await action('enroll', { fmAmount: '0', fmReason: 'QA empty opening' }); await submit();
        await action('open_shift'); await submit();
        await createAccount(2);
        await select(first);
        await action('expense', { fmAmount: '1.01', fmDescription: 'QA expense' });
        await createCategory('expense');
        check(await page.locator('#fmAmount').inputValue() === '1.01', 'finance_qa_inline_draft_lost');
        await page.locator('#fmSubmit').click();
        await page.locator('#fmRetry').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.querySelector('#fmRetryError').textContent.includes('невідомий'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('#fmRetry').waitFor({ state: 'visible' });
        const replayResponse = page.waitForResponse(response => new URL(response.url()).pathname === `${BASE}/commands`);
        await page.locator('#fmRetry').click();
        const replay = await replayResponse;
        assert.deepEqual(replay.request().postDataJSON(), lostCommand, 'finance_qa_replay_payload_changed');
        check(replay.ok() && (await replay.json()).replayed === true, 'finance_qa_replay_not_confirmed');
        await page.locator('#fmPendingBox').waitFor({ state: 'hidden' });
        check((await workspaceNow()).operations.filter(row => row.command === 'expense').length === 1, 'finance_qa_duplicate_expense');
        report.scenarios.push('inline_category_draft', 'lost_response_reload_same_command');
        await select(first);
        await action('income', { fmAmount: '2.02', fmDescription: 'QA income' }); await createCategory('income');
        const income = await submit();

        // Fixture creation uses the existing booking route and the exact server
        // manifest body. No direct DB, invented price or customer is used.
        const bookingIds = [];
        for (const fixture of plan.bookingFixtures) {
            const result = await page.evaluate(async body => {
                const response = await apiFetchWithAuthRetry('/api/bookings', { method: 'POST', headers: getAuthHeaders(true), body: JSON.stringify(body) });
                if (!response.ok) return null;
                return response.json();
            }, bookingPayload(fixture, plan.businessContext));
            const id = result?.booking?.id || result?.id;
            check(typeof id === 'string' && id.length > 0, 'finance_qa_booking_create_failed');
            policy.bookingIds.add(id); bookingIds.push(id);
        }
        async function receipt(accountId, amount) {
            await select(accountId);
            await action('booking_receipt', { fmBookingRef: bookingIds[0], fmAmount: decimal(amount) });
            await page.locator('#fmFindBooking').click();
            await page.waitForFunction(() => document.querySelector('#fmBookingSummary').textContent.includes('Залишок до сплати:'));
            return submit();
        }
        const summary = await page.evaluate(async id => {
            const response = await apiFetchWithAuthRetry(`/api/finance/manual-money/bookings/${encodeURIComponent(id)}`, { headers: getAuthHeaders(false) });
            if (!response.ok) return null;
            const data = await response.json(); return data.booking || data.bookingSummary || data;
        }, bookingIds[0]);
        check(summary?.eligible && /^\d+$/.test(String(summary.remainingMinor)), 'finance_qa_booking_not_eligible');
        const remaining = BigInt(summary.remainingMinor);
        check(remaining >= 6n, 'finance_qa_booking_amount_too_small');
        const part = remaining / 3n < 10000n ? remaining / 3n : 10000n;
        const receiptOne = await receipt(first, part);
        const receiptTwo = await receipt(second, part);
        check(BigInt(receiptTwo.bookingSummary.remainingMinor) === remaining - 2n * part, 'finance_qa_booking_remaining_mismatch');
        await select(first);
        await action('transfer', { fmAmount: '3.00', fmReason: 'QA transfer' });
        await page.locator('#fmToAccount').selectOption(String(second)); await submit();
        await action('refund', { fmAmount: decimal(part / 2n), fmReason: 'QA partial refund' });
        await page.locator('#fmOriginal').selectOption(receiptOne.operationId); await submit();
        await action('reverse', { fmReason: 'QA reverse income' });
        await page.locator('#fmOriginal').selectOption(income.operationId); await submit();
        report.scenarios.push('two_tills', 'partial_booking_receipts', 'transfer', 'refund', 'reverse');

        async function close(accountId) {
            await select(accountId);
            const account = (await workspaceNow()).accounts.find(row => String(row.id) === String(accountId));
            check(account?.openShift && /^\d+$/.test(String(account.balanceMinor)), 'finance_qa_close_balance_missing');
            await action('close_shift', { fmAmount: decimal(account.balanceMinor), fmReason: 'QA exact counted close' }); await submit();
        }
        await close(first); await action('open_shift'); await submit(); await close(first); await close(second);
        report.scenarios.push('close_reopen_preserves_balance');
        await select(first);
        for (const theme of ['dark', 'light']) {
            await page.evaluate(value => {
                localStorage.setItem('pzp_dark_mode', String(value === 'dark'));
                document.documentElement.setAttribute('data-theme', value);
                document.documentElement.style.colorScheme = value;
                document.body.classList.toggle('dark-mode', value === 'dark');
            }, theme);
            for (const width of [1440, 390]) {
                await page.setViewportSize({ width, height: 1000 });
                const file = `${theme}-${width}.png`;
                await page.locator('#financeMoneyWorkspace').screenshot({ path: path.join(output, file) });
                const fits = await page.locator('#financeMoneyWorkspace').evaluate(element => element.scrollWidth <= element.clientWidth + 1);
                check(fits, 'finance_qa_mobile_overflow'); report.screenshots.push(file);
            }
        }
        const final = await workspaceNow();
        check(final.accounts.length === 3 && final.accounts.every(row => !row.openShift), 'finance_qa_open_shift_remaining');
        check(!routeFailure && report.browserErrors === 0 && policy.report.blockedWrites === 0, 'finance_qa_browser_unexpected_request_or_error');
        report.counts = { accounts: final.accounts.length, operations: final.qa.counts.operations };
        report.ok = true;
    } catch (error) {
        report.failure = /^finance_qa_[a-z_]+$/.test(error.code || '') ? error.code : 'finance_qa_browser_failed';
    } finally {
        await browser?.close();
        report.requests = policy.report;
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    }
    return report;
}

function cli(argv) {
    const values = {};
    const names = { '--plan-file': 'planFile', '--plan-file-sha256': 'planFileSha256', '--plan-hash': 'planHash', '--token-file': 'tokenFile', '--expected-sha': 'expectedSha', '--confirm': 'confirm', '--output-directory': 'outputDirectory' };
    for (let index = 0; index < argv.length; index += 2) {
        check(names[argv[index]] && argv[index + 1] && !argv[index + 1].startsWith('--'), 'finance_qa_argument_invalid');
        values[names[argv[index]]] = argv[index + 1];
    }
    return values;
}
if (require.main === module) run(cli(process.argv.slice(2))).then(report => {
    console.log(JSON.stringify(report)); if (!report.ok) process.exitCode = 1;
}).catch(error => {
    console.log(JSON.stringify({ ok: false, failure: /^finance_qa_[a-z_]+$/.test(error.code || '') ? error.code : 'finance_qa_preflight_failed' }));
    process.exitCode = 1;
});
module.exports = { ORIGIN, BASE, CONFIRM, validatePlan, publicQaContext, bookingPayload, decimal, createRequestPolicy, sha256, cli, run };
