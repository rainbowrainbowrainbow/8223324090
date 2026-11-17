'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { requirePlaywright } = require('./timeline-room-summary-browser-smoke');
const { verifyLocales, verifySalary, verifySettings } = require('./profile-cleanup-checks');
const { benchmark } = require('./my-day-cleanup-benchmark');

async function run() {
    assert.equal(process.env.RUN_MY_DAY_PARK_ACTUAL_BROWSER, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const origin = assertSafeIsolatedTestUrl(process.env.TEST_URL).origin;
    const response = await fetch(origin + '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: process.env.TEST_USER, password: process.env.TEST_PASS })
    });
    assert.equal(response.status, 200);
    const session = await response.json();
    assert.ok(session.token && session.user);

    const setup = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
    try {
        const existing = await setup.query('SELECT 1 FROM employee_profiles WHERE user_id = $1 AND is_active = true', [session.user.id]);
        if (!existing.rowCount) {
            const { rows: [staff] } = await setup.query(`
                INSERT INTO staff (name, department, position, role_type, is_active)
                VALUES ('Local QA Employee', 'QA', 'QA', 'animator', true) RETURNING id`);
            await setup.query(`
                INSERT INTO employee_profiles (user_id, staff_id, full_name, role, is_active)
                VALUES ($1, $2, 'Local QA Employee', 'animator', true)`, [session.user.id, staff.id]);
        }
    } finally {
        await setup.end();
    }

    if (process.env.TASK_ENTRY_ONLY === '1') {
        const evidence = path.resolve(__dirname, '../../output/qa');
        fs.mkdirSync(evidence, { recursive: true });
        await require('./task-entry-checks').verifyTaskEntry({ origin, session, evidence });
        return;
    }
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch();
    const evidence = path.resolve(__dirname, '../../output/qa');
    fs.mkdirSync(evidence, { recursive: true });
    try {
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            locale: 'uk-UA',
            timezoneId: 'Europe/Kyiv',
            serviceWorkers: 'block'
        });
        await context.route('https://**/*', route => route.abort());
        await context.addInitScript(session => {
            for (const [key, value] of Object.entries({
                pzp_token: session.token,
                pzp_access_token: session.token,
                pzp_current_user: JSON.stringify(session.user),
                pzp_crm_business_context: 'event_genix'
            })) if (!localStorage.getItem(key)) localStorage.setItem(key, value);
        }, session);
        if (process.env.MY_DAY_CLEANUP_BENCHMARK_ONLY === '1') {
            await benchmark(context, origin, session, evidence);
            return;
        }
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const pageErrors = [];
        const taskBoot = [];
        const gameRequests = [];
        const hermesRequests = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('console', message => {
            if (message.text().startsWith('[tasks:boot]')) taskBoot.push(message.text());
        });
        page.on('request', request => {
            const url = new URL(request.url());
            if (/(?:^|[.-])hermes(?:[.-]|$)/i.test(url.hostname) || /(?:^|\/)hermes(?:[/-]|$)/i.test(url.pathname)) {
                hermesRequests.push(url.pathname);
            }
            if (/^\/api\/(?:wallet|achievements|quests|gamification)(?:\/|$)/.test(url.pathname)) {
                gameRequests.push(url.pathname);
            }
        });
        await page.goto(origin + '/profile');
        const composer = page.locator('#cabinetTaskComposer');
        const titleInput = composer.locator('#cabinetTaskTitle');
        const mode = composer.locator('#cabinetTaskMode');
        const newTask = page.locator('.park-composer > summary');
        await page.locator('[data-park-period=today]').waitFor();
        await page.locator('[data-park-task-group=today]').getByText('На сьогодні задач немає.', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-park-my-day-notice]').innerText(), '');
        await context.setOffline(true);
        await page.locator('[data-park-my-day-notice]').getByText(/Немає з’єднання/).waitFor();
        assert.equal(await page.locator('[data-park-period=today]').isVisible(), true);
        await context.setOffline(false);
        await page.waitForFunction(() => document.querySelector('[data-park-my-day-notice]')?.textContent.trim() === '');
        const cabinetApi = url => url.pathname === '/api/tasks/my-cabinet'
            && url.searchParams.get('planningView') === 'my-day' && !url.searchParams.has('bucket');
        let finishSlowRequest;
        const pendingFailure = new Promise(resolve => { finishSlowRequest = resolve; });
        await page.route(cabinetApi, async route => {
            await pendingFailure;
            await route.fulfill({ status: 503, json: { error: 'QA load retry' } });
        }, { times: 1 });
        await page.reload({ waitUntil: 'domcontentloaded' });
        try {
            await page.locator('[data-park-my-day-notice]').getByText('Завантажую Мій день…', { exact: true }).waitFor();
        } finally {
            finishSlowRequest();
        }
        await page.locator('[data-cabinet-refresh]').click();
        await page.locator('[data-park-period=today]').waitFor();
        assert.equal(await page.locator('[data-park-my-day-notice]').innerText(), '');
        assert.equal(new URL(page.url()).searchParams.get('tab'), 'myday');
        assert.equal(await titleInput.isVisible(), false);
        await newTask.press('Enter');
        await titleInput.waitFor();
        assert.equal(await mode.inputValue(), 'work');
        assert.equal(await page.locator('[data-global-task-timer-panel-trigger]:visible').count(), 0);

        async function create(title, taskMode, { dayOffset = 0, priority = 'normal' } = {}) {
            await mode.selectOption(taskMode);
            if (priority !== 'normal') {
                const settings = composer.getByText('Параметри задачі', { exact: true });
                if (!(await composer.locator('#cabinetTaskPriority').isVisible())) await settings.click();
                await composer.locator('#cabinetTaskPriority').selectOption(priority);
            }
            if (dayOffset) {
                const date = await page.evaluate(offset => {
                    const day = new Date(`${window.TaskCreate.todayStr()}T12:00:00Z`);
                    day.setUTCDate(day.getUTCDate() + offset);
                    return day.toISOString().slice(0, 10);
                }, dayOffset);
                await composer.locator('#cabinetTaskDate').fill(date);
            }
            await titleInput.fill(title);
            const finished = page.waitForResponse(r => r.request().method() === 'POST'
                && new URL(r.url()).pathname === '/api/tasks');
            await composer.locator('button[type=submit]').click();
            const mutation = await finished;
            assert.ok(mutation.ok(), 'task creation failed: ' + mutation.status());
            await page.locator('#cabinetTaskComposer[data-cabinet-create-busy="false"] #cabinetTaskComposerStatus.success').waitFor();
            const body = await mutation.json();
            const id = Number(body.task?.id || body.id || body.data?.id);
            assert.ok(id > 0);
            const details = await fetch(origin + '/api/tasks/' + id, { headers: { authorization: 'Bearer ' + session.token }});
            assert.equal(details.status, 200);
            const payload = await details.json();
            const task = payload.task || payload;
            assert.equal(task.taskMode || task.task_mode, taskMode);
            assert.equal(task.visibility, taskMode === 'work' ? 'team' : 'me_only');
            const card = page.locator(`.park-task-card[data-task-id="${id}"]`);
            await card.waitFor();
            return card;
        }

        const suffix = Date.now();
        const overdue = await create('Узгодити макет афіші', 'work', { dayOffset: -2, priority: 'urgent' });
        assert.equal(await overdue.getByText('Прострочено', { exact: true }).count(), 1);
        assert.equal(await overdue.locator('.park-task-priority select').inputValue(), 'urgent');
        const moveToday = overdue.getByRole('button', { name: 'На сьогодні', exact: true });
        await moveToday.waitFor();
        assert.ok(await moveToday.evaluate(node => node.previousElementSibling.classList.contains('park-task-heading')));
        await moveToday.press('Enter');
        const moved = page.locator('[data-park-period="today"]').getByText('Узгодити макет афіші', { exact: true });
        await moved.waitFor();
        assert.equal(await moveToday.count(), 0);
        const undoMove = page.locator('.cabinet-task-undo-toast').getByRole('button', { name: 'Скасувати' });
        await undoMove.waitFor();
        assert.ok(await undoMove.evaluate(node => document.activeElement === node));
        await undoMove.press('Enter');
        await page.locator('[data-park-period="overdue"]').getByText('Узгодити макет афіші', { exact: true }).waitFor();
        await create('Перевірити план монтажу', 'work', { dayOffset: 3 });
        const work = await create('Підготувати матеріали до зустрічі ' + suffix, 'work');
        const personal = await create('Оновити особистий список справ ' + suffix, 'personal');
        const personalTaskId = Number(await personal.getAttribute('data-task-id'));
        assert.equal(await mode.inputValue(), 'work');
        assert.equal(await work.locator('[data-park-task-mode]').textContent(), 'Робоча');
        assert.equal(await personal.locator('[data-park-task-mode]').textContent(), 'Особиста');
        assert.equal(await page.locator('#cabinetTaskAiFillBtn, #cabinetDecompositionMode, [data-cabinet-my-day-view-mode]').count(), 0);

        const done = work.getByRole('button', { name: 'Виконати', exact: true });
        await done.focus();
        await page.keyboard.press('Enter');
        const undo = page.getByRole('button', { name: 'Скасувати', exact: true });
        await undo.waitFor();
        assert.ok(await undo.evaluate(node => document.activeElement === node));
        await new Promise(resolve => setTimeout(resolve, 12500));
        await undo.press('Enter');
        await work.waitFor();

        assert.equal(await composer.locator('#cabinetTaskReportRequired').count(), 0);
        assert.equal(await composer.getByText('Видно команді згідно з її доступом до задач', { exact: true }).count(), 0);
        const reportTask = await create('Локальна задача зі звітом ' + suffix, 'work', { dayOffset: -2 });
        const centerTask = await create('Локальна задача з підпунктами ' + suffix, 'work', { dayOffset: -2 });
        const legacyIds = await Promise.all([reportTask, centerTask].map(async card => Number(await card.getAttribute('data-task-id'))));
        const fixtures = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
        let substitutionId;
        try {
            const { rows: [agreement] } = await fixtures.query(`INSERT INTO staff_substitutions
                (business_context, staff_id, work_date, source_type, source_id, slot_key, state, created_by,
                 version, input_json, quote_json, completion_json, source_snapshot)
                SELECT 'event_genix', staff_id, CURRENT_DATE, 'task', $1, 'primary', 'completed', 'synthetic',
                       1, '{}', '{}', '{}', '{}'
                FROM employee_profiles WHERE user_id = $2 AND is_active = true AND staff_id IS NOT NULL
                RETURNING id::text`, [await overdue.getAttribute('data-task-id'), session.user.id]);
            substitutionId = agreement.id;
            await fixtures.query(`UPDATE tasks SET control_meta = COALESCE(control_meta, '{}'::jsonb)
                || '{"reportRequired": true}'::jsonb WHERE id = ANY($1::int[])`, [legacyIds]);
            await fixtures.query(`INSERT INTO task_subtasks (task_id, title, is_done)
                SELECT id, 'Історичний підпункт', false FROM unnest($1::int[]) id`, [legacyIds]);
            await fixtures.query("UPDATE tasks SET status = 'in_progress', workflow_state = 'in_progress' WHERE id = $1", [legacyIds[1]]);
            await fixtures.query(`UPDATE tasks SET control_meta = control_meta || '{"canReschedule": false}'::jsonb WHERE id = $1`, [legacyIds[1]]);
        } finally {
            await fixtures.end();
        }
        await page.reload();
        await reportTask.waitFor();
        await overdue.getByText(`Підміна №${substitutionId} · Завершено`, { exact: true }).waitFor();
        assert.equal(await personal.locator('[data-task-substitution]').count(), 0);
        await overdue.screenshot({ path: path.join(evidence, 'my-day-substitution-mobile.png') });
        assert.equal(await centerTask.getByRole('button', { name: 'На сьогодні', exact: true }).count(), 0);
        assert.equal(await reportTask.getByText('Історичний підпункт').count(), 0);
        const completionPath = `**/api/tasks/${legacyIds[0]}/complete`;
        const completionError = 'Локальна перевірка помилки виконання';
        await page.route(completionPath, route => route.fulfill({ status: 409, json: { error: completionError } }), { times: 1 });
        await reportTask.getByRole('button', { name: 'Виконати', exact: true }).click();
        await page.getByText(completionError, { exact: true }).waitFor();
        await reportTask.getByRole('button', { name: 'Виконати', exact: true }).waitFor();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => {
            const start = document.startViewTransition?.bind(document);
            window.qaCompletionTransitions = 0;
            if (start) document.startViewTransition = (...args) => {
                window.qaCompletionTransitions += 1;
                return start(...args);
            };
        });
        const doneResponse = page.waitForResponse(r => r.request().method() === 'POST'
            && new URL(r.url()).pathname === `/api/tasks/${legacyIds[0]}/complete`);
        await reportTask.getByRole('button', { name: 'Виконати', exact: true }).click();
        const legacyMutation = await doneResponse;
        assert.ok(legacyMutation.ok());
        await reportTask.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => window.qaCompletionTransitions), 0);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const completion = page.locator('[data-cabinet-completion-pulse]');
        await completion.getByRole('heading', { name: 'Виконано сьогодні' }).waitFor();
        const completedRow = completion.locator(`.cabinet-completion-row[data-task-id="${legacyIds[0]}"]`);
        await completedRow.waitFor().catch(async error => {
            const { task } = await legacyMutation.json();
            const projectionResponse = await page.request.get(`${origin}/api/tasks/my-cabinet`, {
                headers: { authorization: `Bearer ${session.token}` }
            });
            const projection = await projectionResponse.json();
            const summarizeTask = ({ id, status, completedAt, completedParentToday } = {}) => ({ id, status, completedAt, completedParentToday });
            const diagnostics = { task: summarizeTask(task), calendar: projection.meta?.calendar,
                today: projection.completedTodayTasks?.map(summarizeTask), history: projection.completedHistory?.map(summarizeTask) };
            throw new Error(`${error.message}\nCompletion panel: ${await completion.innerText()}\n${JSON.stringify(diagnostics)}\nBrowser errors: ${pageErrors.join('; ')}`, { cause: error });
        });
        await page.reload();
        await work.waitFor();
        await completedRow.waitFor();
        for (const [width, height, theme] of [
            [390, 844, 'light'], [390, 844, 'dark'],
            [1440, 1000, 'light'], [1440, 1000, 'dark']
        ]) {
            await page.setViewportSize({ width, height });
            if (width === 1440 && theme === 'light') {
                await page.reload();
                await work.waitFor();
                assert.ok(await titleInput.isVisible());
            }
            await page.evaluate(theme => window.applyCrmThemeMode(theme === 'dark'), theme);
            await page.locator('#cabinetMyDaySegmentPanel').waitFor();
            assert.deepEqual(await page.locator('[data-park-period]:visible').evaluateAll(nodes =>
                nodes.map(node => node.dataset.parkPeriod)), ['today', 'overdue', 'future']);
            await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 2500 }).catch(() => {});
            const layout = await page.evaluate(() => ({
                width: innerWidth,
                scrollWidth: document.documentElement.scrollWidth,
                main: ['width', 'marginLeft', 'maxWidth', 'transform'].map(key => getComputedStyle(document.querySelector('#main-content'))[key]),
                overflow: [...document.querySelectorAll('body *')]
                    .filter(node => node.getBoundingClientRect().right > innerWidth + 1 && node.offsetWidth)
                    .slice(0, 12).map(node => [node.localName, node.id, node.getAttribute('class')])
            }));
            assert.ok(layout.scrollWidth <= layout.width, JSON.stringify({ theme, ...layout }));
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: path.join(evidence, `my-day-${width}-${theme}.png`), animations: 'disabled' });
            await page.locator('.park-day-board').screenshot({ path: path.join(evidence, `my-day-board-${width}-${theme}.png`), animations: 'disabled' });
            if (width === 390) {
                await completion.screenshot({ path: path.join(evidence, `my-day-completion-${theme}.png`) });
                if (theme === 'light') await overdue.screenshot({ path: path.join(evidence, 'my-day-quick-today-390.png') });
            }
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await completion.locator('[data-cabinet-completion-tab=today]').press('ArrowRight');
        const historyTab = completion.locator('[data-cabinet-completion-tab=history]');
        assert.equal(await historyTab.getAttribute('aria-selected'), 'true');
        assert.ok(await historyTab.evaluate(node => node === document.activeElement));
        const historyRow = completion.locator('.park-completed-row').filter({ hasText: 'Локальна задача зі звітом ' + suffix });
        await historyRow.getByRole('button', { name: 'Відновити', exact: true }).click();
        await reportTask.waitFor();

        const titleButton = work.locator('[data-cabinet-task-action=open]');
        const workId = await work.getAttribute('data-task-id');
        const taskDialog = page.getByRole('dialog', { name: 'Підготувати матеріали до зустрічі ' + suffix });
        await titleButton.click();
        await page.waitForURL(url => url.pathname === '/profile'
            && url.searchParams.get('tab') === 'myday' && url.searchParams.get('open') === workId);
        await taskDialog.getByText('Виконую', { exact: true }).waitFor();
        assert.ok(await taskDialog.getByRole('button', { name: 'Закрити' }).evaluate(node => node === document.activeElement));
        assert.ok(await taskDialog.evaluate(dialog => {
            const bounds = dialog.getBoundingClientRect();
            return bounds.left >= 12 && bounds.right <= innerWidth - 12
                && Math.abs(bounds.left + bounds.width / 2 - innerWidth / 2) < 2
                && Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2) < 2;
        }), 'The mobile task dialog is centered with room at the edges');
        await page.goBack();
        await taskDialog.waitFor({ state: 'hidden' });
        await titleButton.click();
        await taskDialog.getByRole('button', { name: 'Редагувати', exact: true }).click();
        await taskDialog.locator('[data-dialog-editor]').waitFor();
        assert.equal(new URL(page.url()).pathname, '/profile');
        await page.goBack();
        await taskDialog.waitFor({ state: 'hidden' });
        await work.waitFor();
        await page.goto(origin + '/profile?tab=myday&period=today');
        await work.waitFor();

        await work.getByRole('button', { name: 'Перенести' }).click();
        const dateDialog = page.locator('.confirm-dialog').filter({ hasText: 'Нова дата для задачі' });
        await dateDialog.locator('input[type=date]').waitFor();
        const futureDate = await dateDialog.locator('input[type=date]').inputValue();
        assert.match(futureDate, /^\d{4}-\d{2}-\d{2}$/);
        const rescheduled = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/reschedule'));
        await dateDialog.locator('.confirm-ok').click();
        assert.ok((await rescheduled).ok());
        await work.waitFor();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(origin + `/profile?tab=myday&period=future&open=${workId}&date=${futureDate}`);
        await taskDialog.getByText('Виконую', { exact: true }).waitFor();
        await taskDialog.locator(`time[datetime="${futureDate}"]`).waitFor();
        assert.ok(await taskDialog.evaluate(dialog => {
            const bounds = dialog.getBoundingClientRect();
            return Math.abs(bounds.left + bounds.width / 2 - innerWidth / 2) < 2
                && Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2) < 2;
        }), 'The desktop deep link opens a centered task dialog');
        await page.keyboard.press('Escape');
        await page.waitForURL(url => url.pathname === '/profile' && !url.searchParams.has('open'));
        await page.setViewportSize({ width: 390, height: 844 });
        await work.waitFor();
        await work.getByRole('button', { name: 'Редагувати' }).click();
        await page.waitForURL(url => url.pathname === '/profile' && url.searchParams.get('mode') === 'edit');
        await taskDialog.locator('[data-dialog-editor]').waitFor();
        await page.goBack();
        await work.waitFor();
        const id = Number(await work.getAttribute('data-task-id'));
        const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
        try {
            await pool.query(`INSERT INTO my_day_time_entries (user_id, task_id, started_at, source)
                VALUES ($1, $2, NOW() - INTERVAL '5 minutes', 'timer')`, [session.user.id, id]);
        } finally {
            await pool.end();
        }
        await page.reload();
        const timer = page.locator('[data-global-task-timer-panel-trigger]:visible').first();
        await timer.click();
        const stopped = page.waitForResponse(response => new URL(response.url()).pathname === '/api/my-day/timer/stop');
        await page.getByRole('button', { name: 'Зупинити таймер', exact: true }).click();
        assert.equal((await stopped).status(), 200);
        await timer.waitFor({ state: 'hidden' });
        await page.goto(origin + `/tasks?view=my&open=${legacyIds[1]}`);
        const centerComplete = page.locator('.park-task-dialog [data-dialog-complete]');
        await centerComplete.waitFor();
        assert.equal(new URL(page.url()).pathname, '/profile');
        const centerResponse = page.waitForResponse(r => r.request().method() === 'POST'
            && new URL(r.url()).pathname === `/api/tasks/${legacyIds[1]}/complete`);
        await centerComplete.click();
        assert.ok((await centerResponse).ok());
        const history = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
        try {
            const { rows } = await history.query(`SELECT s.task_id, s.is_done, t.status, t.control_meta->>'reportRequired' AS required
                FROM task_subtasks s JOIN tasks t ON t.id = s.task_id
                WHERE s.task_id = ANY($1::int[]) ORDER BY s.task_id`, [legacyIds]);
            assert.equal(rows.length, 2);
            assert.ok(rows.every(row => row.is_done === false && row.required === 'true'));
            assert.equal(rows.find(row => row.task_id === legacyIds[1]).status, 'done');
        } finally {
            await history.end();
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(origin + '/profile?tab=settings');
        const account = page.locator('.profile-settings-account');
        await account.getByText('Логін для входу', { exact: true }).waitFor();
        const favorites = page.locator('#sidebarDesignExtras');
        await favorites.locator('a[href="/profile?tab=myday"]').waitFor();
        assert.equal(await page.getByText('Особисте', { exact: true }).count(), 0);
        assert.equal(await page.locator('.sidebar-mini-rail a[href="/profile?tab=myday"]').count(), 1);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#sidebarToggle').click();
        await favorites.locator('a[href="/profile?tab=myday"]').waitFor();
        await page.locator('#sidebarOverlay').click({ position: { x: 380, y: 400 } });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.evaluate(() => {
            localStorage.removeItem('eg_sidebar_favorites_productivity_merged_v1');
            localStorage.removeItem('eg_sidebar_extra_menu_items_v3');
            localStorage.setItem('eg_sidebar_productivity_menu_items_v1', JSON.stringify(['/profile.html?tab=myday', '/profile?tab=myday', '/tasks?view=my', '/tasks?view=today']));
        });
        await page.reload();
        await favorites.locator('a[href="/tasks?view=my"]').waitFor();
        assert.equal(await favorites.locator('a[href="/profile?tab=myday"]').count(), 1);
        await favorites.locator('a[href="/tasks?view=today"]').waitFor();
        await verifySettings(page, origin, evidence);
        const salaryPage = await context.newPage();
        try {
            await verifySalary(salaryPage, origin, evidence);
        } finally {
            await salaryPage.close();
        }
        await verifyLocales(browser, origin, session);
        await page.setViewportSize({ width: 390, height: 844 });

        const resultsFixtures = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
        try {
            await resultsFixtures.query(`UPDATE tasks
                SET status = 'done', workflow_state = 'done',
                    completed_at = (date_trunc('day', NOW() AT TIME ZONE 'Europe/Kyiv') - INTERVAL '1 day' + INTERVAL '12 hours')
                        AT TIME ZONE 'Europe/Kyiv' AT TIME ZONE 'UTC'
                WHERE id = $1`, [id]);
            await resultsFixtures.query(`UPDATE tasks
                SET status = 'done', workflow_state = 'done', completed_at = NOW() AT TIME ZONE 'UTC'
                WHERE id = $1`, [personalTaskId]);
        } finally {
            await resultsFixtures.end();
        }
        await page.getByRole('button', { name: 'Мої результати', exact: true }).click();
        const chart = page.locator('.profile-results-chart');
        await chart.waitFor();
        assert.equal(await chart.locator('time').count(), 7);
        const highlights = page.locator('.profile-results-highlights');
        for (const label of ['Сьогодні', 'Вчора', 'Прострочені', 'Робочі', 'Особисті']) {
            assert.match(await highlights.textContent(), new RegExp(label));
        }
        assert.match(await highlights.textContent(), /Робочі 1 · Особисті 1/);
        assert.match(await highlights.textContent(), /Робочі 1 · Особисті 0/);
        await page.screenshot({ path: path.join(evidence, 'profile-results-390.png'), animations: 'disabled' });
        await chart.screenshot({ path: path.join(evidence, 'profile-results-chart-390.png'), animations: 'disabled' });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({ path: path.join(evidence, 'profile-results-1440.png'), animations: 'disabled' });
        await chart.screenshot({ path: path.join(evidence, 'profile-results-chart-1440.png'), animations: 'disabled' });
        await page.goBack();
        await account.waitFor();

        const controlFixtures = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
        const assignedTitle = 'Узгодити кошторис на контролі';
        try {
            const { rows: [assignee] } = await controlFixtures.query(`INSERT INTO users (username, name, password_hash, role)
                VALUES ($1, 'Олена Тестова', 'unused-in-browser-qa', 'director') RETURNING id`, [`control_fixture_${suffix}`]);
            await controlFixtures.query(`INSERT INTO tasks (title, status, workflow_state, task_mode, visibility, owner_user_id, created_by_user_id, business_context, date)
                VALUES ($1, 'todo', 'todo', 'work', 'team', $2, $3, 'event_genix', ((NOW() AT TIME ZONE 'Europe/Kyiv')::date - 1)::text)`,
            [assignedTitle, assignee.id, session.user.id]);
        } finally {
            await controlFixtures.end();
        }
        const controlLink = page.getByRole('link', { name: /^На контролі/ });
        await controlLink.click();
        await page.waitForURL(url => url.searchParams.get('tab') === 'control');
        const controlPanel = page.locator('[data-profile-control-panel]');
        const authoredTask = controlPanel.getByRole('link', { name: assignedTitle });
        await authoredTask.waitFor();
        assert.match(await controlLink.textContent(), /На контролі 1/);
        await controlPanel.getByText('Виконує Олена Тестова').waitFor();
        assert.ok(await controlPanel.getByText(/Прострочено/).isVisible());
        assert.equal(await page.locator('[data-park-period]').count(), 0);
        await page.screenshot({ path: path.join(evidence, 'profile-control-1440.png'), animations: 'disabled' });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
        const mobileNavRows = await page.locator('.profile-park-nav .profile-secondary-tabs').evaluate(nav =>
            getComputedStyle(nav).gridTemplateRows.split(' ').length);
        assert.equal(mobileNavRows, 2);
        await page.screenshot({ path: path.join(evidence, 'profile-control-390.png'), animations: 'disabled' });
        await authoredTask.click();
        await page.waitForURL(url => url.pathname === '/tasks' && url.searchParams.has('open'));
        const taskDrawerTitle = page.locator('#taskDetailOverlay #_tdTitle');
        await taskDrawerTitle.waitFor();
        assert.equal(await taskDrawerTitle.inputValue(), assignedTitle);
        await page.goBack();
        await authoredTask.waitFor();
        await page.reload();
        await authoredTask.waitFor();
        await page.getByRole('button', { name: 'Мій день', exact: true }).click();
        await page.locator('[data-park-period="today"]').waitFor();
        assert.equal(await page.getByText(assignedTitle, { exact: true }).count(), 0);
        await page.goBack();
        await authoredTask.waitFor();
        const completedFixtures = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
        try {
            await completedFixtures.query(`UPDATE tasks
                SET status = 'done', workflow_state = 'done', completed_at = NOW() AT TIME ZONE 'UTC'
                WHERE title = $1 AND created_by_user_id = $2`, [assignedTitle, session.user.id]);
        } finally {
            await completedFixtures.end();
        }
        await page.setViewportSize({ width: 320, height: 760 });
        // Simulate returning to the existing profile after the executor completes elsewhere.
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        const activeTab = controlPanel.getByRole('tab', { name: 'Активні' });
        const completedTab = controlPanel.getByRole('tab', { name: /Завершені/ });
        await controlPanel.getByText('Зараз немає відкритих задач на контролі.').waitFor();
        await completedTab.getByText('Нових: 1').waitFor();
        await activeTab.focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await completedTab.evaluate(tab => tab === document.activeElement), true);
        assert.equal(await activeTab.getAttribute('aria-selected'), 'true');
        await page.keyboard.press('Enter');
        await authoredTask.waitFor();
        assert.equal(await completedTab.getAttribute('aria-selected'), 'true');
        await controlPanel.getByText(/Завершено ·/).waitFor();
        await activeTab.click();
        assert.equal(await authoredTask.isVisible(), false);
        await completedTab.click();
        await authoredTask.waitFor();
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
        const [activeBox, completedBox] = await Promise.all([activeTab.boundingBox(), completedTab.boundingBox()]);
        assert.equal(activeBox.y, completedBox.y);
        assert.ok(activeBox.x >= 0 && completedBox.x + completedBox.width <= 320);
        assert.ok(completedBox.height >= 44);
        await controlPanel.screenshot({ path: path.join(evidence, 'profile-control-completed-320.png'), animations: 'disabled' });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.evaluate(() => document.body.classList.remove('dark-mode'));
        await controlPanel.screenshot({ path: path.join(evidence, 'profile-control-completed-1440-light.png'), animations: 'disabled' });
        await page.setViewportSize({ width: 320, height: 760 });

        await page.evaluate(() => toggleAlertsPanel());
        const completionAlert = page.locator('#alertsPanel').getByRole('link', { name: `Завершено: ${assignedTitle}` });
        await completionAlert.waitFor();
        const infoAlert = completionAlert.locator('xpath=ancestor::*[@data-alert-id][1]');
        await infoAlert.getByText('На контролі · Для ознайомлення').waitFor();
        assert.equal(await infoAlert.getByRole('button', { name: /Підтвердити|Створити/ }).count(), 0);
        await infoAlert.screenshot({ path: path.join(evidence, 'profile-control-completion-notification-320.png'), animations: 'disabled' });
        const secondDevice = await browser.newContext({ serviceWorkers: 'block' });
        try {
            await secondDevice.route('https://**/*', route => route.abort());
            await secondDevice.addInitScript(session => {
                for (const [key, value] of Object.entries({
                    pzp_token: session.token,
                    pzp_access_token: session.token,
                    pzp_current_user: JSON.stringify(session.user),
                    pzp_crm_business_context: 'event_genix'
                })) localStorage.setItem(key, value);
            }, session);
            const secondPage = await secondDevice.newPage();
            await secondPage.goto(origin + '/profile?tab=control');
            await secondPage.locator('[data-profile-control-new]:visible').first().waitFor();
            await page.bringToFront();
            await infoAlert.getByRole('button', { name: 'Позначити сповіщення як прочитане' }).click();
            await completedTab.getByText('Нових: 1').waitFor({ state: 'hidden' });
            await secondPage.bringToFront();
            await secondPage.evaluate(() => window.dispatchEvent(new Event('online')));
            await secondPage.locator('[data-profile-control-new]:visible').first().waitFor({ state: 'hidden' });
        } finally {
            await secondDevice.close();
        }
        await page.reload();
        await page.getByRole('tab', { name: /Завершені/ }).click();
        await authoredTask.waitFor();
        assert.equal(await page.locator('[data-profile-control-new]:visible').count(), 0);

        await require('./task-entry-checks').verifyTaskEntry({ origin, session, evidence, taskId: Number(workId) });
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(gameRequests, []);
        assert.deepEqual(hermesRequests, []);
        console.log('Park local app / PostgreSQL browser: fixed board layout, legacy completion on both surfaces, keyboard undo, history restore, date reschedule, edit route, and timer recovery.');
    } finally {
        await browser.close();
    }
}
run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
