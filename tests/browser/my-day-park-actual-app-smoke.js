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
        await titleInput.waitFor();
        assert.equal(await mode.inputValue(), 'work');
        assert.equal(await page.locator('[data-global-task-timer-panel-trigger]:visible').count(), 0);

        async function create(title, taskMode, reportRequired = false) {
            await mode.selectOption(taskMode);
            if (reportRequired) {
                await composer.getByRole('button', { name: 'Більше параметрів' }).click();
                await composer.locator('#cabinetTaskReportRequired').check();
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
            await card.waitFor();
            return card;
        }

        const suffix = Date.now();
        const work = await create('Локальна робоча задача ' + suffix, 'work');
        await create('Локальна особиста задача ' + suffix, 'personal');
        assert.equal(await mode.inputValue(), 'work');

        const done = work.getByRole('button', { name: 'Виконати', exact: true });
        await done.focus();
        await page.keyboard.press('Enter');
        const undo = page.getByRole('button', { name: 'Скасувати', exact: true });
        await undo.waitFor();
        assert.ok(await undo.evaluate(node => document.activeElement === node));
        await new Promise(resolve => setTimeout(resolve, 12500));
        await undo.press('Enter');
        await work.waitFor();

        const reportTask = await create('Локальна задача зі звітом ' + suffix, 'work', true);
        const gateResponse = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/complete'));
        await reportTask.getByRole('button', { name: 'Виконати', exact: true }).click();
        assert.equal((await (await gateResponse).json()).code, 'TASK_REPORT_REQUIRED');
        await page.getByText('Звіт перед виконанням', { exact: true }).waitFor();
        await page.locator('.task-report-required-modal textarea').fill('Тестовий звіт: перевірено стан задачі.');
        await page.getByRole('button', { name: 'Зберегти звіт і виконати' }).click();
        await reportTask.waitFor({ state: 'detached' });
        const completion = page.locator('[data-cabinet-completion-pulse]');
        await completion.locator('[data-cabinet-completion-toggle]').click();
        await completion.locator('[data-cabinet-completion-tab=history]').click();
        const historyRow = completion.locator('.park-completed-row').filter({ hasText: 'Локальна задача зі звітом ' + suffix });
        await historyRow.getByRole('button', { name: 'Відновити', exact: true }).click();
        await reportTask.waitFor();

        const titleButton = work.locator('[data-cabinet-task-action=open]');
        await titleButton.click();
        await page.waitForURL(url => url.pathname === '/tasks' && url.searchParams.has('open'));
        await page.goBack();
        await work.waitFor();
        await page.locator('[data-park-my-day-view=future]').click();
        await page.reload();
        await page.locator('[data-park-my-day-view=future][aria-pressed=true]').waitFor();
        await page.locator('[data-park-my-day-view=today]').click();
        await work.waitFor();
        await work.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(evidence, 'park-local-postgres-390.png') });
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
        console.log('Park local app / PostgreSQL browser: work/personal creation, completion, keyboard undo hold, required report, history restore, canonical details, persisted period, and existing timer recovery.');
    } finally {
        await browser.close();
    }
}
run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
