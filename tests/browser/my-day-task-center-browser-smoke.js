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
        await page.locator('.park-composer-options').first().locator('summary').click();
        const owner = page.locator('#cabinetTaskOwner');
        await owner.waitFor();
        await owner.selectOption(String(primary.user.id));
        await page.locator('#cabinetCreateCoAssignee' + co.user.id).check();
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

        const packId = '83944057-542c-48fd-8762-2f65ba25f7a4';
        const packBody = { preset: 'cake_with_decor', title: 'Тестовий пакет', packId };
        const createPack = () => api('/api/tasks/operation-pack', { token: manager.token, body: packBody });
        const packs = await Promise.all([createPack(), createPack()]);
        assert.ok(packs[0].tasks.length > 1);
        assert.deepEqual(packs[0].tasks.map(task => task.id).sort(), packs[1].tasks.map(task => task.id).sort());
        await goto(page, '/profile?tab=myday&create=1&businessContext=event_genix');
        await page.locator('#cabinetTaskTitle').fill('Тестова основна задача');
        await page.getByRole('button', { name: '+ Ще задача', exact: true }).click();
        const extra = page.locator('.cabinet-extra-task');
        await extra.locator('[data-cabinet-extra-title]').fill('Тестова додаткова задача');
        await extra.locator('summary').click();
        await extra.locator('[data-extra-priority]').selectOption('urgent');
        await extra.locator('[data-extra-undated]').check();
        await page.locator('[data-cabinet-create-action="plain"]').click();
        await page.waitForFunction(() => document.querySelector('#cabinetTaskTitle')?.value === '');
        const { rows: batch } = await db.query(`SELECT title, date, priority FROM tasks
            WHERE title = ANY($1::text[]) ORDER BY id`, [['Тестова основна задача', 'Тестова додаткова задача']]);
        assert.deepEqual(batch, [
            { title: 'Тестова основна задача', date: today, priority: 'normal' },
            { title: 'Тестова додаткова задача', date: null, priority: 'urgent' }
        ]);

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
        await page.locator('#cabinetTaskOwner').selectOption(String(primary.user.id));
        const collaborationTitle = 'Уточнити умови співпраці';
        await page.locator('#cabinetTaskTitle').fill(collaborationTitle);
        await page.evaluate(() => rerenderCabinetTaskTabs());
        assert.equal(await page.locator('#cabinetTaskTitle').inputValue(), collaborationTitle);
        assert.equal(await page.locator('#cabinetTaskOwner').inputValue(), String(primary.user.id));
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
