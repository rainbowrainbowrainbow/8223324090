'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The caller creates and verifies the disposable database and actual server.js.
// This runner never creates API responses, seeds a browser principal, or prints credentials.
async function runBrowserAcceptance({ baseUrl, fixture, outputDir, playwrightModule, executablePath, record = () => {} }) {
    const target = new URL(baseUrl);
    assert.equal(target.protocol, 'http:');
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'Browser acceptance requires loopback HTTP');
    assert.ok(fixture?.runId && fixture?.actors?.owner && fixture?.organizations?.primaryId, 'Disposable fixture is required');
    const output = path.resolve(outputDir || path.join(__dirname, '../../output/playwright/sys-mb-d06'));
    fs.mkdirSync(output, { recursive: true });
    const playwright = typeof playwrightModule === 'string' ? require(playwrightModule) : playwrightModule || require('playwright');
    const browser = await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const entries = [];
    const sessions = [];
    const network = [];
    const consoleErrors = [];
    const pageErrors = [];
    const blockedExternal = [];
    const denialBodyReads = [];
    let phase = 'setup';
    let ownerSession;
    let createdBusiness;
    let evidencePage;
    let memberOpenSequence = 0;
    const sensitive = Object.values(fixture.actors).flatMap(actor => [actor.password, actor.token]).filter(Boolean);
    const redact = input => {
        let value = String(input || '');
        for (const secret of sensitive) value = value.split(secret).join('[REDACTED]');
        return value.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
            .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]');
    };
    function emit(entry) {
        const safe = JSON.parse(redact(JSON.stringify({ domain: 'browser', ...entry })));
        entries.push(safe);
        record(safe);
        fs.writeFileSync(path.join(output, 'browser-progress.json'), redact(JSON.stringify({ phase, entries,
            actualAppApiResponses: network.length, pageErrors, consoleErrors }, null, 2)) + '\n');
    }
    async function screenshot(page, name, fullPage = true) {
        if (!page || page.isClosed()) return null;
        evidencePage = page;
        const destination = path.join(output, name.replace(/[^a-zA-Z0-9_-]/g, '-') + '.png');
        try {
            await page.screenshot({ path: destination, fullPage, timeout: 30000 });
        } catch (error) {
            // Very tall profile/dashboard pages can keep changing while widgets
            // settle. Evidence capture must not turn an accepted interaction into
            // a product failure, so retain a bounded viewport proof instead.
            if (!fullPage || !/Timeout/i.test(String(error?.message || ''))) throw error;
            await page.screenshot({ path: destination, fullPage: false, timeout: 30000 });
        }
        return destination;
    }
    async function scenario(id, expected, action) {
        phase = id;
        try {
            const result = await action();
            emit({ id, status: 'PASS', expected, observed: result?.observed || 'Actual browser scenario completed', evidence: result?.evidence || [] });
        } catch (error) {
            const page = evidencePage;
            const evidence = await screenshot(page, id + '-failure').catch(() => null);
            const transportUnavailable = network.length === 0 && /ERR_CONNECTION_REFUSED|ECONNREFUSED|ERR_ADDRESS_UNREACHABLE|ENETUNREACH/.test(error.message);
            emit({ id, status: error.notTestable || transportUnavailable ? 'NOT_TESTABLE' : 'FAIL', expected,
                observed: (transportUnavailable ? 'HARNESS_TRANSPORT_UNAVAILABLE: ' : '') + redact(error.message), evidence: evidence ? [evidence] : [] });
        }
    }
    function prerequisite(value, message) {
        if (!value) throw Object.assign(new Error(message), { notTestable: true });
    }
    function trackPage(page) {
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(30000);
        page.on('pageerror', error => pageErrors.push({ phase, message: redact(error.message), path: new URL(page.url()).pathname }));
        page.on('console', message => {
            if (message.type() === 'error') consoleErrors.push({ phase, message: redact(message.text()), location: redact(message.location().url) });
        });
    }
    async function newSession(actor, name) {
        prerequisite(actor?.username && actor?.password, `Missing synthetic ${name} account`);
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'uk-UA', serviceWorkers: 'block' });
        context.on('page', trackPage);
        context.on('response', response => {
            const url = new URL(response.url());
            if (url.origin === target.origin && url.pathname.startsWith('/api/')) {
                const entry = {
                    phase, actor: name, path: url.pathname, method: response.request().method(), status: response.status(),
                    context: url.searchParams.get('businessContext') || response.request().headers()['x-business-context'] || null
                };
                network.push(entry);
                if (entry.path === '/api/chat/unread' && entry.method === 'GET' && entry.status === 403) {
                    denialBodyReads.push(response.json().then(body => {
                        entry.denialCode = typeof body?.code === 'string' && /^[a-z_]{1,80}$/.test(body.code) ? body.code : null;
                    }).catch(() => { entry.denialCodeUnavailable = true; }));
                }
            }
        });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin === target.origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
            blockedExternal.push({ phase, host: url.hostname, path: url.pathname, type: route.request().resourceType() });
            return route.abort('blockedbyclient');
        });
        const session = { context, actor, name, page: await context.newPage() };
        sessions.push(session);
        evidencePage = session.page;
        await session.page.goto(target.origin + '/', { waitUntil: 'domcontentloaded' });
        await session.page.locator('#username').waitFor({ state: 'visible' });
        await session.page.locator('#username').fill(actor.username);
        await session.page.locator('#password').fill(actor.password);
        await session.page.locator('#loginForm button[type="submit"]').focus();
        const [login] = await Promise.all([
            session.page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST'),
            session.page.keyboard.press('Enter')
        ]);
        assert.equal(login.status(), 200, `${name}: actual login must succeed`);
        await session.page.waitForFunction(id => {
            const user = window.AppState?.currentUser;
            if (Number(user?.id) !== Number(id) || document.querySelector('#loginForm[aria-busy="true"]')) return false;
            const selection = document.querySelector('#businessAccessSelection');
            if (user.accessContext?.status === 'selection_required' && selection?.getClientRects().length) return true;
            return user.accessContext?.status === 'ready' && window.isAuthenticatedRuntimeReady?.()
                && document.body.classList.contains('shell-ready') && typeof getPermissionLifecycle === 'function'
                && getPermissionLifecycle()?.status === 'ready';
        }, actor.id);
        const completedLogin = await session.page.evaluate(() => ({
            path: location.pathname + location.search,
            userId: window.AppState.currentUser.id,
            context: window.AppState.currentUser.activeBusinessContext,
            accessStatus: window.AppState.currentUser.accessContext?.status,
            runtimeReady: Boolean(window.isAuthenticatedRuntimeReady?.()),
            shellReady: document.body.classList.contains('shell-ready'),
            loginBusy: Boolean(document.querySelector('#loginForm[aria-busy="true"]'))
        }));
        fs.writeFileSync(path.join(output, `login-${name}-completion.json`), redact(JSON.stringify(completedLogin, null, 2)) + '\n');
        return session;
    }
    async function goProfile(session, context = 'event_genix') {
        evidencePage = session.page;
        await session.page.goto(target.origin + `/profile?tab=settings&businessContext=${encodeURIComponent(context)}`, { waitUntil: 'domcontentloaded' });
        await session.page.locator('#profileBusinessCabinets').waitFor({ state: 'attached' });
    }
    async function loadCabinets(page) {
        await page.locator('[data-cabinet-action="load"]').click();
        await page.locator('[data-cabinet-organization]').waitFor({ state: 'visible' });
        await page.locator('[data-cabinet-organization]').selectOption(String(fixture.organizations.primaryId));
    }
    async function ownerApi(method, route, body) {
        const response = await fetch(target.origin + route, { method,
            headers: { Authorization: 'Bearer ' + fixture.actors.owner.token, 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const payload = await response.json();
        assert.ok(response.ok, `${method} ${route}: ${response.status} ${payload.code || payload.error || ''}`);
        return payload;
    }
    async function openMember(page, actorId, businessId) {
        evidencePage = page;
        const attempt = ++memberOpenSequence;
        const startedAt = network.length;
        await page.evaluate(() => {
            const state = () => {
                const button = document.querySelector('[data-members-add]');
                const user = window.AppState?.currentUser;
                const box = button?.getBoundingClientRect();
                const hit = box ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
                return { userId: user?.id, context: user?.activeBusinessContext, accessStatus: user?.accessContext?.status,
                    permissionStatus: typeof getPermissionLifecycle === 'function' ? getPermissionLifecycle()?.status : null,
                    shellReady: document.body.classList.contains('shell-ready'),
                    runtimeReady: Boolean(window.isAuthenticatedRuntimeReady?.()),
                    mounted: typeof document.querySelector('#profileBusinessMembers')?.__businessMembershipCleanup === 'function',
                    disabled: button?.disabled, input: document.querySelector('[data-members-account-id]')?.value,
                    status: document.querySelector('[data-members-status]')?.textContent,
                    buttonRect: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
                    hit: hit ? { tag: hit.tagName, id: hit.id, memberAdd: hit.hasAttribute('data-members-add') } : null };
            };
            const observation = { before: state(), events: [], state };
            const listener = event => {
                if (!(event.target instanceof Element)) return;
                observation.events.push({ type: event.type, trusted: event.isTrusted,
                    tag: event.target.tagName, id: event.target.id, insideMembers: Boolean(event.target.closest('#profileBusinessMembers')),
                    point: { x: event.clientX, y: event.clientY }, memberAdd: event.target.hasAttribute('data-members-add'), ...state() });
            };
            for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, listener, true);
            observation.cleanup = () => {
                for (const type of ['pointerdown', 'pointerup', 'click']) document.removeEventListener(type, listener, true);
            };
            window.__d06MemberOpenObservation = observation;
        });
        try {
            await page.locator('[data-members-account-id]').fill(String(actorId));
            await page.locator('[data-members-add]').click();
            await page.locator('#accountAccessEditorRoot [role="dialog"]').waitFor({ state: 'visible' });
            await page.locator('[data-access-scope]').selectOption(`business:${fixture.organizations.primaryId}:${businessId}`);
        } finally {
            const observation = await page.evaluate(() => {
                const observation = window.__d06MemberOpenObservation;
                if (!observation) return null;
                const result = { before: observation.before, events: observation.events, after: observation.state() };
                observation.cleanup();
                delete window.__d06MemberOpenObservation;
                return result;
            }).catch(() => null);
            fs.writeFileSync(path.join(output, `membership-open-${attempt}-diagnostics.json`), redact(JSON.stringify({ phase, actorId, businessId,
                observation, requests: network.slice(startedAt).filter(item => item.path.startsWith('/api/organizations/') || item.path.startsWith('/api/auth/')) }, null, 2)) + '\n');
        }
    }
    async function saveMember(page) {
        await page.locator('[data-action="save"]').focus();
        await page.keyboard.press('Enter');
        await page.locator('#accountAccessEditorRoot').waitFor({ state: 'detached' });
        assert.equal(await page.locator('[data-members-add]').evaluate(element => element === document.activeElement), true, 'Editor restores opener focus');
    }
    async function switchBusiness(page, businessContext) {
        evidencePage = page;
        const select = page.locator('#sidebarBusinessContextSelect');
        // The shared sidebar may be collapsed on narrow screens; desktop tests use its real control.
        await select.selectOption(businessContext);
        await page.waitForFunction(context => window.CrmBusinessContext?.current?.() === context
            && window.AppState?.currentUser?.activeBusinessContext === context
            && document.querySelector('#sidebarBusinessContextSelect')?.value === context, businessContext);
    }
    async function setTheme(page, dark) {
        const toggle = page.locator('#headerThemeToggle');
        await toggle.waitFor({ state: 'visible' });
        const current = await page.locator('body').evaluate(element => element.classList.contains('dark-mode'));
        if (current !== dark) await toggle.click();
        assert.equal(await page.locator('body').evaluate(element => element.classList.contains('dark-mode')), dark);
    }
    async function reachable(locator) {
        await locator.scrollIntoViewIfNeeded();
        assert.equal(await locator.isVisible(), true);
        assert.equal(await locator.evaluate(element => {
            const box = element.getBoundingClientRect();
            const x = Math.max(0, Math.min(innerWidth - 1, box.x + box.width / 2));
            const y = Math.max(0, Math.min(innerHeight - 1, box.y + box.height / 2));
            const top = document.elementFromPoint(x, y);
            return box.left >= -1 && box.right <= innerWidth + 1 && box.width > 0 && box.height > 0
                && Boolean(top && (element.contains(top) || top.contains(element)));
        }), true, 'Control is within viewport and not covered');
    }
    try {
        await scenario('D06-B01-owner-cabinet-lifecycle', 'Owner uses actual profile UI to create an empty cabinet, edit branding and explicitly initialize resources without enabling unsupported modules', async () => {
            ownerSession = await newSession(fixture.actors.owner, 'owner');
            const page = ownerSession.page;
            await goProfile(ownerSession);
            await loadCabinets(page);
            await page.locator('[data-cabinet-action="create"]').click();
            assert.equal(await page.locator('[name="label"]').evaluate(element => element === document.activeElement), true);
            const suffix = fixture.runId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-18);
            const key = 'd06_browser_' + suffix;
            const label = 'D06 Browser Cabinet ' + suffix;
            await page.locator('[name="label"]').fill(label);
            await page.locator('[name="shortLabel"]').fill('D06 Browser');
            await page.locator('[name="contextKey"]').fill(key);
            await page.locator('[data-cabinet-unavailable] summary').click();
            assert.equal(await page.locator('[data-cabinet-module="graduation"]').isDisabled(), true);
            assert.equal(await page.locator('[data-cabinet-module="catalogs"]').isDisabled(), true);
            await page.getByRole('button', { name: 'Зберегти бізнес', exact: true }).focus();
            await page.keyboard.press('Enter');
            await page.locator('[data-cabinet-form]').waitFor({ state: 'detached' });
            const directory = await ownerApi('GET', '/api/organizations/management');
            createdBusiness = directory.organizations.flatMap(org => org.businesses || []).find(business => business.contextKey === key);
            assert.ok(createdBusiness, 'Created cabinet must come from actual management response');
            assert.deepEqual(createdBusiness.modules, []);
            await loadCabinets(page);
            await page.locator(`[data-cabinet-action="edit"][data-business-id="${createdBusiness.id}"]`).click();
            await page.locator('[name="label"]').fill(label + ' Updated');
            await page.locator('[name="shortLabel"]').fill('D06 Updated');
            await page.getByRole('button', { name: 'Зберегти бізнес', exact: true }).click();
            await page.locator('[data-cabinet-form]').waitFor({ state: 'detached' });
            await loadCabinets(page);
            await screenshot(page, 'owner-before-resource-initialization');
            const init = page.locator(`[data-cabinet-action="initialize"][data-business-id="${fixture.businesses.parkId}"]`);
            const initialization = [];
            for (let pass = 0; pass < 2; pass += 1) {
                // A successful mutation refreshes the profile and invalidates the
                // management directory. Reopen it through the existing UI for replay.
                if (pass > 0) await loadCabinets(page);
                await init.waitFor({ state: 'visible' });
                const [response] = await Promise.all([
                    page.waitForResponse(item => new URL(item.url()).pathname.endsWith('/initialize-resources') && item.request().method() === 'POST'),
                    init.click()
                ]);
                assert.equal(response.status(), 200, 'Explicit resource initialization succeeds');
                initialization.push((await response.json()).initialization);
                await page.locator('[data-cabinet-action="load"]:not([disabled])').waitFor();
                await screenshot(page, `owner-after-resource-initialization-${pass + 1}`);
            }
            assert.equal(initialization[1].created, 0, 'Second explicit initialization must be idempotent');
            const updated = (await ownerApi('GET', '/api/organizations/management')).organizations.flatMap(org => org.businesses || []).find(item => item.id === createdBusiness.id);
            assert.equal(updated.label, label + ' Updated');
            assert.deepEqual(updated.modules, []);
            return { observed: { businessContext: key, businessId: createdBusiness.id, modules: updated.modules, secondInitializationCreated: initialization[1].created }, evidence: [await screenshot(page, 'owner-cabinets')] };
        });

        await scenario('D06-B02-membership-editor', 'Owner assigns explicit, different roles and a default to an existing synthetic account through the canonical editor', async () => {
            prerequisite(ownerSession && fixture.actors.unassigned, 'Owner page and unassigned synthetic account are required');
            const page = ownerSession.page;
            await goProfile(ownerSession);
            await openMember(page, fixture.actors.unassigned.id, fixture.businesses.parkId);
            await page.locator('[data-tab="businesses"]').click();
            await page.locator('[data-membership-active]').check();
            await page.locator('[data-membership-default]').check();
            await page.locator('[data-tab="roles"]').click();
            await page.locator('[data-field="role"]').selectOption('animator');
            await saveMember(page);
            await openMember(page, fixture.actors.unassigned.id, fixture.businesses.darId);
            await page.locator('[data-tab="businesses"]').click();
            await page.locator('[data-membership-active]').check();
            await page.locator('[data-membership-default]').check();
            await page.locator('[data-tab="roles"]').click();
            await page.locator('[data-field="role"]').selectOption('manager');
            await saveMember(page);
            const access = (await ownerApi('GET', `/api/organizations/members/${fixture.actors.unassigned.id}/access-profile`)).accessProfile;
            const businesses = access.organizations.flatMap(org => org.businesses || []);
            assert.equal(businesses.find(item => item.id === fixture.businesses.parkId).membership.role, 'animator');
            assert.equal(businesses.find(item => item.id === fixture.businesses.darId).membership.role, 'manager');
            assert.equal(businesses.find(item => item.id === fixture.businesses.darId).membership.isDefault, true);
            return { observed: 'Actual access-profile confirms Park animator, Dar manager and explicit Dar default; editor save/close restores focus', evidence: [await screenshot(page, 'membership-save')] };
        });

        await scenario('D06-B03-admin-member-boundaries', 'Admin sees member management without owner cabinet controls; ordinary worker has neither lifecycle launcher', async () => {
            const admin = await newSession(fixture.actors.admin, 'admin');
            await goProfile(admin);
            await loadCabinets(admin.page);
            assert.equal(await admin.page.locator('[data-cabinet-action="create"]').count(), 0);
            assert.equal(await admin.page.locator('[data-cabinet-action="edit"]').count(), 0);
            assert.equal(await admin.page.locator('[data-members-load]').isVisible(), true);
            const worker = await newSession(fixture.actors.worker, 'worker');
            await goProfile(worker);
            assert.equal(await worker.page.locator('#profileBusinessCabinets').isVisible(), false);
            assert.equal(await worker.page.locator('#profileBusinessMembers').isVisible(), false);
            return { evidence: [await screenshot(admin.page, 'admin-cabinet-boundary'), await screenshot(worker.page, 'worker-profile-boundary')] };
        });

        await scenario('D06-B04-cross-tab-history', 'A real sidebar switch converges both tabs to Dar role; refresh/back/forward do not restore the Park role', async () => {
            const session = await newSession(fixture.actors.worker, 'worker-cross-tab');
            await goProfile(session);
            const second = await session.context.newPage();
            await second.goto(target.origin + '/profile?tab=settings&businessContext=event_genix', { waitUntil: 'domcontentloaded' });
            await second.locator('#profileBusinessCabinets').waitFor({ state: 'attached' });
            await switchBusiness(session.page, 'dar');
            for (const page of [session.page, second]) {
                await page.waitForFunction(() => window.AppState?.currentUser?.activeBusinessContext === 'dar' && window.AppState?.currentUser?.role === 'animator');
                assert.equal(new URL(page.url()).searchParams.get('businessContext'), 'dar');
            }
            await second.reload({ waitUntil: 'domcontentloaded' });
            await second.waitForFunction(() => window.AppState?.currentUser?.activeBusinessContext === 'dar' && window.AppState?.currentUser?.role === 'animator');
            await second.goto(target.origin + '/profile?tab=myday&businessContext=dar', { waitUntil: 'domcontentloaded' });
            await second.goBack({ waitUntil: 'domcontentloaded' });
            await second.waitForFunction(() => window.AppState?.currentUser?.activeBusinessContext === 'dar' && window.AppState?.currentUser?.role === 'animator');
            await second.goForward({ waitUntil: 'domcontentloaded' });
            await second.waitForFunction(() => window.AppState?.currentUser?.activeBusinessContext === 'dar' && window.AppState?.currentUser?.role === 'animator');
            return { observed: 'Two tabs retained Dar/animator after switch, reload and browser history', evidence: [await screenshot(second, 'cross-tab-dar-history')] };
        });

        await scenario('D06-B05-two-organizations', 'Multi-organization login requires actual explicit keyboard selection and exposes only available businesses', async () => {
            const session = await newSession(fixture.actors.multiOrg, 'multiOrg');
            const select = session.page.locator('#businessAccessSelection');
            await select.waitFor({ state: 'visible' });
            const values = await select.locator('option').evaluateAll(options => options.map(option => option.value));
            assert.ok(values.includes(fixture.businesses.customKey));
            await select.selectOption(fixture.businesses.customKey);
            await session.page.locator('[data-business-access-select]').focus();
            await session.page.keyboard.press('Enter');
            await session.page.waitForFunction(context => window.AppState?.currentUser?.activeBusinessContext === context, fixture.businesses.customKey);
            const user = await session.page.evaluate(() => ({ context: AppState.currentUser.activeBusinessContext, organizationId: AppState.currentUser.organizationId, role: AppState.currentUser.role }));
            assert.equal(Number(user.organizationId), Number(fixture.organizations.secondaryId));
            assert.equal(user.role, 'manager');
            return { observed: user, evidence: [await screenshot(session.page, 'two-organization-selection')] };
        });

        await scenario('D06-B14-four-business-switching', 'The published cabinet UI switches Park, Dar, Maysternya and CRM from server memberships without leaking the previous role', async () => {
            prerequisite(ownerSession, 'Owner browser session is required');
            const page = ownerSession.page;
            const observed = [];
            for (const businessContext of ['event_genix', 'dar', 'maysternya_doli', 'crm']) {
                await switchBusiness(page, businessContext);
                await page.waitForFunction(context => window.AppState?.currentUser?.activeBusinessContext === context, businessContext);
                observed.push(await page.evaluate(() => ({
                    context: window.AppState.currentUser.activeBusinessContext,
                    role: window.AppState.currentUser.role,
                    organizationId: window.AppState.currentUser.organizationId,
                    selected: document.querySelector('#sidebarBusinessContextSelect')?.value || null
                })));
            }
            for (const item of observed) {
                assert.equal(item.context, item.selected);
                assert.equal(item.role, 'director');
                assert.equal(Number(item.organizationId), Number(fixture.organizations.primaryId));
            }
            return { observed, evidence: [await screenshot(page, 'four-business-switching')] };
        });

        await scenario('D06-B12-products-context', 'Actual product cards switch from the Park fixture marker to Dar without retaining the other business data', async () => {
            const parkMarker = fixture.markers?.parkProduct || fixture.markers?.event_genix?.product;
            const darMarker = fixture.markers?.darProduct || fixture.markers?.dar?.product;
            prerequisite(ownerSession && parkMarker && darMarker, 'Owner session and exact synthetic product markers are required');
            const page = ownerSession.page;
            evidencePage = page;
            await page.goto(target.origin + '/programs?businessContext=event_genix#animation', { waitUntil: 'domcontentloaded' });
            const cards = page.locator('.program-card:visible, .maysternya-product-card:visible');
            const park = cards.filter({ hasText: parkMarker });
            const dar = cards.filter({ hasText: darMarker });
            await park.first().waitFor({ state: 'visible' });
            assert.equal(await dar.count(), 0);
            const [response] = await Promise.all([
                page.waitForResponse(item => new URL(item.url()).pathname === '/api/products' && item.request().method() === 'GET'),
                switchBusiness(page, 'dar')
            ]);
            await page.waitForFunction(() => document.body.dataset.productsBusiness === 'dar'
                && !document.querySelector('#maysternyaProductsGrid .product-load-state'));
            const dom = await page.evaluate(() => {
                const profile = window.CrmBusinessContext?.activeProfile?.();
                return {
                    path: location.pathname + location.search + location.hash,
                    business: document.body.dataset.productsBusiness,
                    apiContext: window.ProductBusinessContext?.getApiContext?.(),
                    title: document.querySelector('#productsPageTitle')?.textContent,
                    subtitle: document.querySelector('#productsPageSubtitle')?.textContent,
                    addLabel: document.querySelector('#addProductBtn')?.textContent,
                    activeProfile: profile ? { key: profile.key, label: profile.label, branding: profile.branding } : null,
                    visibleCards: [...document.querySelectorAll('.program-card, .maysternya-product-card')]
                        .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
                        .map(element => ({ id: element.dataset.id, name: element.querySelector('h3,h4')?.textContent }))
                };
            });
            const diagnosticsPath = path.join(output, 'products-context-diagnostics.json');
            fs.writeFileSync(diagnosticsPath, redact(JSON.stringify({ dom, response: {
                status: response.status(), path: new URL(response.url()).pathname,
                context: new URL(response.url()).searchParams.get('businessContext')
            }, requests: network.filter(item => item.actor === 'owner' && item.phase === phase
                && ['/api/products', '/api/auth/business-profile', '/api/auth/permissions'].includes(item.path)) }, null, 2)) + '\n');
            await screenshot(page, 'products-after-dar-switch');
            assert.equal(new URL(response.url()).searchParams.get('businessContext'), 'dar', 'Selected Dar must request Dar products rather than another available membership');
            await dar.first().waitFor({ state: 'visible' });
            assert.equal(await park.count(), 0);
            assert.equal(await page.locator('#maysternyaPanel .business-variant-actions a').isVisible(), false, 'Dar must not show the legacy Maysternya timeline action');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await dar.first().waitFor({ state: 'visible' });
            assert.equal(await park.count(), 0);
            assert.equal(await page.locator('body').getAttribute('data-products-business'), 'dar');
            assert.ok(dom.title.includes(dom.activeProfile.label), 'Product heading must use the selected business registry label');
            return { observed: 'Actual products HTTP/PG response and visible cards changed context; reload retained only Dar marker', evidence: [diagnosticsPath, await screenshot(page, 'products-dar-only')] };
        });

        await scenario('D06-B13-custom-products-history', 'A custom business in the second organization reads its own products and registry branding through reload/back/forward', async () => {
            const session = sessions.find(item => item.name === 'multiOrg');
            const key = fixture.businesses.customKey;
            const marker = fixture.markers?.[key]?.product;
            prerequisite(session && marker, 'Existing multi-organization session and synthetic custom product are required');
            const page = session.page;
            evidencePage = page;
            const [response] = await Promise.all([
                page.waitForResponse(item => new URL(item.url()).pathname === '/api/products' && item.request().method() === 'GET'),
                page.goto(target.origin + `/programs?businessContext=${encodeURIComponent(key)}`, { waitUntil: 'domcontentloaded' })
            ]);
            assert.equal(response.status(), 200);
            assert.equal(new URL(response.url()).searchParams.get('businessContext'), key);
            const cards = page.locator('.program-card:visible, .maysternya-product-card:visible');
            async function assertOwnProducts() {
                await cards.filter({ hasText: marker }).first().waitFor({ state: 'visible' });
                for (const other of ['event_genix', 'dar']) assert.equal(await cards.filter({ hasText: fixture.markers[other].product }).count(), 0);
                const state = await page.evaluate(() => ({
                    context: window.ProductBusinessContext.getApiContext(),
                    title: document.querySelector('#productsPageTitle').textContent,
                    label: window.CrmBusinessContext.activeProfile().label,
                    organizationId: window.AppState.currentUser.organizationId,
                    hash: location.hash
                }));
                assert.equal(state.context, key);
                assert.ok(state.title.includes(state.label));
                assert.equal(Number(state.organizationId), Number(fixture.organizations.secondaryId));
                assert.notEqual(state.hash, '#maysternya');
                assert.equal(await page.locator('#maysternyaPanel .business-variant-actions a').isVisible(), false, 'Custom business must not show the legacy Maysternya timeline action');
                return state;
            }
            await assertOwnProducts();
            await page.reload({ waitUntil: 'domcontentloaded' });
            await assertOwnProducts();
            await goProfile(session, key);
            await page.goBack({ waitUntil: 'domcontentloaded' });
            await assertOwnProducts();
            await page.goForward({ waitUntil: 'domcontentloaded' });
            await page.locator('#profileBusinessCabinets').waitFor({ state: 'attached' });
            await page.goBack({ waitUntil: 'domcontentloaded' });
            const state = await assertOwnProducts();
            return { observed: state, evidence: [await screenshot(page, 'products-custom-history')] };
        });

        await scenario('D06-B06-late-real-response', 'A delayed real management response cannot restore data after a real cabinet switch invalidates its request', async () => {
            prerequisite(ownerSession, 'Owner browser session is required');
            const session = ownerSession;
            await goProfile(session);
            let release;
            let arrived;
            const responseReady = new Promise(resolve => { arrived = resolve; });
            const gate = new Promise(resolve => { release = resolve; });
            let held = false;
            let heldRequest;
            const pattern = '**/api/organizations/management';
            const handler = async route => {
                if (held || route.request().method() !== 'GET') return route.continue();
                held = true;
                heldRequest = route.request();
                const realResponse = await route.fetch();
                assert.equal(realResponse.status(), 200);
                arrived();
                await gate;
                await route.fulfill({ response: realResponse }).catch(() => {});
            };
            await session.page.route(pattern, handler);
            let timeout;
            try {
                await session.page.locator('[data-cabinet-action="load"]').click();
                await Promise.race([responseReady, new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error('Real management response did not reach delay barrier')), 15000); })]);
                clearTimeout(timeout);
                const navigation = session.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 })
                    .then(() => ({ navigated: true }), () => ({ navigated: false }));
                await session.page.locator('#sidebarBusinessContextSelect').selectOption('dar');
                const inPlace = session.page.waitForFunction(() => window.CrmBusinessContext?.current?.() === 'dar'
                    && window.AppState?.currentUser?.activeBusinessContext === 'dar', null, { timeout: 15000 })
                    .then(() => ({ inPlace: true }), () => ({ inPlace: false }));
                const switched = await Promise.race([
                    navigation,
                    inPlace.then(async result => result.inPlace ? result : navigation)
                ]);
                assert.ok(switched.navigated || switched.inPlace, 'Business switch must either refresh the document or update its active context');
                const completed = session.page.waitForEvent('requestfinished', { predicate: request => request === heldRequest, timeout: 15000 })
                    .then(request => ({ request }), error => ({ error }));
                release();
                const completion = await completed;
                let delivery = 'aborted_by_navigation';
                if (completion.request) {
                    const deliveredResponse = await completion.request.response();
                    assert.equal(deliveredResponse.status(), 200, 'The original real management response must finish delivery');
                    await deliveredResponse.finished();
                    delivery = 'finished_200';
                } else {
                    assert.equal(switched.navigated, true, 'Only a document navigation may cancel the delayed request');
                }
                await session.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                await session.page.waitForFunction(() => window.AppState?.currentUser?.activeBusinessContext === 'dar');
                assert.equal(await session.page.locator('[data-cabinet-organization]').count(), 0, 'Stale directory may not repaint after context invalidation');
                return { observed: { actualGetFromAppPostgres: true, delayedOnlyInTransit: true, delivery,
                    navigation: Boolean(switched.navigated), uiFramesAfterDelivery: 2, activeBusiness: 'dar', staleDirectoryCount: 0 }, evidence: [await screenshot(session.page, 'late-response-dar')] };
            } finally { clearTimeout(timeout); release(); await session.page.unroute(pattern, handler); }
        });

        await scenario('D06-B10-ui-change-same-jwt', 'A role change and membership deactivation submitted by the owner UI affect the same existing browser JWT immediately', async () => {
            prerequisite(ownerSession && entries.some(entry => entry.id === 'D06-B02-membership-editor' && entry.status === 'PASS'), 'Successful assignment of the synthetic unassigned account is required');
            const session = await newSession(fixture.actors.unassigned, 'assigned-worker');
            await goProfile(session, 'dar');
            const originalToken = await session.page.evaluate(() => localStorage.getItem('pzp_access_token') || localStorage.getItem('pzp_token'));
            assert.ok(originalToken);
            sensitive.push(originalToken);
            async function sameSessionProfile() {
                const response = await session.context.request.get(target.origin + '/api/auth/business-profile?businessContext=dar', {
                    headers: { Authorization: 'Bearer ' + originalToken }
                });
                return { status: response.status(), body: await response.json() };
            }
            assert.equal((await sameSessionProfile()).body.user.role, 'manager');
            await goProfile(ownerSession);
            await openMember(ownerSession.page, fixture.actors.unassigned.id, fixture.businesses.darId);
            await ownerSession.page.locator('[data-tab="roles"]').click();
            await ownerSession.page.locator('[data-field="role"]').selectOption('animator');
            await saveMember(ownerSession.page);
            const changed = await sameSessionProfile();
            assert.equal(changed.status, 200);
            assert.equal(changed.body.user.role, 'animator');
            await session.page.reload({ waitUntil: 'domcontentloaded' });
            await session.page.waitForFunction(() => window.AppState?.currentUser?.activeBusinessContext === 'dar' && window.AppState?.currentUser?.role === 'animator');
            await openMember(ownerSession.page, fixture.actors.unassigned.id, fixture.businesses.darId);
            await ownerSession.page.locator('[data-tab="businesses"]').click();
            await ownerSession.page.locator('[data-membership-active]').uncheck();
            await saveMember(ownerSession.page);
            const revoked = await sameSessionProfile();
            assert.equal(revoked.status, 403);
            assert.notEqual(revoked.body.user?.role, 'manager');
            await session.page.reload({ waitUntil: 'domcontentloaded' });
            await session.page.waitForFunction(actorId => {
                const user = window.AppState?.currentUser;
                return Number(user?.id) === Number(actorId)
                    && (['selection_required', 'unavailable'].includes(user.accessContext?.status)
                        || (user.activeBusinessContext === 'event_genix' && user.role === 'animator'));
            }, fixture.actors.unassigned.id);
            return { observed: { sameOriginalJwt: true, roleAfterUiSave: changed.body.user.role, statusAfterMembershipDeactivation: revoked.status }, evidence: [await screenshot(session.page, 'same-jwt-revoked-membership')] };
        });

        for (const width of [390, 768, 1440]) {
            await scenario(`D06-B07-layout-${width}`, `Actual cabinet and membership controls remain usable with keyboard at ${width}px in light and dark`, async () => {
                prerequisite(ownerSession, 'Owner browser session is required');
                const page = ownerSession.page;
                await page.setViewportSize({ width, height: 1000 });
                await goProfile(ownerSession);
                await loadCabinets(page);
                const evidence = [];
                for (const dark of [false, true]) {
                    await setTheme(page, dark);
                    await page.locator('[data-cabinet-action="create"]').click();
                    const form = page.locator('[data-cabinet-form]');
                    assert.equal(await form.locator('[name="label"]').evaluate(element => element === document.activeElement), true);
                    await form.locator('[name="label"]').fill('D06 unsaved responsive fixture');
                    await form.locator('[name="label"]').press('Tab');
                    assert.equal(await form.locator('[name="shortLabel"]').evaluate(element => element === document.activeElement), true);
                    await reachable(form.getByRole('button', { name: 'Зберегти бізнес', exact: true }));
                    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'No horizontal document clipping');
                    evidence.push(await screenshot(page, `cabinet-${width}-${dark ? 'dark' : 'light'}`));
                    evidence.push(await screenshot(page, `cabinet-${width}-${dark ? 'dark' : 'light'}-viewport`, false));
                    page.once('dialog', dialog => dialog.accept());
                    await page.locator('[data-cabinet-action="cancel"]').click();
                    await openMember(page, fixture.actors.worker.id, fixture.businesses.parkId);
                    await page.locator('[data-tab="businesses"]').click();
                    await reachable(page.locator('[data-access-scope]'));
                    await reachable(page.locator('[data-membership-active]'));
                    await reachable(page.locator('[data-action="save"]'));
                    evidence.push(await screenshot(page, `membership-${width}-${dark ? 'dark' : 'light'}`));
                    evidence.push(await screenshot(page, `membership-${width}-${dark ? 'dark' : 'light'}-viewport`, false));
                    if (width === 390) {
                        await page.locator('[data-tab="businesses"]').focus();
                        await page.keyboard.press('End');
                        const history = page.locator('[data-tab="history"]');
                        assert.equal(await history.evaluate(element => element === document.activeElement), true);
                        assert.equal(await history.getAttribute('aria-selected'), 'true');
                        const geometry = () => history.evaluate(element => {
                            const box = element.getBoundingClientRect();
                            const rail = element.closest('[role="tablist"]');
                            const sheet = element.closest('.aae-sheet');
                            const rect = rail.getBoundingClientRect();
                            return { tab: { left: box.left, right: box.right }, rail: { left: rect.left, right: rect.right, scrollLeft: rail.scrollLeft },
                                sheetTransform: getComputedStyle(sheet).transform, sheetAnimation: getComputedStyle(sheet).animationName,
                                viewport: innerWidth, focused: element === document.activeElement };
                        });
                        const before = await geometry();
                        try {
                            // The canonical sheet re-enters for .18s after tab rerender.
                            // Observe its settled geometry; do not scroll or change CSS from the test.
                            await page.waitForFunction(() => {
                                const element = document.querySelector('[data-tab="history"]');
                                const box = element?.getBoundingClientRect();
                                const rail = element?.closest('[role="tablist"]').getBoundingClientRect();
                                return Boolean(box && rail && element === document.activeElement
                                    && box.left >= Math.max(0, rail.left) - 1 && box.right <= Math.min(innerWidth, rail.right) + 1);
                            }, null, { timeout: 2000 });
                        } finally {
                            const geometryPath = path.join(output, `membership-390-${dark ? 'dark' : 'light'}-keyboard-geometry.json`);
                            fs.writeFileSync(geometryPath, JSON.stringify({ before, settled: await geometry() }, null, 2) + '\n');
                            evidence.push(geometryPath);
                        }
                        evidence.push(await screenshot(page, `membership-390-${dark ? 'dark' : 'light'}-history-viewport`, false));
                    }
                    await page.keyboard.press('Escape');
                    await page.locator('#accountAccessEditorRoot').waitFor({ state: 'detached' });
                }
                return { observed: 'Native form focus order, visible actionable controls, canonical theme toggle and no document overflow', evidence };
            });
        }

        await scenario('D06-B08-business-deactivation', 'Owner deactivates only the newly created synthetic business through the existing UI', async () => {
            prerequisite(ownerSession && createdBusiness, 'Successful owner cabinet creation is required');
            const page = ownerSession.page;
            await page.setViewportSize({ width: 1440, height: 1000 });
            await goProfile(ownerSession);
            await loadCabinets(page);
            page.once('dialog', dialog => dialog.accept());
            await page.locator(`[data-cabinet-action="status"][data-business-id="${createdBusiness.id}"]`).click();
            await page.locator('[data-cabinet-action="load"]:not([disabled])').waitFor();
            const entry = (await ownerApi('GET', '/api/organizations/management')).organizations.flatMap(org => org.businesses || []).find(item => item.id === createdBusiness.id);
            assert.equal(entry.status, 'inactive');
            return { observed: { businessId: entry.id, contextKey: entry.contextKey, status: entry.status }, evidence: [await screenshot(page, 'cabinet-deactivated')] };
        });

        await scenario('D06-B11-last-owner-editor', 'Attempting to demote the sole active organization owner through the editor receives 409 and preserves the owner', async () => {
            prerequisite(ownerSession, 'Owner browser session is required');
            const page = ownerSession.page;
            await goProfile(ownerSession);
            await openMember(page, fixture.actors.owner.id, fixture.businesses.parkId);
            await page.locator('[data-tab="businesses"]').click();
            await page.locator('[data-organization-role]').selectOption('member');
            const [response] = await Promise.all([
                page.waitForResponse(item => new URL(item.url()).pathname === `/api/organizations/${fixture.organizations.primaryId}/members/${fixture.actors.owner.id}` && item.request().method() === 'PUT'),
                page.locator('[data-action="save"]').click()
            ]);
            assert.equal(response.status(), 409);
            await page.locator('.aae-save-state').filter({ hasText: /owner|власник|власників/i }).waitFor({ state: 'visible' });
            const management = await ownerApi('GET', '/api/organizations/management');
            assert.equal(management.organizations.find(org => org.id === fixture.organizations.primaryId).role, 'owner');
            const evidence = await screenshot(page, 'last-owner-denial');
            await page.keyboard.press('Escape');
            if (await page.locator('[data-action="discard"]').isVisible()) await page.locator('[data-action="discard"]').click();
            return { observed: 'Actual UI write returned 409 and fresh management still reports the same owner', evidence: [evidence] };
        });
    } finally {
        phase = 'teardown';
        await Promise.all(denialBodyReads);
        for (const session of sessions) await session.context.close().catch(() => {});
        await browser.close();
        const unexpectedServerErrors = network.filter(item => item.status >= 500);
        const errorResponses = network.filter(item => item.status >= 400 && item.status < 500);
        function expectedDenial(item) {
            if (item.status === 409 && item.actor === 'owner' && item.phase === 'D06-B11-last-owner-editor'
                && item.method === 'PUT' && item.path === `/api/organizations/${fixture.organizations.primaryId}/members/${fixture.actors.owner.id}`) return 'Sole-owner invariant';
            if (item.status !== 403 || item.method !== 'GET') return null;
            if (item.actor === 'assigned-worker' && item.phase === 'D06-B10-ui-change-same-jwt'
                && item.path === '/api/auth/business-profile' && item.context === 'dar') return 'Explicitly revoked Dar membership';
            if (['worker-cross-tab', 'assigned-worker'].includes(item.actor) && item.context === 'dar'
                && ['/api/tasks/decomposition-saved-templates', '/api/tasks/ai-draft/status'].includes(item.path)) return 'Animator lacks task-AI management permission';
            if (['multiOrg', 'assigned-worker'].includes(item.actor) && item.context === null
                && item.path === '/api/dashboard/widgets/currency') return 'Manager/animator lacks protected currency-widget permission';
            if (item.actor === 'owner' && item.context === 'crm'
                && /^\/api\/bookings\//.test(item.path)) return 'CRM registry intentionally disables the timeline module';
            if (item.actor === 'multiOrg' && item.context === fixture.contexts.other
                && item.path === '/api/chat/unread' && item.denialCode === 'chat_not_migrated') return 'Selected membership context correctly receives legacy chat containment';
            return null;
        }
        const classifiedDenials = errorResponses.map(item => ({ ...item, reason: expectedDenial(item) }));
        const unclassifiedHttpErrors = classifiedDenials.filter(item => !item.reason);
        const expectedBlocked = blockedExternal.filter(item => (item.host === 'fonts.googleapis.com' && item.path === '/css2')
            || (item.host === 'www.clarity.ms' && item.path === '/tag/w841e2emn0'));
        const unclassifiedExternal = blockedExternal.filter(item => !expectedBlocked.includes(item));
        const classifiedConsole = consoleErrors.map(item => {
            let url;
            try { url = new URL(item.location); } catch {}
            let reason = null;
            if (url && item.message === 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector'
                && expectedBlocked.some(blocked => blocked.host === url.hostname && blocked.path === url.pathname)) reason = 'Intentional external browser fence';
            const status = Number(item.message.match(/^Failed to load resource: the server responded with a status of (403|409) \(/)?.[1]);
            if (url?.origin === target.origin && status && classifiedDenials.some(denial => denial.reason
                && denial.path === url.pathname && denial.status === status)) reason = 'Expected HTTP denial (see exact actor/context matrix)';
            return { ...item, reason };
        });
        const unclassifiedConsole = classifiedConsole.filter(item => !item.reason);
        const diagnosticsStatus = network.length === 0 ? 'NOT_TESTABLE'
            : unexpectedServerErrors.length || pageErrors.length || unclassifiedHttpErrors.length
                || unclassifiedConsole.length || unclassifiedExternal.length ? 'FAIL' : 'PASS';
        emit({ id: 'D06-B09-browser-diagnostics', status: diagnosticsStatus,
            expected: 'No page exceptions, HTTP 5xx or unclassified failures; exact expected access denials and blocked fonts/analytics remain visible in evidence',
            observed: { actualAppApiResponses: network.length, http5xx: unexpectedServerErrors.length, pageErrors: pageErrors.length, consoleErrors: consoleErrors.length,
                http4xx: errorResponses.length, blockedExternal: blockedExternal.length, expectedHttpDenials: classifiedDenials.length - unclassifiedHttpErrors.length,
                unexpectedHttpErrors: unclassifiedHttpErrors.length, unclassifiedConsole: unclassifiedConsole.length, unclassifiedExternal: unclassifiedExternal.length },
            evidence: [path.join(output, 'browser-diagnostics.json')] });
        fs.writeFileSync(path.join(output, 'browser-diagnostics.json'), redact(JSON.stringify({ network, consoleErrors, pageErrors, blockedExternal,
            classifiedDenials, classifiedConsole, unclassifiedExternal }, null, 2)) + '\n');
        fs.writeFileSync(path.join(output, 'browser-results.json'), redact(JSON.stringify({ runId: fixture.runId, target: target.origin,
            actualApp: true, apiMocks: false, serviceWorkers: 'blocked-to-require-real-HTTP', entries }, null, 2)) + '\n');
    }
    return { entries, network, consoleErrors, pageErrors, blockedExternal, outputDir: output };
}

if (require.main === module) {
    const input = JSON.parse(process.env.SYS_MB_BROWSER_FIXTURE_JSON || 'null');
    assert.ok(input, 'Provide in-memory SYS_MB_BROWSER_FIXTURE_JSON from the guarded disposable harness');
    runBrowserAcceptance({ ...input, record: entry => process.stdout.write(`${entry.id} ${entry.status}\n`) })
        .then(result => { process.exitCode = result.entries.some(entry => entry.status === 'FAIL') ? 1 : 0; })
        .catch(error => { process.stderr.write(`Browser runner failed: ${error.name}\n`); process.exitCode = 1; });
}

module.exports = { runBrowserAcceptance };
