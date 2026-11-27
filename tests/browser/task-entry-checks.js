'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { requirePlaywright } = require('./timeline-room-summary-browser-smoke');

function isNavigationInterruption(error, failedRequests, navigations, readbacks) {
    if (error.engine !== 'webkit') return false;
    const path = ['/api/my-day/timer', '/api/auth/telegram-crm']
        .find(path => error.message.endsWith(`${path} due to access control checks.`));
    return Boolean(path
        && !failedRequests.some(request => request.page === error.page && request.path === path
            && !/cancelled|canceled|ERR_ABORTED|aborted/i.test(request.reason) && Math.abs(request.at - error.at) <= 1000)
        && navigations.some(navigation => navigation.page === error.page && Math.abs(navigation.at - error.at) <= 100)
        && readbacks.some(readback => readback.page === error.page && readback.path === path && readback.ok && readback.at > error.at));
}

async function verifyPinnedTaskTabs({ origin, session }, context, engine) {
    const fixture = async (scope, title) => {
        const response = await fetch(origin + '/api/tasks?businessContext=' + scope, {
            method: 'POST',
            headers: { authorization: 'Bearer ' + session.token, 'content-type': 'application/json' },
            body: JSON.stringify({ title, task_mode: 'work', visibility: 'team', assigned_to: session.user.username,
                owner_user_id: session.user.id, date: '2099-11-20', priority: 'high' })
        });
        assert.ok(response.ok, 'Create scoped fixture ' + scope);
        return (await response.json()).task.id;
    };
    const parkTitle = 'Pinned Park ' + engine;
    const darTitle = 'Pinned Dar ' + engine;
    const parkId = await fixture('event_genix', parkTitle);
    const darId = await fixture('dar', darTitle);
    const park = await context.newPage();
    const dar = await context.newPage();
    for (const page of [park, dar]) {
        await page.setViewportSize({ width: 1440, height: 900 });
        page.setDefaultTimeout(20000);
    }
    const card = page => page.locator('.park-task-dialog[open]');
    const expectContext = (page, scope) => page.locator('body[data-crm-business-context="' + scope + '"]').waitFor();
    const open = (page, url) => page.goto(origin + url, { waitUntil: 'domcontentloaded' });
    const pin = async page => {
        await page.locator('[data-sidebar-business-tab-pin][aria-pressed="false"]').click();
        await page.locator('[data-sidebar-business-tab-pin][aria-pressed="true"]').waitFor();
    };
    try {
        await open(park, '/tasks.html?highlight=' + parkId + '&businessContext=event_genix');
        await park.locator('#username').fill(process.env.TEST_USER);
        await park.locator('#password').fill(process.env.TEST_PASS);
        await park.locator('#loginForm button[type=submit]').click();
        await card(park).getByRole('heading', { name: parkTitle, exact: true }).waitFor();
        await park.keyboard.press('Escape');
        await card(park).waitFor({ state: 'hidden' });
        await pin(park);
        await open(park, '/profile?tab=myday&open=' + parkId);
        await card(park).getByRole('heading', { name: parkTitle, exact: true }).waitFor();
        await card(park).locator('[data-dialog-edit]').click();
        const titleInput = card(park).locator('[name=title]');
        await titleInput.fill('Unsaved Park title');
        await card(park).getByRole('button', { name: 'Назад до перегляду', exact: true }).click();
        await card(park).getByText('Ще', { exact: true }).click();
        await card(park).getByRole('button', { name: 'Перенести', exact: true }).click();
        const dateInput = card(park).locator('[data-dialog-schedule] [name=date]');
        await dateInput.fill('2099-11-25');

        await open(dar, '/tasks?businessContext=event_genix');
        await pin(dar);
        await dar.locator('#sidebarBusinessContextSelect').selectOption('dar');
        await expectContext(dar, 'dar');
        const row = dar.locator('.task-team-row[data-task-id="' + darId + '"]');
        await row.getByRole('button', { name: darTitle, exact: true }).click();
        await card(dar).getByRole('heading', { name: darTitle, exact: true }).waitFor();
        assert.equal(new URL(dar.url()).pathname, '/profile');
        assert.equal(new URL(dar.url()).searchParams.get('businessContext'), 'dar');
        await expectContext(dar, 'dar');
        await open(dar, '/tasks.html?highlight=' + darId);
        await card(dar).getByRole('heading', { name: darTitle, exact: true }).waitFor();
        await dar.reload({ waitUntil: 'domcontentloaded' });
        await card(dar).getByRole('heading', { name: darTitle, exact: true }).waitFor();
        await expectContext(dar, 'dar');
        await expectContext(park, 'event_genix');
        assert.equal(await dateInput.inputValue(), '2099-11-25');
        await card(park).getByRole('button', { name: 'Назад до перегляду', exact: true }).click();
        await card(park).locator('[data-dialog-edit]').click();
        assert.equal(await titleInput.inputValue(), 'Unsaved Park title');
        await card(dar).waitFor();
        await dar.keyboard.press('Escape');
        await card(dar).waitFor({ state: 'hidden' });
        await dar.locator('#logoutBtn').click();
        await park.locator('#loginForm').waitFor();
        await card(park).waitFor({ state: 'hidden' });
        assert.equal(await park.evaluate(() => AppState.currentUser), null);
        console.log('Pinned task tabs ' + engine + ': Park and Dar, title/date drafts, legacy redirects, reload and shared logout verified.');
    } finally {
        await Promise.all([park.close(), dar.close()]);
    }
}

async function verifyTaskEntry({ origin, session, evidence }) {
    const engines = (process.env.TASK_ENTRY_BROWSER_ENGINES || 'chromium').split(',');
    for (const engine of engines) {
        const browser = await requirePlaywright()[engine].launch();
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Kyiv', serviceWorkers: 'block' });
        const traceSession = process.env.TASK_ENTRY_SESSION_TRACE === '1';
        if (traceSession) await context.addInitScript(() => {
            const set = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, value) {
                if (this === localStorage && ['pzp_current_user', 'pzp_auth_session_generation'].includes(key)) {
                    let activeBusiness;
                    if (key === 'pzp_current_user') { try { activeBusiness = JSON.parse(value).activeBusinessContext; } catch {} }
                    console.debug('TASK_SESSION_TRACE', JSON.stringify({ event: key === 'pzp_current_user' ? 'user' : 'generation',
                        path: location.pathname + location.search, activeBusiness,
                        caller: new Error().stack?.split('\n').slice(1, 4).join(' ') }));
                }
                return set.call(this, key, value);
            };
        });
        await context.route('https://**/*', route => route.abort());
        const pinContext = await browser.newContext({ timezoneId: 'Europe/Kyiv', serviceWorkers: 'block' });
        await pinContext.route('https://**/*', route => route.abort());
        try {
            await verifyPinnedTaskTabs({ origin, session }, pinContext, engine);
        } catch (error) {
            await browser.close();
            throw error;
        } finally {
            await pinContext.close();
        }
        const errors = [], hermes = [], failedRequests = [], navigations = [], readbacks = [], bootstrapReads = new Map();
        context.on('page', page => {
            if (traceSession) {
                page.on('console', message => { if (message.text().startsWith('TASK_SESSION_TRACE')) console.log(message.text()); });
                page.on('response', async response => {
                    const url = new URL(response.url());
                    if (!['/api/auth/verify', '/api/auth/business-profile'].includes(url.pathname)) return;
                    const data = await response.json().catch(() => null);
                    console.log('TASK_SESSION_RESPONSE', JSON.stringify({ path: url.pathname + url.search,
                        requested: response.request().headers()['x-business-context'], activeBusiness: data?.user?.activeBusinessContext,
                        tab: new URL(page.url()).pathname + new URL(page.url()).search }));
                });
            }
            const reads = { pending: new Map(), lastActivity: Date.now(), navigation: null };
            bootstrapReads.set(page, reads);
            page.on('pageerror', error => errors.push({ message: error.message, at: Date.now(), page, engine }));
            page.on('framenavigated', frame => {
                if (frame !== page.mainFrame()) return;
                navigations.push({ at: Date.now(), page });
                const navigation = reads.navigation;
                if (navigation?.url !== withoutFragment(frame.url())) return;
                reads.navigation = null;
                // A committed document replacement can leave no terminal event for
                // a cancelled read from the previous document. Keep new reads pending.
                for (const request of navigation.previousReads) finishRead(request);
            });
            page.on('requestfailed', request => failedRequests.push({ page, at: Date.now(),
                path: new URL(request.url()).pathname, reason: request.failure()?.errorText || '' }));
            page.on('request', request => {
                const url = new URL(request.url());
                if (/hermes/i.test(request.url())) hermes.push(url.pathname);
                if (request.isNavigationRequest() && url.origin === origin) {
                    let frame;
                    try { frame = request.frame(); } catch { return; }
                    if (frame === page.mainFrame()) {
                        reads.navigation = { request, url: withoutFragment(url.href), previousReads: [...reads.pending.keys()] };
                    }
                    return;
                }
                const accept = request.headers().accept || '';
                if (request.method() === 'GET' && url.origin === origin && url.pathname.startsWith('/api/')
                    && request.resourceType() !== 'eventsource' && !accept.includes('text/event-stream')) {
                    reads.pending.set(request, { path: url.pathname, document: new URL(page.url()).pathname });
                    reads.lastActivity = Date.now();
                }
            });
            function withoutFragment(url) { return url.split('#', 1)[0]; }
            function finishRead(request) {
                if (reads.pending.delete(request)) reads.lastActivity = Date.now();
            }
            page.on('requestfinished', finishRead);
            page.on('requestfailed', request => {
                if (reads.navigation?.request === request) reads.navigation = null;
                finishRead(request);
            });
        });
        async function settleBootstrapReads(page) {
            const reads = bootstrapReads.get(page);
            if (!reads) return;
            const startedAt = Date.now();
            const deadline = startedAt + 20000;
            // Let finite same-origin reads finish before intentionally replacing a document.
            while (Date.now() < deadline) {
                if (!reads.pending.size && Date.now() - Math.max(startedAt, reads.lastActivity) >= 100) return;
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            const pending = [...reads.pending.values()].map(({ path, document }) => `${path} (started on ${document})`);
            throw new Error(`Bootstrap reads did not settle on ${new URL(page.url()).pathname}: ${pending.join(', ')}`);
        }
        async function verifyBackgroundReadback(page) {
            for (const path of ['/api/my-day/timer', '/api/auth/telegram-crm']) {
                const ok = await page.evaluate(async path => {
                    const response = await fetch(path, { headers: { Authorization: `Bearer ${getStoredAuthToken()}`,
                        ...apiAuthBusinessContextHeaders() } });
                    await response.arrayBuffer();
                    return response.ok;
                }, path);
                assert.equal(ok, true, `Stable document must successfully read ${path}`);
                readbacks.push({ page, path, ok, at: Date.now() });
            }
        }
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const navigate = async url => { await settleBootstrapReads(page); return page.goto(url, { waitUntil: 'domcontentloaded' }); };
        const reload = async () => { await settleBootstrapReads(page); return page.reload({ waitUntil: 'domcontentloaded' }); };
        const api = async (endpoint, body, options = {}) => {
            const response = await fetch(origin + endpoint, { method: options.method || (body ? 'POST' : 'GET'), headers: {
                authorization: 'Bearer ' + (options.token || session.token), 'content-type': 'application/json'
            }, ...(body ? { body: JSON.stringify(body) } : {}) });
            assert.ok(response.ok, `${endpoint}: ${response.status}`);
            return response.json();
        };
        try {
            const created = await api('/api/tasks', { title: `Task entry ${engine}`, description: 'Local navigation fixture',
                task_mode: 'personal', visibility: 'team', assigned_to: session.user.username, owner_user_id: session.user.id,
                date: '2099-11-20', priority: 'normal' });
            const id = created.task?.id || created.data?.id || created.id;
            assert.ok(id);
            const href = `/profile?tab=myday&open=${id}&businessContext=event_genix`;
            // Real login from an old bot button must retain both the task and its scope.
            await navigate(origin + `/tasks.html?highlight=${id}&businessContext=event_genix`);
            await page.locator('#username').fill(process.env.TEST_USER);
            await page.locator('#password').fill(process.env.TEST_PASS);
            await page.locator('#loginForm button[type=submit]').click();
            const dialog = page.locator('.park-task-dialog[open]');
            async function openSchedule() {
                const back = dialog.getByRole('button', { name: 'Назад до перегляду', exact: true });
                if (await back.isVisible()) await back.click();
                await dialog.getByText('Ще', { exact: true }).click();
                await dialog.getByRole('button', { name: 'Перенести', exact: true }).click();
                await dialog.locator('[data-dialog-schedule] [name=date]').waitFor();
            }
            await dialog.getByRole('heading', { name: `Task entry ${engine}` }).waitFor();
            assert.equal(new URL(page.url()).pathname, '/profile');
            assert.equal(new URL(page.url()).searchParams.get('open'), String(id));
            assert.equal(new URL(page.url()).searchParams.get('businessContext'), 'event_genix');
            await reload();
            await dialog.getByRole('heading', { name: `Task entry ${engine}` }).waitFor();
            if (process.env.TASK_ENTRY_CONTEXT_ONLY !== '1') {
            for (const alias of ['open', 'highlight', 'taskId', 'task']) {
                await navigate(origin + `/tasks?${alias}=${id}`);
                await dialog.getByRole('heading', { name: `Task entry ${engine}` }).waitFor();
                assert.equal(new URL(page.url()).pathname, '/profile');
            }
            await page.keyboard.press('Escape');
            await page.waitForURL(url => !url.searchParams.has('open'));
            await page.goForward();
            await dialog.waitFor();
            await page.goBack();
            await dialog.waitFor({ state: 'hidden' });
            await navigate(origin + href + '&mode=edit');
            const editor = dialog.locator('[data-dialog-editor]');
            await editor.waitFor();
            const scheduleDate = dialog.locator('[data-dialog-schedule] [name=date]');
            await openSchedule();
            await scheduleDate.fill('2099-11-22');
            assert.equal(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), true,
                'document navigation must warn about the schedule draft');
            await page.keyboard.press('Escape');
            assert.equal(await dialog.count(), 1, 'Escape must retain an unsaved schedule draft');
            await dialog.getByRole('button', { name: 'Закрити', exact: true }).click();
            assert.equal(await dialog.count(), 1, 'Close must retain an unsaved schedule draft');
            await page.goBack();
            await dialog.getByText('Є незбережені зміни.', { exact: false }).waitFor();
            assert.equal(await scheduleDate.inputValue(), '2099-11-22', 'Back keeps the pending date');
            await page.evaluate(() => window.dispatchEvent(new Event('permissions:lifecycle')));
            assert.equal(await scheduleDate.inputValue(), '2099-11-22', 'permission refresh must not discard the schedule draft');
            assert.equal(await page.evaluate(() => switchTab('settings')), false, 'tab switches cannot discard the schedule draft');
            await page.evaluate(() => {
                const target = new URL(location.href); target.searchParams.set('tab', 'settings');
                history.pushState({}, '', target);
                dispatchEvent(new PopStateEvent('popstate'));
            });
            await page.waitForURL(url => url.searchParams.get('tab') === 'myday');
            assert.equal(await scheduleDate.inputValue(), '2099-11-22', 'cross-tab history retains the schedule draft');
            assert.deepEqual(await editor.locator('[name=priority] option').evaluateAll(options => options.map(option => option.value)),
                ['urgent', 'high', 'normal', 'low'], 'dialog uses the canonical CRM task priorities');
            await dialog.getByRole('button', { name: 'Назад до перегляду' }).click();
            await dialog.locator('[data-dialog-edit]').click();
            await editor.locator('[name=priority]').selectOption('high');
            await editor.locator('[name=title]').fill(`Task entry saved ${engine}`);
            await page.keyboard.press('Escape');
            await dialog.getByText('Є незбережені зміни.', { exact: false }).waitFor();
            let writes = 0;
            const countWrites = request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === `/api/tasks/${id}`) writes++; };
            page.on('request', countWrites);
            let releaseSave;
            const pendingSave = new Promise(resolve => { releaseSave = resolve; });
            const saveUrl = url => url.pathname === `/api/tasks/${id}`;
            await page.route(saveUrl, async route => {
                if (route.request().method() !== 'PUT') return route.fallback();
                await pendingSave;
                return route.continue();
            });
            await editor.getByRole('button', { name: 'Зберегти зміни', exact: true }).click();
            try {
                assert.equal(await editor.locator('[name=title]').isDisabled(), true, 'pending save cannot silently overwrite typing');
                assert.equal(await scheduleDate.isDisabled(), true, 'pending editor save also locks the schedule draft');
                assert.equal(await editor.getByRole('button', { name: 'Зберегти зміни', exact: true }).isDisabled(), true);
                await dialog.getByRole('button', { name: 'Закрити', exact: true }).click();
                assert.equal(await dialog.count(), 1, 'pending save cannot be dismissed');
            } finally { releaseSave(); }
            await dialog.getByRole('heading', { name: `Task entry saved ${engine}` }).waitFor();
            assert.equal(await scheduleDate.inputValue(), '2099-11-22', 'saving editor does not discard the schedule draft');
            await page.unroute(saveUrl);
            assert.equal(writes, 1, 'one save must issue exactly one mutation');
            const saved = await api('/api/tasks/' + id);
            assert.equal((saved.task || saved).description, 'Local navigation fixture');
            assert.equal((saved.task || saved).priority, 'high');
            await dialog.locator('[data-dialog-edit]').click();
            await editor.locator('[name=description]').fill('Independent editor draft');
            const schedulePath = '/api/tasks/' + id + '/reschedule';
            const scheduleAttempts = [];
            let committedSchedule;
            const initialSchedule = await api('/api/tasks/' + id);
            await page.route(url => url.pathname === schedulePath, async route => {
                scheduleAttempts.push(route.request().postDataJSON());
                if (scheduleAttempts.length === 1) return route.abort('failed');
                committedSchedule = await route.fetch({ maxRetries: 0 });
                return route.abort('failed');
            }, { times: 2 });
            await openSchedule();
            await dialog.locator('[data-dialog-schedule] [name=date]').fill('2099-11-21');
            await dialog.getByRole('button', { name: 'Перенести на обрану дату', exact: true }).click();
            const checkOutcome = dialog.getByRole('button', { name: 'Перевірити результат', exact: true });
            await checkOutcome.waitFor();
            assert.equal(await dialog.getByRole('button', { name: 'Перенести на обрану дату', exact: true }).isDisabled(), true);
            assert.equal((await api('/api/tasks/' + id)).version, initialSchedule.version, 'aborted before dispatch leaves the version unchanged');
            assert.equal(await scheduleDate.inputValue(), '2099-11-21', 'unknown schedule retains the date');
            assert.equal(await editor.locator('[name=description]').inputValue(), 'Independent editor draft');
            await checkOutcome.click();
            await dialog.getByRole('button', { name: 'Повторити ту саму дію', exact: true }).click();
            await checkOutcome.waitFor();
            assert.equal(committedSchedule.status(), 200, 'the second request committed before its response was lost');
            assert.equal(scheduleAttempts.length, 2);
            assert.deepEqual(scheduleAttempts[1], scheduleAttempts[0], 'the user retry reuses the operation and expected version');
            const afterCommit = await api('/api/tasks/' + id);
            assert.equal(afterCommit.version, initialSchedule.version + 1);
            assert.equal(afterCommit.myDayOperation.id, scheduleAttempts[0].myDayOperationId);
            await checkOutcome.click();
            await dialog.locator('time[datetime="2099-11-21"]').waitFor();
            await checkOutcome.waitFor({ state: 'hidden' });
            const history = (await api('/api/tasks/' + id + '/history')).history;
            assert.equal(history.filter(event => event.meta?.idempotencyKey?.endsWith(':' + scheduleAttempts[0].myDayOperationId)).length, 1);
            assert.equal((await api('/api/tasks/' + id)).version, initialSchedule.version + 1, 'readback must not cause a second mutation');
            assert.equal(await editor.locator('[name=description]').inputValue(), 'Independent editor draft', 'rescheduling preserves editor draft');
            await dialog.locator('[data-dialog-edit]').click();
            await editor.locator('[name=description]').fill('Local navigation fixture');
            assert.equal(await dialog.getAttribute('data-dirty'), 'false', 'restoring original inputs clears dirty state');
            await openSchedule();
            await scheduleDate.fill('2099-11-23');
            await page.setViewportSize({ width: 390, height: 900 });
            await page.screenshot({ path: path.join(evidence, `task-entry-dirty-${engine}-390.png`), animations: 'disabled' });
            await dialog.locator('.park-task-dialog-discard').click();
            await dialog.waitFor({ state: 'hidden' });
            await navigate(origin + href);
            await dialog.locator('time[datetime="2099-11-21"]').waitFor();
            const invalidatedDetail = page.waitForResponse(response => new URL(response.url()).pathname === `/api/tasks/${id}` && response.request().method() === 'GET');
            await page.evaluate(() => window.dispatchEvent(new Event('permissions:lifecycle')));
            await invalidatedDetail;
            await dialog.locator('time[datetime="2099-11-21"]').waitFor();
            assert.equal(new URL(page.url()).searchParams.get('open'), String(id), 'permission hydration retains the task URL');
            for (const width of [390, 1440]) {
                await page.setViewportSize({ width, height: 900 });
                assert.ok(await dialog.evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && node.scrollWidth <= node.clientWidth + 1; }));
                await page.screenshot({ path: path.join(evidence, `task-entry-${engine}-${width}.png`), animations: 'disabled' });
            }
            const recoveryDetailUrl = url => url.pathname === `/api/tasks/${id}`;
            // A successful mutation followed by failed reload must not repeat the write.
            await dialog.locator('[data-dialog-edit]').click();
            await editor.locator('[name=description]').fill('Saved before reload failure');
            let recoveryWrites = 0;
            const recoveryRequest = request => {
                if (request.method() === 'PUT' && new URL(request.url()).pathname === `/api/tasks/${id}`) recoveryWrites++;
            };
            page.on('request', recoveryRequest);
            await page.route(recoveryDetailUrl, route => route.request().method() === 'GET'
                ? route.fulfill({ status: 503, json: { error: 'Local reload failure' } }) : route.fallback());
            await editor.getByRole('button', { name: 'Зберегти зміни', exact: true }).click();
            await dialog.getByRole('button', { name: 'Повторити завантаження' }).waitFor();
            assert.equal(await editor.getByRole('button', { name: 'Зберегти зміни', exact: true }).isDisabled(), true);
            await page.unroute(recoveryDetailUrl);
            await dialog.getByRole('button', { name: 'Повторити завантаження' }).click();
            await dialog.locator('.park-task-dialog-description').filter({ hasText: 'Saved before reload failure' }).waitFor();
            assert.equal(recoveryWrites, 1, 'reload recovery must never repeat an accepted mutation');
            page.off('request', recoveryRequest);

            const beforeLostEdit = await api('/api/tasks/' + id);
            let committedEdit;
            await page.route(saveUrl, async route => {
                if (route.request().method() !== 'PUT') return route.fallback();
                committedEdit = await route.fetch({ maxRetries: 0 });
                return route.abort('failed');
            });
            await dialog.locator('[data-dialog-edit]').click();
            await editor.locator('[name=description]').fill('Committed edit before response loss');
            await editor.getByRole('button', { name: 'Зберегти зміни', exact: true }).click();
            await checkOutcome.waitFor();
            assert.equal(committedEdit.status(), 200);
            await page.unroute(saveUrl);
            await checkOutcome.click();
            await dialog.locator('.park-task-dialog-description').filter({ hasText: 'Committed edit before response loss' }).waitFor();
            assert.equal((await api('/api/tasks/' + id)).version, beforeLostEdit.version + 1);

            const { randomBytes: randomEditorBytes } = require('node:crypto');
            const peerUsername = 'qa_task_editor_' + randomEditorBytes(6).toString('hex');
            const peerPassword = 'Local-' + randomEditorBytes(18).toString('hex') + '-Aa9';
            await api('/api/users', { username: peerUsername, password: peerPassword, name: 'Local concurrent editor',
                role: 'director', businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix' });
            const peer = await api('/api/auth/login', { username: peerUsername, password: peerPassword });
            assert.notEqual(peer.user.id, session.user.id);
            const snapshot = await api('/api/tasks/' + id);
            await dialog.locator('[data-dialog-edit]').click();
            await editor.locator('[name=description]').fill('Reconciled local description');
            await api('/api/tasks/' + id, { description: 'Concurrent change from another user', priority: 'low',
                status: 'in_progress', version: snapshot.version }, { method: 'PUT', token: peer.token });
            const [staleResponse] = await Promise.all([
                page.waitForResponse(response => saveUrl(new URL(response.url())) && response.request().method() === 'PUT'),
                editor.getByRole('button', { name: 'Зберегти зміни', exact: true }).click()
            ]);
            assert.equal(staleResponse.status(), 409);
            const stalePayload = staleResponse.request().postDataJSON();
            assert.deepEqual(Object.keys(stalePayload).sort(), ['description', 'myDayOperationId', 'sourceSurface', 'version']);
            assert.equal(stalePayload.version, snapshot.version);
            assert.equal((await api('/api/tasks/' + id)).description, 'Concurrent change from another user');
            assert.equal(await editor.locator('[name=description]').inputValue(), 'Reconciled local description');
            await dialog.getByRole('button', { name: 'Переглянути актуальну версію' }).click();
            await editor.getByText('Опис: Concurrent change from another user', { exact: true }).waitFor();
            assert.equal(await editor.locator('[name=description]').inputValue(), 'Reconciled local description');
            await editor.getByRole('button', { name: 'Зберегти зміни', exact: true }).click();
            await dialog.locator('.park-task-dialog-description').filter({ hasText: 'Reconciled local description' }).waitFor();
            const resolved = await api('/api/tasks/' + id);
            assert.equal(resolved.description, 'Reconciled local description');
            assert.equal(resolved.priority, 'low');
            assert.equal(resolved.status, 'in_progress');
            assert.equal(resolved.version, snapshot.version + 2);

            await page.route(`**/api/tasks/${id}/complete*`, route => route.fulfill({ status: 422, json: { success: false, error: 'Local confirmed denial' } }), { times: 1 });
            await dialog.getByRole('button', { name: 'Виконати', exact: true }).click();
            await dialog.getByRole('alert').waitFor();
            assert.equal(new URL(page.url()).pathname, '/profile');
            assert.equal(await checkOutcome.count(), 0, 'confirmed denial is not an unknown outcome');
            const beforeCompletion = await api('/api/tasks/' + id);
            await page.route(url => url.pathname === '/api/tasks/' + id + '/complete', async route => {
                assert.equal((await route.fetch({ maxRetries: 0 })).status(), 200);
                return route.abort('failed');
            }, { times: 1 });
            await dialog.getByRole('button', { name: 'Виконати', exact: true }).click();
            await checkOutcome.click();
            await dialog.getByText('Виконано', { exact: true }).waitFor();
            await checkOutcome.waitFor({ state: 'hidden' });
            const afterCompletion = await api('/api/tasks/' + id);
            assert.equal(afterCompletion.version, beforeCompletion.version + 1);
            assert.equal(afterCompletion.myDayOperation.kind, 'complete');
            assert.equal(await dialog.locator('[data-dialog-complete]').count(), 0);
            await navigate(origin + '/profile?tab=myday&open=2147483647');
            await dialog.getByText('Задача недоступна або її видалено.', { exact: true }).waitFor();
            await navigate(origin + '/profile?tab=myday&open=bad');
            await dialog.getByText('Некоректне посилання на задачу.', { exact: true }).waitFor();
            const detailUrl = url => url.pathname === `/api/tasks/${id}`;
            await page.route(detailUrl, route => route.fulfill({ status: 403, json: { error: 'Local forbidden fixture' } }), { times: 1 });
            await navigate(origin + href);
            await dialog.getByText('Задача недоступна або її видалено.', { exact: true }).waitFor();
            await page.unroute(detailUrl);
            await page.route(detailUrl, route => route.abort('internetdisconnected'), { times: 1 });
            await reload();
            await dialog.getByRole('button', { name: 'Спробувати ще раз' }).click();
            await dialog.getByRole('heading', { name: `Task entry saved ${engine}` }).waitFor();
            }
            const darTitle = `Task scope ${engine}`;
            const dar = await api('/api/tasks?businessContext=dar', { title: darTitle, description: 'Cross-context fixture',
                task_mode: 'personal', assigned_to: session.user.username, owner_user_id: session.user.id,
                date: '2099-11-20', priority: 'high' });
            const darId = dar.task?.id || dar.data?.id || dar.id;
            const scopedVerify = await api('/api/auth/verify?businessContext=dar');
            assert.equal(scopedVerify.user.activeBusinessContext, 'dar', 'canonical verify query resolves Dar membership on the server');
            const search = await api(`/api/search?q=${encodeURIComponent(darTitle)}&businessContext=dar`);
            const darLink = search.results.tasks.find(task => Number(task.id) === Number(darId))?.href;
            assert.ok(darLink, 'search must return the visible Dar fixture');
            assert.equal(new URL(darLink, origin).searchParams.get('businessContext'), 'dar', 'search retains task business context');
            const scopedPark = await api('/api/tasks?businessContext=event_genix', { title: 'Park link scope fixture ' + engine,
                visibility: 'team', task_mode: 'work', owner_user_id: session.user.id, priority: 'high' });
            const parkLinkId = Number(scopedPark.task.id);
            const scopes = [
                ['businessContext=dar', [[Number(darId), 'dar']]],
                ['businessContext=event_genix', [[parkLinkId, 'event_genix']]],
                ['businessContext=event_genix&businessScope=multi&businessContexts=event_genix,dar', [[parkLinkId, 'event_genix'], [Number(darId), 'dar']]],
                ['businessContext=event_genix&businessScope=all', [[parkLinkId, 'event_genix'], [Number(darId), 'dar']]]
            ];
            const { taskUrl } = require('../../js/task-links');
            for (const [query, expected] of scopes) {
                const widget = await api('/api/dashboard/widgets/team_tasks?' + query);
                const received = widget.data.tasks.filter(item => [parkLinkId, Number(darId)].includes(Number(item.id)));
                assert.equal(received.length, expected.length, 'dashboard fixtures in ' + query);
                for (const [taskId, businessContext] of expected) {
                    const item = received.find(row => Number(row.id) === taskId);
                    assert.ok(item, 'dashboard includes explicitly scoped fixture ' + taskId);
                    assert.equal(new URL(taskUrl(item.id, { businessContext: item.business_context }), origin)
                        .searchParams.get('businessContext'), businessContext);
                }
            }
            const operations = await api('/api/center/operations/today?businessContext=event_genix');
            const linkedModules = ['/finance', '/reports', '/finance?mode=insights'];
            const backgroundDocuments = [];
            const observeModuleLoad = request => {
                const url = new URL(request.url());
                if (request.resourceType() === 'document' && ['/finance', '/reports', '/analytics'].includes(url.pathname)) {
                    backgroundDocuments.push(url.pathname);
                }
            };
            page.on('request', observeModuleLoad);
            await navigate(origin + '/center?businessContext=event_genix');
            await page.getByRole('tab', { name: 'Зміна', exact: true }).click();
            assert.equal(await page.locator('.center-embed-frame').count(), 0);
            for (const destination of linkedModules) {
                await page.locator('a[data-former-tab][href="' + destination + '"]').waitFor({ state: 'visible' });
            }
            for (const [taskId, businessContext] of scopes.at(-1)[1]) {
                const row = operations.openTasks.find(task => Number(task.id) === taskId);
                assert.equal(row?.businessContext, businessContext);
                const link = page.locator('#operationsCenter .center-ops-row').filter({ hasText: row.title })
                    .getByRole('link', { name: 'Відкрити', exact: true });
                await link.waitFor();
                const url = new URL(await link.getAttribute('href'), origin);
                assert.equal(url.searchParams.get('open'), String(taskId));
                assert.equal(url.searchParams.get('businessContext'), businessContext);
            }
            page.off('request', observeModuleLoad);
            assert.deepEqual(backgroundDocuments, [], 'Operations waits for a click before loading a linked module');
            console.log(`Task entry ${engine}: dashboard, search and Operations Center scopes verified.`);
            // Park is the active context before opening the Dar task in a second tab.
            await settleBootstrapReads(page);
            await page.goto(origin + href, { waitUntil: 'domcontentloaded' });
            const parkTitle = process.env.TASK_ENTRY_CONTEXT_ONLY === '1' ? `Task entry ${engine}` : `Task entry saved ${engine}`;
            await dialog.getByRole('heading', { name: parkTitle }).waitFor();
            // Keep Park active: the new task entry must converge both tabs to Dar,
            // without the account-default verify response publishing Park again.
            await settleBootstrapReads(page);
            const dirtyTitle = 'Unsubmitted title in the previous business';
            const dirtyDate = '2099-11-25';
            await dialog.locator('[data-dialog-edit]').click();
            await dialog.locator('[name=title]').fill(dirtyTitle);
            await openSchedule();
            await dialog.locator('[data-dialog-schedule] [name=date]').fill(dirtyDate);
            const otherTab = await context.newPage();
            try {
                await otherTab.goto(origin + darLink, { waitUntil: 'domcontentloaded' });
                await otherTab.locator('.park-task-dialog[open]').getByRole('heading', { name: darTitle, exact: true }).waitFor().catch(async error => {
                    await otherTab.screenshot({ path: path.join(evidence, `task-entry-context-failure-${engine}.png`), animations: 'disabled' });
                    console.log('Local context diagnostic:', await otherTab.evaluate(() => ({
                        path: location.pathname + location.search,
                        businessPolicy: window.CrmBusinessContext?.policy?.(AppState.currentUser),
                        activeBusiness: AppState.currentUser?.activeBusinessContext,
                        dialog: document.querySelector('.park-task-dialog')?.textContent,
                        body: document.body.innerText.slice(0, 1800)
                    })));
                    throw error;
                });
                const recovery = page.getByRole('dialog', { name: 'Активний бізнес змінився' });
                await recovery.waitFor();
                assert.equal(await recovery.getByRole('button', { name: 'Зберегти зміни', exact: true }).count(), 0);
                assert.equal(await page.locator('#mainApp').isVisible(), true);
                await page.bringToFront();
                await page.keyboard.press('Tab');
                await settleBootstrapReads(page);
                const nativeWarning = page.waitForEvent('dialog', { predicate: prompt => prompt.type() === 'beforeunload' });
                await page.evaluate(() => { setTimeout(() => location.reload(), 50); });
                await (await nativeWarning).dismiss();
                assert.equal(await recovery.isVisible(), true, 'canceling a native reload leaves the recovery form available');
                assert.equal(await page.locator('#mainApp').isVisible(), true, 'canceling the reload leaves the shell visible');
                await page.keyboard.press('Escape');
                assert.equal(await recovery.isVisible(), true, 'Escape leaves the recovery choice available');
                await settleBootstrapReads(page);
                await Promise.all([
                    page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame()
                        && new URL(frame.url()).searchParams.get('businessContext') === 'dar' }),
                    recovery.getByRole('button', { name: 'Зберегти чернетку в цій вкладці та перейти' }).click()
                ]);
                await page.waitForLoadState('domcontentloaded');
                await settleBootstrapReads(otherTab);
                const generation = await otherTab.evaluate(() => localStorage.getItem('pzp_auth_session_generation'));
                await otherTab.reload({ waitUntil: 'domcontentloaded' });
                await otherTab.locator('.park-task-dialog[open]').getByRole('heading', { name: darTitle, exact: true }).waitFor().catch(async error => {
                    console.log('Local context reload diagnostic:', await otherTab.evaluate(() => ({
                        path: location.pathname + location.search,
                        businessPolicy: window.CrmBusinessContext?.policy?.(AppState.currentUser),
                        activeBusiness: AppState.currentUser?.activeBusinessContext,
                        dialog: document.querySelector('.park-task-dialog')?.textContent,
                        body: document.body.innerText.slice(0, 1800)
                    })));
                    await otherTab.screenshot({ path: path.join(evidence, `task-entry-context-reload-failure-${engine}.png`), animations: 'disabled', timeout: 5000 });
                    throw error;
                });
                await page.waitForURL(url => url.searchParams.get('businessContext') === 'dar'
                    && !url.searchParams.has('open') && !url.searchParams.has('mode') && !url.searchParams.has('date'));
                await page.locator('.park-task-dialog[open]').waitFor({ state: 'hidden' });
                await settleBootstrapReads(page);
                assert.equal(new URL(page.url()).searchParams.get('tab'), 'myday');
                assert.equal(new URL(otherTab.url()).searchParams.get('open'), String(darId));
                await settleBootstrapReads(otherTab);
                assert.equal(await otherTab.evaluate(prior => localStorage.getItem('pzp_auth_session_generation') === prior, generation), true,
                    'Dar reload and shared-context convergence must not rotate generation back through Park');
            } finally { await settleBootstrapReads(otherTab); await verifyBackgroundReadback(otherTab); await otherTab.close(); }
            await navigate(origin + href);
            await dialog.getByRole('heading', { name: parkTitle }).waitFor();
            assert.equal(await dialog.locator('[name=title]').inputValue(), dirtyTitle, 'Returning to the original actor/business/task restores the draft');
            assert.equal(await dialog.locator('[data-dialog-schedule] [name=date]').inputValue(), dirtyDate, 'The date draft survives alongside the editor draft');
            console.log(`Task entry ${engine}: native reload canceled and both drafts recovered.`);
            await dialog.getByRole('button', { name: 'Відкинути зміни та закрити' }).click();
            await dialog.waitFor({ state: 'hidden' });
            // Closing the dialog and leaving its history entry are separate events.
            await page.waitForURL(url => url.pathname === '/profile' && url.searchParams.get('tab') === 'myday'
                && url.searchParams.get('businessContext') === 'event_genix' && !url.searchParams.has('open'));
            await navigate(origin + href);
            await dialog.getByRole('heading', { name: parkTitle }).waitFor();
            await dialog.locator('[data-dialog-edit]').waitFor();
            assert.notEqual(await dialog.getAttribute('data-dirty'), 'true', 'discarded drafts must not reopen');
            await openSchedule();
            await dialog.locator('[data-dialog-schedule] [name=date]').fill(dirtyDate);
            assert.equal(await dialog.getAttribute('data-dirty'), 'true', 'the second transition starts with a date-only draft');
            await settleBootstrapReads(page);
            const dateTransitionTab = await context.newPage();
            try {
                await dateTransitionTab.goto(origin + darLink, { waitUntil: 'domcontentloaded' });
                await dateTransitionTab.locator('.park-task-dialog[open]').getByRole('heading', { name: darTitle, exact: true }).waitFor().catch(async error => {
                    console.log('Date-only draft transition:', await dateTransitionTab.evaluate(() => ({
                        path: location.pathname + location.search,
                        activeBusiness: window.AppState?.currentUser?.activeBusinessContext,
                        dialogTitle: document.querySelector('.park-task-dialog[open] h2')?.textContent,
                        bootstrapFailure: typeof getApiAuthSessionFailure === 'function' ? getApiAuthSessionFailure()?.reason : null
                    })).catch(() => null));
                    await dateTransitionTab.screenshot({ path: path.join(evidence, `task-entry-date-transition-failure-${engine}.png`),
                        animations: 'disabled', timeout: 5000 }).catch(() => {});
                    throw error;
                });
                const recovery = page.getByRole('dialog', { name: 'Активний бізнес змінився' });
                await recovery.waitFor();
                await recovery.getByRole('button', { name: 'Відкинути чернетку та перейти' }).waitFor();
                await page.bringToFront();
                await page.keyboard.press('Tab');
                await settleBootstrapReads(page);
                const nativeWarning = page.waitForEvent('dialog', { predicate: prompt => prompt.type() === 'beforeunload' });
                await page.evaluate(() => { setTimeout(() => location.reload(), 50); });
                await Promise.all([page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() }),
                    nativeWarning.then(prompt => prompt.accept())]);
                await page.waitForLoadState('domcontentloaded');
                await page.waitForURL(url => url.searchParams.get('businessContext') === 'dar' && !url.searchParams.has('open'));
                await recovery.waitFor({ state: 'hidden' });
                await page.locator('#mainApp').waitFor({ state: 'visible' });
                await dateTransitionTab.locator('.park-task-dialog[open]').getByRole('heading', { name: darTitle, exact: true }).waitFor();
            } finally {
                await settleBootstrapReads(dateTransitionTab);
                await verifyBackgroundReadback(dateTransitionTab);
                await dateTransitionTab.close();
            }
            console.log(`Task entry ${engine}: native reload accepted with date-only draft.`);
            const { randomBytes } = require('node:crypto');
            const deniedUsername = `task_scope_${randomBytes(6).toString('hex')}`;
            const deniedPassword = `Local-${randomBytes(18).toString('hex')}-Aa9`;
            await api('/api/users', { username: deniedUsername, password: deniedPassword, name: 'Local scope-denial actor',
                role: 'director', businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix' });
            const deniedLogin = await api('/api/auth/login', { username: deniedUsername, password: deniedPassword });
            const deniedDetail = await fetch(origin + `/api/tasks/${darId}?businessContext=dar`, {
                headers: { authorization: 'Bearer ' + deniedLogin.token }
            });
            assert.ok([403, 404].includes(deniedDetail.status), 'actor without Dar membership remains denied');
            const [teamList] = await Promise.all([
                page.waitForEvent('requestfinished', { predicate: request => {
                    const url = new URL(request.url());
                    return request.method() === 'GET' && url.pathname === '/api/tasks'
                        && url.searchParams.get('view') === 'team' && url.searchParams.get('pagination') === '1';
                } }),
                navigate(origin + '/tasks')
            ]);
            assert.equal(new URL(page.url()).pathname, '/tasks');
            assert.ok((await teamList.response())?.ok(), 'The bare Tasks route successfully loads the paginated team list');
            await page.getByRole('heading', { name: /^Задачі команди/ }).waitFor();
            await verifyBackgroundReadback(page);
            await settleBootstrapReads(page);
            // Start the logout check from the task document.
            await page.goto(origin + href, { waitUntil: 'domcontentloaded' });
            await dialog.getByRole('heading', { name: parkTitle }).waitFor();
            await verifyBackgroundReadback(page);
            await openSchedule();
            await dialog.locator('[data-dialog-schedule] [name=date]').fill(dirtyDate);
            const logoutTab = await context.newPage();
            try {
                await logoutTab.goto(origin + '/profile?tab=myday&businessContext=event_genix', { waitUntil: 'domcontentloaded' });
                await Promise.all([settleBootstrapReads(page), settleBootstrapReads(logoutTab)]);
                await logoutTab.locator('#logoutBtn').click();
                await dialog.waitFor({ state: 'hidden' });
                await page.locator('#loginForm').waitFor({ state: 'visible' });
                assert.equal(await page.evaluate(() => AppState.currentUser), null);
                assert.equal(await page.getByRole('dialog', { name: 'Активний бізнес змінився' }).count(), 0);
            } finally { await logoutTab.close(); }
            console.log(`Task entry ${engine}: shared logout closed the dirty dialog.`);
            // WebKit may emit a navigation-time access-control page error without
            // requestfailed. Require a <=100ms same-page navigation and successful
            // native browser readback; explicit CORS/network failures stay fatal.
            const unexpected = errors.filter(error => !isNavigationInterruption(error, failedRequests, navigations, readbacks));
            if (unexpected.length !== errors.length) console.log('WebKit: navigation-time background interruption verified by successful stable-document readback.');
            if (unexpected.length) console.log('Background failure evidence:', failedRequests
                .filter(request => ['/api/auth/telegram-crm', '/api/my-day/timer'].includes(request.path))
                .map(({ path, reason, at }) => ({ path, reason, at })));
            if (unexpected.length) console.log('Background navigation timing:', unexpected.map(error => ({ message: error.message,
                navigationDeltas: navigations.filter(navigation => navigation.page === error.page).map(navigation => navigation.at - error.at) })));
            assert.deepEqual(unexpected.map(error => error.message), []);
            assert.deepEqual(hermes, []);
            console.log(process.env.TASK_ENTRY_CONTEXT_ONLY === '1'
                ? `Task entry context ${engine}: concurrent Park/Dar tabs, scoped search, stable generation on reload, and denied foreign-business actor.`
                : `Task entry ${engine}: legacy aliases, real login, reload/history, independent editor/schedule drafts, tab/invalidation guards, save recovery, reschedule/completion, scoped Dar link, responsive dialog, no Hermes.`);
        } catch (error) {
            await page.screenshot({ path: path.join(evidence, `task-entry-failure-${engine}.png`), timeout: 5000 }).catch(() => {});
            throw error;
        } finally { await context.close(); await browser.close(); }
    }
}
module.exports = { verifyTaskEntry, isNavigationInterruption };
