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
            bootstrapReads.set(page, []);
            page.on('pageerror', error => errors.push({ message: error.message, at: Date.now(), page, engine }));
            page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push({ at: Date.now(), page }); });
            page.on('requestfailed', request => failedRequests.push({ page, at: Date.now(),
                path: new URL(request.url()).pathname, reason: request.failure()?.errorText || '' }));
            page.on('request', request => {
                const url = new URL(request.url());
                if (/hermes/i.test(request.url())) hermes.push(url.pathname);
                if (request.method() === 'GET' && (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/my-day/timer')) {
                    bootstrapReads.get(page).push(request.response().then(response => response?.finished()).catch(() => {}));
                }
            });
        });
        async function settleBootstrapReads(page) {
            const reads = bootstrapReads.get(page) || [];
            let settled = 0;
            do {
                settled = reads.length;
                await Promise.all(reads.slice(0, settled));
                // Let the completed bootstrap response start any dependent read.
                await page.evaluate(() => Promise.resolve());
            } while (reads.length !== settled);
        }
        async function verifyBackgroundReadback(page) {
            for (const path of ['/api/my-day/timer', '/api/auth/telegram-crm']) {
                const ok = await page.evaluate(async path => {
                    const response = await fetch(path, { headers: { Authorization: `Bearer ${getStoredAuthToken()}`,
                        ...apiAuthBusinessContextHeaders() } });
                    return response.ok;
                }, path);
                assert.equal(ok, true, `Stable document must successfully read ${path}`);
                readbacks.push({ page, path, ok, at: Date.now() });
            }
        }
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const navigate = async url => { await settleBootstrapReads(page); return page.goto(url); };
        const reload = async () => { await settleBootstrapReads(page); return page.reload(); };
        const api = async (endpoint, body) => {
            const response = await fetch(origin + endpoint, { method: body ? 'POST' : 'GET', headers: {
                authorization: 'Bearer ' + session.token, 'content-type': 'application/json'
            }, ...(body ? { body: JSON.stringify(body) } : {}) });
            assert.ok(response.ok, `${endpoint}: ${response.status}`);
            return response.json();
        };
        try {
            const created = await api('/api/tasks', { title: `Task entry ${engine}`, description: 'Local navigation fixture',
                task_mode: 'personal', assigned_to: session.user.username, owner_user_id: session.user.id,
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
            await editor.getByRole('button', { name: 'Зберегти', exact: true }).click();
            try {
                assert.equal(await editor.locator('[name=title]').isDisabled(), true, 'pending save cannot silently overwrite typing');
                assert.equal(await scheduleDate.isDisabled(), true, 'pending editor save also locks the schedule draft');
                assert.equal(await editor.getByRole('button', { name: 'Зберегти', exact: true }).isDisabled(), true);
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
            await page.route(`**/api/tasks/${id}/reschedule*`, route => route.fulfill({ status: 503, json: { success: false, error: 'Local schedule retry' } }), { times: 1 });
            await dialog.locator('[data-dialog-schedule] [name=date]').fill('2099-11-21');
            await dialog.getByRole('button', { name: 'Перенести', exact: true }).click();
            await dialog.getByRole('alert').waitFor();
            assert.equal(await scheduleDate.inputValue(), '2099-11-21', 'failed schedule retains the date');
            assert.equal(await editor.locator('[name=description]').inputValue(), 'Independent editor draft');
            await dialog.getByRole('button', { name: 'Перенести', exact: true }).click();
            await dialog.locator('time[datetime="2099-11-21"]').waitFor();
            assert.equal(await editor.locator('[name=description]').inputValue(), 'Independent editor draft', 'rescheduling preserves editor draft');
            await editor.locator('[name=description]').fill('Local navigation fixture');
            assert.equal(await dialog.getAttribute('data-dirty'), 'false', 'restoring original inputs clears dirty state');
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
            await editor.getByRole('button', { name: 'Зберегти', exact: true }).click();
            await dialog.getByRole('button', { name: 'Повторити завантаження' }).waitFor();
            assert.equal(await editor.getByRole('button', { name: 'Зберегти', exact: true }).isDisabled(), true);
            await page.unroute(recoveryDetailUrl);
            await dialog.getByRole('button', { name: 'Повторити завантаження' }).click();
            await dialog.locator('.park-task-dialog-description').filter({ hasText: 'Saved before reload failure' }).waitFor();
            assert.equal(recoveryWrites, 1, 'reload recovery must never repeat an accepted mutation');
            page.off('request', recoveryRequest);
            await page.route(`**/api/tasks/${id}/complete*`, route => route.fulfill({ status: 503, json: { success: false, error: 'Local QA retry' } }), { times: 1 });
            await dialog.getByRole('button', { name: 'Виконати', exact: true }).click();
            await dialog.getByRole('alert').waitFor();
            assert.equal(new URL(page.url()).pathname, '/profile');
            await dialog.getByRole('button', { name: 'Виконати', exact: true }).click();
            await dialog.getByText('Виконано', { exact: true }).waitFor();
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
                date: '2099-11-20', priority: 'normal' });
            const darId = dar.task?.id || dar.data?.id || dar.id;
            const scopedVerify = await api('/api/auth/verify?businessContext=dar');
            assert.equal(scopedVerify.user.activeBusinessContext, 'dar', 'canonical verify query resolves Dar membership on the server');
            const search = await api(`/api/search?q=${encodeURIComponent(darTitle)}&businessContext=dar`);
            const darLink = search.results.tasks.find(task => Number(task.id) === Number(darId))?.href;
            assert.ok(darLink, 'search must return the visible Dar fixture');
            assert.equal(new URL(darLink, origin).searchParams.get('businessContext'), 'dar', 'search retains task business context');
            // Park is the active context before opening the Dar task in a second tab.
            await navigate(origin + href);
            const parkTitle = process.env.TASK_ENTRY_CONTEXT_ONLY === '1' ? `Task entry ${engine}` : `Task entry saved ${engine}`;
            await dialog.getByRole('heading', { name: parkTitle }).waitFor();
            // Keep Park active: the new task entry must converge both tabs to Dar,
            // without the account-default verify response publishing Park again.
            await settleBootstrapReads(page);
            const otherTab = await context.newPage();
            try {
                await otherTab.goto(origin + darLink);
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
                await settleBootstrapReads(otherTab);
                const generation = await otherTab.evaluate(() => localStorage.getItem('pzp_auth_session_generation'));
                await otherTab.reload();
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
                await page.waitForURL(url => url.searchParams.get('businessContext') === 'dar');
                await settleBootstrapReads(page);
                await settleBootstrapReads(otherTab);
                assert.equal(await otherTab.evaluate(prior => localStorage.getItem('pzp_auth_session_generation') === prior, generation), true,
                    'Dar reload and shared-context convergence must not rotate generation back through Park');
            } finally { await settleBootstrapReads(otherTab); await verifyBackgroundReadback(otherTab); await otherTab.close(); }
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
            await navigate(origin + '/tasks');
            assert.equal(new URL(page.url()).pathname, '/tasks');
            await verifyBackgroundReadback(page);
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
        } finally { await context.close(); await browser.close(); }
    }
}
module.exports = { verifyTaskEntry, isNavigationInterruption };
