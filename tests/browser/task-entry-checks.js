'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { requirePlaywright } = require('./timeline-room-summary-browser-smoke');

async function verifyTaskEntry({ origin, session, evidence }) {
    const engines = (process.env.TASK_ENTRY_BROWSER_ENGINES || 'chromium').split(',');
    for (const engine of engines) {
        const browser = await requirePlaywright()[engine].launch();
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Kyiv', serviceWorkers: 'block' });
        await context.route('https://**/*', route => route.abort());
        const errors = [], hermes = [];
        context.on('page', page => {
            page.on('pageerror', error => errors.push(error.message));
            page.on('request', request => { if (/hermes/i.test(request.url())) hermes.push(new URL(request.url()).pathname); });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
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
            await page.goto(origin + `/tasks.html?highlight=${id}&businessContext=event_genix`);
            await page.locator('#username').fill(process.env.TEST_USER);
            await page.locator('#password').fill(process.env.TEST_PASS);
            await page.locator('#loginForm button[type=submit]').click();
            const dialog = page.locator('.park-task-dialog[open]');
            await dialog.getByRole('heading', { name: `Task entry ${engine}` }).waitFor();
            assert.equal(new URL(page.url()).pathname, '/profile');
            assert.equal(new URL(page.url()).searchParams.get('open'), String(id));
            assert.equal(new URL(page.url()).searchParams.get('businessContext'), 'event_genix');
            await page.reload();
            await dialog.getByRole('heading', { name: `Task entry ${engine}` }).waitFor();
            for (const alias of ['open', 'highlight', 'taskId']) {
                await page.goto(origin + `/tasks?${alias}=${id}`);
                await dialog.getByRole('heading', { name: `Task entry ${engine}` }).waitFor();
                assert.equal(new URL(page.url()).pathname, '/profile');
            }
            await page.keyboard.press('Escape');
            await page.waitForURL(url => !url.searchParams.has('open'));
            await page.goForward();
            await dialog.waitFor();
            await page.goBack();
            await dialog.waitFor({ state: 'hidden' });
            await page.goto(origin + href + '&mode=edit');
            const editor = dialog.locator('[data-dialog-editor]');
            await editor.waitFor();
            await editor.locator('[name=title]').fill(`Task entry saved ${engine}`);
            await page.keyboard.press('Escape');
            await dialog.getByText('Є незбережені зміни.', { exact: false }).waitFor();
            let writes = 0;
            const countWrites = request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === `/api/tasks/${id}`) writes++; };
            page.on('request', countWrites);
            await editor.getByRole('button', { name: 'Зберегти', exact: true }).click();
            await dialog.getByRole('heading', { name: `Task entry saved ${engine}` }).waitFor();
            assert.equal(writes, 1, 'one save must issue exactly one mutation');
            const saved = await api('/api/tasks/' + id);
            assert.equal((saved.task || saved).description, 'Local navigation fixture');
            await dialog.locator('[data-dialog-schedule] [name=date]').fill('2099-11-21');
            await dialog.getByRole('button', { name: 'Перенести', exact: true }).click();
            await dialog.locator('time[datetime="2099-11-21"]').waitFor();
            for (const width of [390, 1440]) {
                await page.setViewportSize({ width, height: 900 });
                assert.ok(await dialog.evaluate(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && node.scrollWidth <= node.clientWidth + 1; }));
                await page.screenshot({ path: path.join(evidence, `task-entry-${engine}-${width}.png`), animations: 'disabled' });
            }
            await page.route(`**/api/tasks/${id}/complete*`, route => route.fulfill({ status: 503, json: { success: false, error: 'Local QA retry' } }), { times: 1 });
            await dialog.getByRole('button', { name: 'Виконати', exact: true }).click();
            await dialog.getByRole('alert').waitFor();
            assert.equal(new URL(page.url()).pathname, '/profile');
            await dialog.getByRole('button', { name: 'Виконати', exact: true }).click();
            await dialog.getByText('Виконано', { exact: true }).waitFor();
            assert.equal(await dialog.locator('[data-dialog-complete]').count(), 0);
            await page.goto(origin + '/profile?tab=myday&open=2147483647');
            await dialog.getByText('Задача недоступна або її видалено.', { exact: true }).waitFor();
            await page.goto(origin + '/profile?tab=myday&open=bad');
            await dialog.getByText('Некоректне посилання на задачу.', { exact: true }).waitFor();
            const detailUrl = url => url.pathname === `/api/tasks/${id}`;
            await page.route(detailUrl, route => route.fulfill({ status: 403, json: { error: 'Local forbidden fixture' } }), { times: 1 });
            await page.goto(origin + href);
            await dialog.getByText('Задача недоступна або її видалено.', { exact: true }).waitFor();
            await page.unroute(detailUrl);
            await page.route(detailUrl, route => route.abort('internetdisconnected'), { times: 1 });
            await page.reload();
            await dialog.getByRole('button', { name: 'Спробувати ще раз' }).click();
            await dialog.getByRole('heading', { name: `Task entry saved ${engine}` }).waitFor();
            await page.goto(origin + '/tasks');
            assert.equal(new URL(page.url()).pathname, '/tasks');
            // WebKit reports an unrelated timer's cancelled fetch as a page error during
            // the deliberate navigation/network failure matrix. Keep every other error fatal.
            const unexpected = errors.filter(message => !(engine === 'webkit'
                && /\/api\/my-day\/timer due to access control checks\.$/.test(message)));
            if (unexpected.length !== errors.length) console.log('WebKit: recorded cancelled global-timer fetch during navigation.');
            assert.deepEqual(unexpected, []);
            assert.deepEqual(hermes, []);
            console.log(`Task entry ${engine}: legacy aliases, real login, reload/history, out-of-window edit/save/reschedule/completion, retry, errors, responsive dialog, no Hermes.`);
        } finally { await context.close(); await browser.close(); }
    }
}
module.exports = { verifyTaskEntry };
