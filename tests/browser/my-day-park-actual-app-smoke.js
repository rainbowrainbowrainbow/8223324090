'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { requirePlaywright } = require('./timeline-room-summary-browser-smoke');

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
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const pageErrors = [];
        const gameRequests = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('request', request => {
            const url = new URL(request.url());
            if (/^\/api\/(?:wallet|achievements|quests|gamification)(?:\/|$)/.test(url.pathname)) {
                gameRequests.push(url.pathname);
            }
        });
        await page.goto(origin + '/profile?tab=myday');
        const composer = page.locator('#cabinetTaskComposer');
        const titleInput = composer.locator('#cabinetTaskTitle');
        const mode = composer.locator('#cabinetTaskMode');
        const newTask = page.locator('.park-composer > summary');
        await page.locator('[data-park-my-day-view=today]').waitFor();
        assert.equal(await titleInput.isVisible(), false);
        await newTask.press('Enter');
        await titleInput.waitFor();
        assert.equal(await mode.inputValue(), 'work');
        assert.equal(await page.locator('[data-global-task-timer-panel-trigger]:visible').count(), 0);

        async function create(title, taskMode, { reportRequired = false, dayOffset = 0, priority = 'normal' } = {}) {
            await mode.selectOption(taskMode);
            if (reportRequired || priority !== 'normal') {
                await composer.getByText('Параметри задачі', { exact: true }).click();
                await composer.locator('#cabinetTaskPriority').selectOption(priority);
                if (reportRequired) await composer.locator('#cabinetTaskReportRequired').check();
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
            const body = await mutation.json();
            const id = Number(body.task?.id || body.id || body.data?.id);
            assert.ok(id > 0);
            const details = await fetch(origin + '/api/tasks/' + id, { headers: { authorization: 'Bearer ' + session.token }});
            assert.equal(details.status, 200);
            const payload = await details.json();
            const task = payload.task || payload;
            assert.equal(task.taskMode || task.task_mode, taskMode);
            assert.equal(task.visibility, taskMode === 'work' ? 'team' : 'me_only');
            const card = page.locator('.park-task-card').filter({ hasText: title });
            const period = dayOffset < 0 ? 'overdue' : dayOffset > 0 ? 'future' : 'today';
            await page.locator(`[data-park-my-day-view=${period}]`).click();
            await card.waitFor();
            return card;
        }

        const suffix = Date.now();
        const overdue = await create('Узгодити макет афіші', 'work', { dayOffset: -2, priority: 'urgent' });
        assert.equal(await overdue.getByText('Прострочено', { exact: true }).count(), 1);
        assert.equal(await overdue.locator('.park-task-priority select').inputValue(), 'urgent');
        await create('Перевірити план монтажу', 'work', { dayOffset: 3 });
        const work = await create('Підготувати матеріали до зустрічі ' + suffix, 'work');
        const personal = await create('Оновити особистий список справ ' + suffix, 'personal');
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

        const reportTask = await create('Локальна задача зі звітом ' + suffix, 'work', { reportRequired: true });
        const todayBadge = page.locator('[data-park-my-day-view=today] b');
        const beforeCompletion = Number(await todayBadge.textContent());
        const gateResponse = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/complete'));
        await reportTask.getByRole('button', { name: 'Виконати', exact: true }).click();
        assert.equal((await (await gateResponse).json()).code, 'TASK_REPORT_REQUIRED');
        await page.getByText('Звіт перед виконанням', { exact: true }).waitFor();
        await page.locator('.task-report-required-modal textarea').fill('Тестовий звіт: перевірено стан задачі.');
        await page.getByRole('button', { name: 'Зберегти звіт і виконати' }).click();
        await reportTask.waitFor({ state: 'detached' });
        assert.equal(Number(await todayBadge.textContent()), beforeCompletion - 1);
        const completion = page.locator('[data-cabinet-completion-pulse]');
        await completion.getByRole('heading', { name: 'Виконано сьогодні' }).waitFor();
        await completion.getByText('Локальна задача зі звітом ' + suffix, { exact: true }).waitFor();
        await page.reload();
        await work.waitFor();
        await completion.getByText('Локальна задача зі звітом ' + suffix, { exact: true }).waitFor();
        assert.equal(Number(await todayBadge.textContent()), beforeCompletion - 1);
        for (const [width, height, theme, visiblePeriods] of [
            [390, 844, 'light', 1], [390, 844, 'dark', 1],
            [1440, 1000, 'light', 3], [1440, 1000, 'dark', 3]
        ]) {
            await page.setViewportSize({ width, height });
            if (width === 1440 && theme === 'light') {
                await page.reload();
                await work.waitFor();
                assert.ok(await titleInput.isVisible());
            }
            await page.evaluate(theme => window.applyCrmThemeMode(theme === 'dark'), theme);
            await page.locator('#cabinetMyDaySegmentPanel').waitFor();
            assert.equal(await page.locator('[data-park-period]:visible').count(), visiblePeriods);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: path.join(evidence, `my-day-${width}-${theme}.png`) });
            await page.locator('.park-day-board').screenshot({ path: path.join(evidence, `my-day-board-${width}-${theme}.png`) });
            if (width === 390) {
                await completion.screenshot({ path: path.join(evidence, `my-day-completion-${theme}.png`) });
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
        assert.equal(Number(await todayBadge.textContent()), beforeCompletion);

        const titleButton = work.locator('[data-cabinet-task-action=open]');
        await titleButton.click();
        await page.waitForURL(url => url.pathname === '/tasks' && url.searchParams.has('open'));
        await page.goBack();
        await work.waitFor();
        await page.locator('[data-park-my-day-view=future]').click();
        await page.reload();
        await page.locator('[data-park-my-day-view=future][aria-pressed=true]').waitFor();
        await page.goto(origin + '/profile?tab=myday&period=today');
        await page.locator('[data-park-my-day-view=today][aria-pressed=true]').waitFor();
        await page.locator('[data-park-my-day-view=future]').click();
        await page.reload();
        await page.locator('[data-park-my-day-view=future][aria-pressed=true]').waitFor();
        await page.locator('[data-park-my-day-view=today]').click();
        await work.waitFor();
        assert.ok(Number((await page.locator('[data-park-my-day-view=today] b').textContent()).trim()) >= 3);

        await work.getByRole('button', { name: 'Перенести' }).click();
        const dateDialog = page.locator('.confirm-dialog').filter({ hasText: 'Нова дата для задачі' });
        await dateDialog.locator('input[type=date]').waitFor();
        const futureDate = await dateDialog.locator('input[type=date]').inputValue();
        assert.match(futureDate, /^\d{4}-\d{2}-\d{2}$/);
        const rescheduled = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/reschedule'));
        await dateDialog.locator('.confirm-ok').click();
        assert.ok((await rescheduled).ok());
        await page.locator('[data-park-my-day-view=future]').click();
        await work.waitFor();
        await work.getByRole('button', { name: 'Редагувати' }).click();
        await page.waitForURL(url => url.pathname === '/tasks' && url.searchParams.get('mode') === 'edit');
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
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(gameRequests, []);
        console.log('Park local app / PostgreSQL browser: task types and counts, report and completion board, keyboard undo, history restore, date reschedule, edit route, mobile/desktop in both themes, and timer recovery.');
    } finally {
        await browser.close();
    }
}
run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
