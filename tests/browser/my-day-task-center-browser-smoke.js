'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const requirePlaywright = require('../helpers/playwright');

async function run() {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const origin = assertSafeIsolatedTestUrl(process.env.TEST_URL).origin;
    const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
    const browser = await requirePlaywright().chromium.launch({
        executablePath: process.env.TASK_CENTER_BROWSER_EXECUTABLE || undefined
    });
    const evidence = path.resolve('output/qa/task-center');
    fs.mkdirSync(evidence, { recursive: true });
    const prefix = 'Тест задач';
    const pages = [];
    async function api(endpoint, { token, body, method = body ? 'POST' : 'GET', business = 'event_genix' } = {}) {
        const response = await fetch(origin + endpoint, {
            method,
            headers: { 'content-type': 'application/json', 'x-business-context': business,
                ...(token && { authorization: 'Bearer ' + token }) },
            ...(body && { body: JSON.stringify(body) })
        });
        assert.ok(response.ok, `${method} ${endpoint}: ${response.status} ${response.statusText}`);
        return response.json();
    }
    async function login(username, password) {
        return api('/api/auth/login', { body: { username, password } });
    }
    async function createUser(manager, label) {
        const username = 'task_qa_' + randomBytes(4).toString('hex');
        const password = 'Local-' + randomBytes(16).toString('hex');
        await api('/api/users', { token: manager.token, body: {
            username, password, name: label, role: 'instructor',
            businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix',
            actionAllowlist: [], actionDenylist: []
        } });
        return login(username, password);
    }
    async function newPage(session) {
        const context = await browser.newContext({
            viewport: { width: 360, height: 900 }, timezoneId: 'America/Los_Angeles',
            colorScheme: 'dark', serviceWorkers: 'block'
        });
        await context.route('https://**/*', route => route.abort());
        await context.addInitScript(session => {
            for (const [key, value] of Object.entries({
                pzp_token: session.token,
                pzp_access_token: session.token,
                pzp_current_user: JSON.stringify(session.user),
                pzp_crm_business_context: 'event_genix',
                pzp_dark_mode: 'true'
            })) if (!localStorage.getItem(key)) localStorage.setItem(key, value);
        }, session);
        const page = await context.newPage();
        page.setDefaultTimeout(18000);
        page.on('pageerror', error => console.error('Page error:', error.message));
        pages.push(page);
        return page;
    }
    const goto = (page, endpoint) => page.goto(origin + endpoint, { waitUntil: 'domcontentloaded' });
    const layout = async (page, selector, name) => {
        for (const width of [360, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForFunction(() => window.scrollY === 0);
            assert.equal(await page.evaluate(selector => {
                const content = document.querySelector(selector);
                return !!content && content.scrollWidth <= content.clientWidth + 1
                    && document.documentElement.scrollWidth <= innerWidth + 1;
            }, selector), true, name + ' overflows at ' + width);
            await page.screenshot({ path: path.join(evidence, name + '-dark-' + width + '.png'), animations: 'disabled' });
        }
    };

    try {
        const manager = await login(process.env.TEST_USER, process.env.TEST_PASS);
        const primary = await createUser(manager, 'Тестовий виконавець');
        const co = await createUser(manager, 'Тестовий співвиконавець');
        const page = await newPage(manager);
        const today = (await api('/api/tasks/my-cabinet', { token: manager.token })).meta.calendar.today;
        const delegatedTitle = prefix + ' · Підготувати зал';
        await db.query(`INSERT INTO tasks
            (title, status, workflow_state, business_context, owner_user_id, created_by_user_id, created_by, type, source_type, date)
            SELECT $1 || ' · Автоматична ' || n, 'todo', 'todo', 'event_genix', $2::int, NULL, 'rule_engine', 'auto', 'booking', NULL
            FROM generate_series(1, 104) n
            UNION ALL SELECT $1 || ' · Чернетка AI', 'todo', 'todo', 'event_genix', $2::int, $3::int, 'qa', 'manual', 'ai_draft', NULL
            UNION ALL SELECT $1 || ' · Інший бізнес', 'todo', 'todo', 'dar', $2, NULL, 'system', 'recurring', 'recurring', NULL
            UNION ALL SELECT $1 || ' · Прострочена', 'todo', 'todo', 'event_genix', $3, $3, 'qa', 'manual', 'manual', ($4::date - 2)::text`,
        [prefix, primary.user.id, manager.user.id, today]);
        await db.query(`INSERT INTO tasks
            (title, status, business_context, owner_user_id, created_by_user_id, visibility, date, scheduled_start_at)
            VALUES ($1, 'todo', 'event_genix', $2, $2, 'team', NULL, $3::date::timestamp AT TIME ZONE 'Europe/Kyiv'),
                   ($4, 'todo', 'event_genix', $2, $2, 'private', NULL, NULL)`,
        [prefix + ' · Початок доби', manager.user.id, today, prefix + ' · Приватна']);
        const { rows: [observed] } = await db.query(`INSERT INTO tasks
            (title, status, business_context, owner_user_id, created_by_user_id, visibility, date)
            VALUES ($1, 'todo', 'event_genix', $2, $2, 'private', $3) RETURNING id`,
        [prefix + ' · Спостереження', manager.user.id, today]);
        await db.query(`INSERT INTO task_observers (task_id, user_id, added_by, access_level)
            VALUES ($1, $2, $3, 'watch')`, [observed.id, co.user.id, manager.user.id]);

        await goto(page, '/tasks');
        const team = page.locator('.task-team-row');
        await team.first().waitFor();
        await page.getByRole('link', { name: '+ Нова задача', exact: true }).click();
        const title = page.locator('#cabinetTaskTitle');
        await title.waitFor();
        await page.waitForFunction(() => document.activeElement?.id === 'cabinetTaskTitle');
        assert.ok(await page.locator('.park-composer').evaluate(element => element.open));
        await title.fill(delegatedTitle);
        const assignment = page.locator('[data-cabinet-assignment]');
        await assignment.locator('summary').click();
        await assignment.locator('input[type="search"]').fill('Тестовий виконавець');
        await assignment.locator('[data-assignment-user="' + primary.user.id + '"]').click();
        const self = assignment.locator(`[data-assignment-user="${manager.user.id}"]`);
        const search = assignment.locator('input[type="search"]');
        await search.fill('Я');
        await page.waitForResponse(response => new URL(response.url()).pathname === '/api/tasks/owners'
            && new URL(response.url()).searchParams.get('q') === 'Я');
        await assignment.screenshot({ path: path.join(evidence, 'assignee-self-search-360.png'), animations: 'disabled' });
        await self.click();
        assert.equal(await self.getAttribute('aria-pressed'), 'true');
        await assignment.getByRole('button', { name: 'Відповідальний: Тестовий виконавець', exact: true }).waitFor();
        await assignment.screenshot({ path: path.join(evidence, 'assignee-author-co-360.png'), animations: 'disabled' });
        await self.click();
        await assignment.locator(`[data-assignment-user="${primary.user.id}"]`).click();
        await assignment.locator('summary').getByText('Кому · Оберіть виконавця').waitFor();
        await assignment.screenshot({ path: path.join(evidence, 'assignee-empty-360.png'), animations: 'disabled' });
        const rejectedRequests = [];
        const captureRejectedRequest = request => {
            if (new URL(request.url()).pathname === '/api/tasks' && request.method() === 'POST') rejectedRequests.push(request);
        };
        page.on('request', captureRejectedRequest);
        await page.locator('#cabinetTaskComposer').evaluate(form => form.requestSubmit());
        await page.locator('#cabinetTaskComposerStatus.error').getByText('Оберіть виконавця.').waitFor();
        page.off('request', captureRejectedRequest);
        assert.equal(rejectedRequests.length, 0);
        await search.fill('Тестовий виконавець');
        await assignment.locator(`[data-assignment-user="${primary.user.id}"]`).click();
        await assignment.locator('input[type="search"]').fill('Тестовий співвиконавець');
        await assignment.locator('[data-assignment-user="' + co.user.id + '"]').click();
        await assignment.screenshot({ path: path.join(evidence, 'assignee-picker-360.png'), animations: 'disabled' });
        await assignment.locator('input[type="search"]').press('Escape');
        const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tasks'
            && response.request().method() === 'POST');
        await page.locator('#cabinetTaskComposer').evaluate(form => {
            form.requestSubmit();
            form.requestSubmit();
        });
        const response = await created;
        assert.equal(response.ok(), true);
        const { task } = await response.json();
        const id = task.id;
        await db.query("INSERT INTO task_subtasks (task_id, title, is_done) VALUES ($1, 'Тестовий пункт', true)", [id]);
        await page.locator('[data-profile-control-shortcut]').click();
        await page.getByText(delegatedTitle, { exact: true }).waitFor();

        const primaryPage = await newPage(primary);
        const coPage = await newPage(co);
        await Promise.all([goto(primaryPage, '/profile?tab=myday'), goto(coPage, '/profile?tab=myday')]);
        const card = target => target.locator(`.park-task-card[data-task-id="${id}"]`);
        await Promise.all([card(primaryPage).waitFor(), card(coPage).waitFor()]);
        const observer = coPage.locator(`.park-task-card[data-task-id="${observed.id}"]`);
        await observer.waitFor();
        assert.equal(await observer.getByRole('button', { name: 'Виконати' }).count(), 0);
        assert.equal(await coPage.getByText(prefix + ' · Приватна', { exact: true }).count(), 0);
        const complete = coPage.waitForResponse(response => new URL(response.url()).pathname === `/api/tasks/${id}/complete`);
        await card(coPage).getByRole('button', { name: 'Виконати', exact: true }).click();
        assert.ok((await complete).ok());
        await card(coPage).waitFor({ state: 'hidden' });
        for (const session of [manager, primary, co]) {
            const detail = await api(`/api/tasks/${id}`, { token: session.token });
            assert.equal((detail.task || detail).status, 'done');
        }
        await Promise.all([page, primaryPage, coPage].map(async target => {
            await goto(target, `/profile?tab=myday&open=${id}&businessContext=event_genix`);
            const detail = target.locator('.park-task-dialog[open]');
            await detail.getByRole('heading', { name: delegatedTitle }).waitFor();
            await detail.getByText('Виконано', { exact: true }).waitFor();
        }));
        const doneAgain = await fetch(origin + `/api/tasks/${id}/complete`, {
            method: 'POST', headers: { authorization: 'Bearer ' + co.token, 'content-type': 'application/json',
                'x-business-context': 'event_genix' }, body: '{}'
        });
        assert.ok(doneAgain.status < 500);
        const state = await db.query(`SELECT
            (SELECT COUNT(*)::int FROM tasks WHERE title = $1) AS tasks,
            (SELECT COUNT(*)::int FROM task_action_history WHERE task_id = $2 AND action_type = 'task_completed') AS completions`,
        [delegatedTitle, id]);
        assert.deepEqual(state.rows[0], { tasks: 1, completions: 1 });

        const automatic = await api(`/api/tasks?view=team&automatic=1&owner_user_id=${primary.user.id}&pagination=1&limit=100`, { token: manager.token });
        assert.equal(automatic.pagination.total, 104);
        assert.equal(automatic.tasks.length, 100);
        assert.ok(automatic.tasks.every(item => item.is_automatic && item.business_context === 'event_genix'));
        const other = await api(`/api/tasks?view=team&automatic=1&owner_user_id=${primary.user.id}&pagination=1`, { token: manager.token, business: 'dar' });
        assert.equal(other.pagination.total, 1);
        const todayList = await api('/api/tasks?view=today&pagination=1', { token: manager.token });
        assert.ok(todayList.tasks.some(task => task.title === prefix + ' · Початок доби'));
        assert.ok(todayList.tasks.every(task => !task.title.includes('Автоматична ')));

        await goto(page, '/tasks');
        await page.locator('.task-team-row').first().waitFor();
        await page.locator('[data-task-center-query="ownerUserId"]').selectOption(String(primary.user.id));
        await page.getByRole('button', { name: 'Автоматичні', exact: true }).click();
        await page.locator('.task-team-heading').getByText('· 104').waitFor();
        assert.equal(await team.count(), 100);
        await page.getByRole('button', { name: /Завантажити ще/ }).click();
        await page.waitForFunction(() => document.querySelectorAll('.task-team-row').length === 104);
        await layout(page, '.task-team-list', 'task-center');
        const more = team.first().getByRole('button', { name: 'Більше дій' });
        await more.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: 'Редагувати', exact: true }).first().waitFor();
        await page.keyboard.press('Escape');
        await team.first().locator('.task-team-title').click();
        const filteredTask = page.locator('.park-task-dialog[open]');
        await filteredTask.locator('h2').waitFor();
        await filteredTask.getByRole('button', { name: 'Закрити', exact: true }).click();
        await page.locator('.task-team-heading').getByText('· 104').waitFor();

        const taskListPattern = '**/api/tasks?**';
        await page.route(taskListPattern, route => route.fulfill({ status: 503, body: '{}' }), { times: 1 });
        await page.getByRole('button', { name: 'Прострочені', exact: true }).click();
        await page.getByRole('button', { name: 'Повторити', exact: true }).click();
        await page.getByText('Немає доступних задач за цими умовами.').waitFor();

        await goto(page, `/tasks.html?highlight=${id}&businessContext=event_genix`);
        const dialog = page.locator('.park-task-dialog[open]');
        await dialog.getByRole('heading', { name: delegatedTitle }).waitFor();
        await dialog.getByText('Чекліст', { exact: true }).click();
        await dialog.getByText('Тестовий пункт · Виконано', { exact: true }).waitFor();
        await dialog.getByText('Історія', { exact: true }).click();
        await dialog.locator('[data-task-history-content] li').first().waitFor();
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });

        await goto(page, '/profile?tab=myday');
        await page.getByText(prefix + ' · Початок доби', { exact: true }).waitFor();
        await page.getByText('Прострочено: 2 дн.', { exact: true }).first().waitFor();
        assert.equal(await page.locator('.park-undated').evaluate(element => element.open), false);
        await page.locator('.park-undated > summary').click();
        await page.getByText(prefix + ' · Приватна', { exact: true }).waitFor();
        await page.locator('.park-undated > summary').click();
        await page.locator('.park-composer').evaluate(element => { element.open = false; });
        await layout(page, '#myDayDayPanel', 'my-day');
        await page.evaluate(() => localStorage.setItem('pzp_dark_mode', 'false'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByText(prefix + ' · Початок доби', { exact: true }).waitFor();
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
        await goto(page, '/tasks');
        await team.first().waitFor();
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
        await page.evaluate(() => openManualTaskComposer({
            businessContext: 'dar', sourceType: 'lead', sourceId: '101', sourceLabel: 'Лід',
            title: 'Тестова дія з ліда', date: 'undated', priority: 'high'
        }));
        await page.locator('#cabinetTaskTitle').waitFor();
        await page.waitForFunction(() => document.querySelector('#cabinetTaskTitle').value === 'Тестова дія з ліда');
        const createPattern = /\/api\/tasks(?:\?|$)/;
        let firstKey;
        const loseCreateResponse = async route => {
            if (route.request().method() !== 'POST' || firstKey) return route.continue();
            const reply = await route.fetch();
            assert.ok(reply.ok());
            firstKey = route.request().headers()['idempotency-key'];
            await route.abort('connectionreset');
        };
        await page.route(createPattern, loseCreateResponse);
        await page.locator('[data-cabinet-create-action="plain"]').click();
        await page.locator('#cabinetTaskComposerStatus.error').waitFor();
        const retry = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tasks'
            && response.request().method() === 'POST');
        await page.locator('[data-cabinet-create-action="plain"]').click();
        const replay = await retry;
        assert.ok(replay.ok());
        assert.ok(firstKey);
        assert.equal(replay.request().headers()['idempotency-key'], firstKey);
        const { rows: linked } = await db.query(`SELECT source_type, source_id, source_entity_type, date, priority, business_context
            FROM tasks WHERE title = 'Тестова дія з ліда'`);
        assert.deepEqual(linked, [{ source_type: 'lead', source_id: '101', source_entity_type: 'lead',
            date: null, priority: 'high', business_context: 'dar' }]);

        const bookingId = 'qa-task-handoff-' + randomBytes(4).toString('hex');
        const roomId = bookingId + '-room';
        await db.query(`INSERT INTO timeline_resources (business_context, resource_id, type, name)
            VALUES ('event_genix', $1, 'cabinet', 'Тестова кімната')`, [roomId]);
        await db.query(`INSERT INTO bookings (id, date, time, line_id, business_context, room, room_resource_id)
            VALUES ($1, $2, '12:00', 'qa-task-handoff', 'event_genix', 'Тестова кімната', $3)`, [bookingId, today, roomId]);
        const bookingTitle = 'Тестова задача з бронювання';
        await page.evaluate(({ bookingId, bookingTitle, ownerUserId, today }) => openManualTaskComposer({
            businessContext: 'event_genix', sourceType: 'booking', sourceId: bookingId,
            sourceLabel: 'Бронювання', title: bookingTitle, ownerUserId, date: today, time: '12:00'
        }), { bookingId, bookingTitle, ownerUserId: primary.user.id, today });
        await page.locator('[data-cabinet-create-context]').filter({ hasText: 'Джерело:' }).waitFor();
        await page.locator('[data-cabinet-assignment] summary').filter({ hasText: 'Тестовий виконавець' }).waitFor();
        const bookingCreate = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tasks'
            && response.request().method() === 'POST');
        await page.locator('[data-cabinet-create-action="plain"]').click();
        assert.ok((await bookingCreate).ok());
        const { rows: bookingTasks } = await db.query(`SELECT source_type, source_id, source_entity_type, source_entity_id,
            owner_user_id, date, business_context FROM tasks WHERE title = $1`, [bookingTitle]);
        assert.deepEqual(bookingTasks, [{ source_type: 'booking', source_id: bookingId, source_entity_type: 'booking',
            source_entity_id: bookingId, owner_user_id: primary.user.id, date: today, business_context: 'event_genix' }]);

        const packId = '83944057-542c-48fd-8762-2f65ba25f7a4';
        const packBody = { preset: 'cake_with_decor', title: 'Тестовий пакет', packId };
        const createPack = () => api('/api/tasks/operation-pack', { token: manager.token, body: packBody });
        const packs = await Promise.all([createPack(), createPack()]);
        assert.ok(packs[0].tasks.length > 1);
        assert.deepEqual(packs[0].tasks.map(task => task.id).sort(), packs[1].tasks.map(task => task.id).sort());
        await goto(page, '/profile?tab=myday&create=1&businessContext=event_genix');
        const pack = page.locator('[data-cabinet-operation-pack]');
        await pack.locator('summary').click();
        await pack.locator('[name="preset"]').selectOption('cake_with_decor');
        await pack.locator('[name="title"]').fill('Тестовий пакет із форми');
        await pack.locator('[name="sourceType"]').selectOption('booking');
        await pack.locator('[name="sourceId"]').fill(bookingId);
        const packPattern = /\/api\/tasks\/operation-pack(?:\?|$)/;
        const packRequests = [];
        await page.route(packPattern, async route => {
            packRequests.push(route.request().postDataJSON());
            if (packRequests.length > 1) return route.continue();
            assert.ok((await route.fetch()).ok());
            await route.abort('connectionreset');
        });
        await pack.getByRole('button', { name: 'Створити пакет' }).click();
        await pack.locator('[data-operation-pack-status]').filter({ hasText: /.+/ }).waitFor();
        const packRetry = page.waitForResponse(packPattern);
        await pack.getByRole('button', { name: 'Створити пакет' }).click();
        const packResponse = await packRetry;
        assert.ok(packResponse.ok());
        assert.deepEqual(packRequests[0], packRequests[1]);
        const retriedPack = await packResponse.json();
        const { rows: [packRows] } = await db.query(`SELECT COUNT(*)::int AS count, BOOL_AND(source_entity_id = $2) AS linked
            FROM tasks WHERE pack_id = $1`, [retriedPack.packId, bookingId]);
        assert.deepEqual(packRows, { count: retriedPack.tasks.length, linked: true });
        await page.unroute(packPattern);
        await page.locator('#cabinetTaskTitle').fill('Тестова основна задача');
        assert.equal(await page.getByRole('button', { name: '+ Ще задача', exact: true }).count(), 0);
        await page.locator('#cabinetTaskDate').fill('');
        await page.locator('[data-cabinet-create-action="plain"]').click();
        await page.waitForFunction(() => document.querySelector('#cabinetTaskTitle')?.value === '');
        const { rows: directTasks } = await db.query('SELECT date FROM tasks WHERE title = $1', ['Тестова основна задача']);
        assert.deepEqual(directTasks, [{ date: null }]);

        const createdLead = await api('/api/leads', { token: manager.token, body: { client_name: 'Тест співпраці' } });
        const leadId = (createdLead.lead || createdLead).id;
        assert.ok(leadId);
        const leadPage = `/sales-funnel?lead=${leadId}&businessContext=event_genix`;
        const leadApi = `/api/leads/${leadId}`;
        await goto(page, leadPage);
        await page.locator('#leadWorkspaceTab-details').click();
        await page.locator(`button[onclick="editLead(${leadId})"]`).click();
        await page.locator('#leadName').fill('Оновлений контакт співпраці');
        await page.locator('#leadLeadType').selectOption('collaboration');
        await page.locator('#leadModalSave').click();
        const collaborate = page.getByRole('button', { name: 'Оформити співпрацю', exact: true });
        await collaborate.waitFor();
        assert.equal(await page.locator('#cabinetTaskTime').inputValue(), '12:00');
        assert.equal(await page.locator('[data-cabinet-add-task]').isVisible(), false);
        await page.locator('[data-cabinet-assignment] summary').click();
        const selectedOwner = page.locator('[data-assignment-user="' + primary.user.id + '"]');
        await selectedOwner.click();
        const label = await selectedOwner.textContent();
        const collaborationTitle = 'Уточнити умови співпраці';
        await page.locator('#cabinetTaskTitle').fill(collaborationTitle);
        await page.evaluate(() => rerenderCabinetTaskTabs());
        assert.equal(await page.locator('#cabinetTaskTitle').inputValue(), collaborationTitle);
        assert.ok((await page.locator('[data-cabinet-assignment] summary').textContent()).includes(label));
        const collaborationRequests = [];
        await page.route('**' + leadApi + '/collaboration-task', async route => {
            collaborationRequests.push(route.request().postDataJSON());
            if (collaborationRequests.length > 1) return route.continue();
            assert.ok((await route.fetch()).ok());
            return route.abort('connectionreset');
        });
        await page.route('**' + leadApi, route => route.request().method() === 'PATCH'
            ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
            : route.continue(), { times: 1 });
        await collaborate.click();
        await page.locator('#cabinetTaskComposerStatus.error').waitFor();
        assert.equal(await page.locator('#cabinetTaskTitle').isDisabled(), true);
        assert.equal(await selectedOwner.isDisabled(), true, 'the owner remains locked until the original request is resolved');
        const retriedCollaboration = page.waitForResponse(reply => new URL(reply.url()).pathname === leadApi + '/collaboration-task');
        await collaborate.click();
        const replayedCollaboration = await (await retriedCollaboration).json();
        assert.equal(replayedCollaboration.meta?.replayed, true);
        assert.deepEqual(collaborationRequests[0], collaborationRequests[1]);
        await page.getByText('Задачу створено. Повторіть збереження решти змін ліда.', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Зберегти зміни ліда', exact: true }).click();
        await page.waitForURL(origin + leadPage);
        assert.equal(collaborationRequests.length, 2);
        const { rows: collaborationLeads } = await db.query(
            'SELECT client_name, lead_type, pipeline_stage FROM leads WHERE id = $1', [leadId]);
        assert.deepEqual(collaborationLeads, [{ client_name: 'Оновлений контакт співпраці', lead_type: 'collaboration', pipeline_stage: 'contacted' }]);
        const { rows: collaborationTasks } = await db.query(`SELECT id, title, owner_user_id FROM tasks
            WHERE source_type = 'lead' AND source_id = $1 AND business_context = 'event_genix'`, [String(leadId)]);
        assert.deepEqual(collaborationTasks, [{ id: replayedCollaboration.task.id, title: collaborationTitle, owner_user_id: primary.user.id }]);
        const { rows: interactions } = await db.query(`SELECT COUNT(*)::int AS count FROM lead_interactions
            WHERE lead_id = $1 AND details->>'source' = 'leads.collaboration_task'`, [leadId]);
        assert.deepEqual(interactions, [{ count: 1 }]);
        await goto(page, '/profile?tab=myday&create=1&businessContext=event_genix');
        const authorTaskTitle = `${prefix} · Постановник співвиконавець`;
        await page.locator('#cabinetTaskTitle').fill(authorTaskTitle);
        const authorPicker = page.locator('[data-cabinet-assignment]');
        await authorPicker.locator('summary').click();
        const authorSearch = authorPicker.locator('input[type="search"]');
        await authorSearch.fill('Тестовий виконавець');
        await authorPicker.locator(`[data-assignment-user="${primary.user.id}"]`).click();
        await authorSearch.fill(manager.user.name || manager.user.username);
        await authorPicker.locator(`[data-assignment-user="${manager.user.id}"]`).click();
        const authorCreation = page.waitForResponse(res => new URL(res.url()).pathname === '/api/tasks' && res.request().method() === 'POST');
        await page.locator('#cabinetTaskComposer').evaluate(form => form.requestSubmit());
        const authorReply = await authorCreation;
        assert.ok(authorReply.ok());
        const { task: createdByCoAssignee } = await authorReply.json();
        const { rows: [assignmentIds] } = await db.query(`SELECT owner_user_id, created_by_user_id,
            ARRAY(SELECT user_id FROM task_co_assignees WHERE task_id = tasks.id) AS co_ids FROM tasks WHERE id = $1`, [createdByCoAssignee.id]);
        assert.deepEqual(assignmentIds, { owner_user_id: primary.user.id, created_by_user_id: manager.user.id, co_ids: [manager.user.id] });
        for (const session of [manager, primary]) {
            const detail = await api(`/api/tasks/${createdByCoAssignee.id}`, { token: session.token });
            const reopened = detail.task || detail;
            assert.equal(reopened.ownerUserId, primary.user.id);
            assert.deepEqual(reopened.co_assignee_user_ids, [manager.user.id]);
        }
        await goto(page, '/tasks?view=team');
        const authorSearchReply = page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === '/api/tasks' && url.searchParams.get('search') === authorTaskTitle;
        });
        await page.locator('[data-task-center-query="search"]').fill(authorTaskTitle);
        assert.ok((await authorSearchReply).ok());
        const selfAssignedRow = page.locator('.task-team-row').filter({ hasText: authorTaskTitle });
        await selfAssignedRow.getByText('Я поставив · Співвиконавець', { exact: true }).waitFor();
        await page.waitForFunction(() => document.querySelectorAll('.task-team-row').length === 1);
        await Promise.all([
            page.waitForURL(url => url.pathname === '/profile' && Number(url.searchParams.get('open')) === createdByCoAssignee.id),
            selfAssignedRow.getByRole('button', { name: authorTaskTitle, exact: true }).click()
        ]);
        const reopenedDialog = page.locator('.park-task-dialog[open]');
        await reopenedDialog.getByText('Постановник · Співвиконавець', { exact: true }).waitFor();
        await reopenedDialog.getByText('Тестовий виконавець', { exact: true }).waitFor();
        await reopenedDialog.getByText('Я', { exact: true }).waitFor();
        await reopenedDialog.screenshot({ path: path.join(evidence, 'assignee-author-reopened-360.png'), animations: 'disabled' });

        const shiftDate = '2099-11-26';
        const previousShiftDate = '2099-11-25';
        const staffShifts = [
            [primary, 'Тестовий адміністратор А', previousShiftDate, '22:00', '06:00'],
            [co, 'Тестовий адміністратор Б', shiftDate, '09:00', '18:00'],
            [manager, 'Тестова рецепція', shiftDate, '09:00', '18:00', 'reception', 'reception']
        ];
        for (const [session, name, date, start, end, role = 'admin', position = 'Адміністратор зміни'] of staffShifts) {
            const { rows: [staff] } = await db.query(`INSERT INTO staff (name, department, position, role_type)
                VALUES ($1, $2, $3, $2) RETURNING id`, [name, role, position]);
            await db.query(`INSERT INTO employee_profiles (staff_id, user_id, full_name, is_active)
                VALUES ($1, $2, $3, true) ON CONFLICT (user_id) WHERE user_id IS NOT NULL
                DO UPDATE SET staff_id = excluded.staff_id, is_active = true`, [staff.id, session.user.id, name]);
            await db.query(`INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status)
                VALUES ($1, $2, $3, $4, 'working')`, [staff.id, date, start, end]);
            const { rows: [shift] } = await db.query(`INSERT INTO hr_shifts
                (staff_id, shift_date, profession_key, planned_start, planned_end)
                VALUES ($1, $2, $3, $4, $5) RETURNING id`, [staff.id, date, role, start, end]);
            await db.query(`INSERT INTO hr_shift_segments
                (hr_shift_id, profession_key, planned_start, planned_end, start_day_offset, end_day_offset)
                VALUES ($1, $2, $3, $4, NULL, NULL)`, [shift.id, role, start, end]);
        }
        const schedule = await api(`/api/staff/schedule?from=${previousShiftDate}&to=${shiftDate}`, { token: manager.token });
        assert.ok(schedule.data.some(entry => entry.status === 'working' && entry.role_type === 'admin'));
        const shiftGroups = await api(`/api/tasks/shift-assignees?date=${shiftDate}`, { token: manager.token });
        const administrators = shiftGroups.groups.find(group => group.key === 'admin.administrators');
        assert.ok(administrators, 'Staff schedule has a working administrator shift, but the assignment picker has no administrators');
        assert.deepEqual(administrators.users.map(user => user.id).sort((a, b) => a - b),
            [primary.user.id, co.user.id].sort((a, b) => a - b));
        const directory = await api('/api/tasks/owners?q=' + encodeURIComponent('Адміністратор зміни'), { token: manager.token });
        assert.ok(directory.users.some(person => person.id === primary.user.id && person.position === 'Адміністратор зміни'));
        const localizedDirectory = await api(`/api/tasks/owners?q=${encodeURIComponent('Адміністрація')}`, { token: manager.token });
        assert.equal(localizedDirectory.users.find(person => person.id === primary.user.id)?.departmentLabel, 'Адміністрація');
        const selfDirectory = await api(`/api/tasks/owners?q=${encodeURIComponent('Я')}`, { token: manager.token });
        assert.ok(selfDirectory.users.some(person => person.id === manager.user.id));
        const { rows: [missingPrimary] } = await db.query(`INSERT INTO tasks
            (title, status, workflow_state, visibility, task_mode, business_context)
            VALUES ('Тест без головного відповідального', 'todo', 'todo', 'team', 'work', 'event_genix') RETURNING id`);
        await db.query('INSERT INTO task_co_assignees (task_id, user_id, added_by) VALUES ($1, $2, $3)',
            [missingPrimary.id, co.user.id, manager.user.id]);
        const unassigned = await api('/api/tasks?view=team&unassigned=1&pagination=1&search='
            + encodeURIComponent('Тест без головного відповідального'), { token: manager.token });
        assert.equal(unassigned.pagination.total, 1);
        assert.equal(unassigned.tasks[0].id, missingPrimary.id);
        await goto(page, '/profile?tab=myday&create=1&businessContext=event_genix');
        await page.setViewportSize({ width: 360, height: 900 });
        await page.locator('#cabinetTaskTitle').fill('Тестова задача адміністраторам зміни');
        const shiftPicker = page.locator('[data-cabinet-assignment]');
        await shiftPicker.locator('summary').click();
        await page.route(url => url.pathname === '/api/tasks/shift-assignees' && url.searchParams.get('date') === shiftDate, async route => {
            const response = await route.fetch();
            await new Promise(resolve => setTimeout(resolve, 350));
            await route.fulfill({ response });
        }, { times: 1 });
        await shiftPicker.evaluate(picker => {
            const search = picker.querySelector('input[type="search"]');
            search.value = 'Тестовий виконавець';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            picker.querySelector('[data-assignment-shift-mode]').click();
        });
        await shiftPicker.getByLabel('Дата зміни').fill(shiftDate);
        await shiftPicker.locator('option[value="admin.administrators"]').waitFor({ state: 'attached' });
        await shiftPicker.locator('#cabinetShiftGroup').selectOption('admin.administrators');
        await shiftPicker.getByRole('button', { name: 'Підтвердити склад' }).click();
        await shiftPicker.getByText('Зміна підтверджена. За потреби позначте іншого відповідального.', { exact: true }).waitFor();
        assert.equal(await shiftPicker.locator('[data-assignment-user][aria-pressed="true"]').count(), 2);
        await shiftPicker.screenshot({ path: path.join(evidence, 'shift-assignment-360.png'), animations: 'disabled' });
        await shiftPicker.locator('#cabinetShiftGroup').selectOption('reception');
        await shiftPicker.screenshot({ path: path.join(evidence, 'shift-assignment-reconfirm-360.png'), animations: 'disabled' });
        page.on('request', captureRejectedRequest);
        await page.locator('#cabinetTaskComposer').evaluate(form => form.requestSubmit());
        await page.locator('#cabinetTaskComposerStatus.error').getByText('Підтвердьте склад зміни перед створенням задачі.').waitFor();
        page.off('request', captureRejectedRequest);
        assert.equal(rejectedRequests.length, 0);
        await shiftPicker.getByRole('button', { name: 'Підтвердити склад' }).click();
        assert.deepEqual(await shiftPicker.locator('[data-assignment-user][aria-pressed="true"]').evaluateAll(rows =>
            rows.map(row => Number(row.dataset.assignmentUser))), [manager.user.id]);
        await shiftPicker.getByLabel('Дата зміни').fill(previousShiftDate);
        await shiftPicker.locator('summary').getByText('Кому · Підтвердьте склад зміни').waitFor();
        await shiftPicker.getByLabel('Дата зміни').fill(shiftDate);
        await shiftPicker.locator('option[value="reception"]').waitFor({ state: 'attached' });
        await shiftPicker.locator('#cabinetShiftGroup').selectOption('admin.administrators');
        await shiftPicker.getByRole('button', { name: 'Підтвердити склад' }).click();
        const shiftCreated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tasks'
            && response.request().method() === 'POST');
        await page.locator('[data-cabinet-create-action="plain"]').click();
        const shiftResponse = await shiftCreated;
        assert.ok(shiftResponse.ok(), JSON.stringify(await shiftResponse.json()));
        const shiftTask = (await shiftResponse.json()).task;
        const { rows: shiftAssignments } = await db.query('SELECT user_id FROM task_co_assignees WHERE task_id = $1', [shiftTask.id]);
        assert.deepEqual([shiftTask.ownerUserId, ...shiftAssignments.map(row => row.user_id)].sort((a, b) => a - b),
            [primary.user.id, co.user.id].sort((a, b) => a - b));
        const captured = shiftResponse.request();
        const body = captured.postDataJSON();
        assert.equal(body.shiftAssignment.group, 'admin.administrators');
        const originalKey = captured.headers()['idempotency-key'];
        assert.ok(originalKey);
        await db.query(`UPDATE staff_schedule SET status = 'dayoff'
            WHERE date = $1 AND staff_id = (SELECT staff_id FROM employee_profiles WHERE user_id = $2)`, [shiftDate, co.user.id]);
        const submitShift = (key, requestBody) => fetch(origin + '/api/tasks', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'idempotency-key': key,
                'x-business-context': 'event_genix', authorization: 'Bearer ' + manager.token },
            body: JSON.stringify(requestBody)
        });
        const replayedShift = await submitShift(originalKey, body);
        assert.equal(replayedShift.status, 200);
        assert.equal((await replayedShift.json()).task.id, shiftTask.id);
        const staleShift = await submitShift(randomBytes(16).toString('hex'), { ...body, title: 'Тест застарілого складу' });
        assert.equal(staleShift.status, 409);
        assert.equal((await staleShift.json()).code, 'TASK_SHIFT_ROSTER_CHANGED');

        const searchSeed = randomBytes(5).toString('hex');
        const sameName = `Тестовий каталог ${searchSeed}`;
        const { rows: directoryUsers } = await db.query(`INSERT INTO users (username, password_hash, role, name)
            SELECT $1 || '_' || value, 'disabled-test-login', 'instructor', $2 FROM generate_series(1, 201) value
            RETURNING id, username`, [`task_dir_${searchSeed}`, sameName]);
        const directoryIds = directoryUsers.map(user => user.id);
        await db.query(`INSERT INTO organization_memberships (organization_id, user_id, role)
            SELECT organization_id, candidate, 'member' FROM organization_memberships
            CROSS JOIN unnest($2::int[]) AS candidate WHERE user_id = $1 AND is_active ON CONFLICT DO NOTHING`,
        [primary.user.id, directoryIds]);
        await db.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role)
            SELECT business_id, organization_id, candidate, 'instructor' FROM business_memberships
            CROSS JOIN unnest($2::int[]) AS candidate WHERE user_id = $1 AND is_active ON CONFLICT DO NOTHING`,
        [primary.user.id, directoryIds]);
        const directoryUrl = `/api/tasks/owners?q=${encodeURIComponent(sameName)}`;
        const firstPage = await api(directoryUrl, { token: manager.token });
        assert.equal(firstPage.users.length, 200);
        assert.ok(firstPage.nextAfter);
        const lastPage = await api(`${directoryUrl}&after=${firstPage.nextAfter}`, { token: manager.token });
        assert.deepEqual([...firstPage.users, ...lastPage.users].map(user => user.id), directoryIds.sort((a, b) => a - b));
        assert.equal(lastPage.nextAfter, null);
        const restrictedDirectory = await fetch(origin + directoryUrl, { headers: {
            authorization: 'Bearer ' + primary.token, 'x-business-context': 'event_genix'
        } });
        assert.ok(restrictedDirectory.status === 403 || (restrictedDirectory.ok && (await restrictedDirectory.json()).users.length === 0));
        await goto(page, '/profile?tab=myday&create=1&businessContext=event_genix');
        await page.setViewportSize({ width: 1440, height: 900 });
        const directoryPicker = page.locator('[data-cabinet-assignment]');
        await directoryPicker.locator('summary').click();
        await directoryPicker.getByRole('searchbox').fill(sameName);
        const firstMatch = directoryPicker.locator(`[data-assignment-user="${directoryUsers[0].id}"]`);
        await firstMatch.getByText(directoryUsers[0].username, { exact: true }).waitFor();
        await firstMatch.click();
        await directoryPicker.getByRole('button', { name: 'Показати ще' }).click();
        const lastMatch = directoryPicker.locator(`[data-assignment-user="${lastPage.users[0].id}"]`);
        await lastMatch.click();
        assert.equal(await firstMatch.getAttribute('aria-pressed'), 'true');
        assert.equal(await lastMatch.getAttribute('aria-pressed'), 'true');
        await firstMatch.click();
        assert.equal(await lastMatch.getAttribute('aria-pressed'), 'true');
        await directoryPicker.getByRole('button', { name: `Відповідальний: ${sameName}`, exact: true }).waitFor();
        const olderQuery = url => url.pathname === '/api/tasks/owners' && url.searchParams.get('q') === sameName;
        const delayedStarted = Promise.withResolvers();
        const delayedRelease = Promise.withResolvers();
        await page.route(olderQuery, async route => {
            delayedStarted.resolve();
            await delayedRelease.promise;
            await route.continue();
        }, { times: 1 });
        const directorySearch = directoryPicker.getByRole('searchbox');
        await directorySearch.fill('');
        await directorySearch.fill(sameName);
        await delayedStarted.promise;
        await directorySearch.fill('Я');
        await directoryPicker.locator(`[data-assignment-user="${manager.user.id}"]`).waitFor();
        const olderFinished = page.waitForResponse(response => olderQuery(new URL(response.url())));
        delayedRelease.resolve();
        await (await olderFinished).finished();
        assert.equal(await firstMatch.count(), 0);
        await directorySearch.clear();
        await directoryPicker.locator(`[data-assignment-user="${primary.user.id}"]`).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        console.log('Task Center and My Day acceptance passed (Chromium, PostgreSQL, dark 360/1440 and light).');
    } catch (error) {
        await Promise.all(pages.map((page, index) => page.screenshot({
            path: path.join(evidence, 'failure-' + index + '.png'), timeout: 3000
        }).catch(() => {})));
        throw error;
    } finally {
        await browser.close();
        await db.end();
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
