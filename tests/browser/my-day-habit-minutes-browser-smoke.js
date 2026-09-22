#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'my-day-habit-minutes');

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

function harnessHtml() {
    return `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/css/pages-profile.css">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #f8fafc; font-family: Arial, sans-serif; color: #0f172a; }
    body.dark-mode { background: #020617; color: #e2e8f0; }
    #root { width: min(100%, 940px); margin: 0 auto; }
    .cabinet-shell { padding: 18px; border: 1px solid #dbe3ec; border-radius: 8px; background: #fff; }
    body.dark-mode .cabinet-shell { border-color: #334155; background: #0f172a; }
    @media (max-width: 480px) { body { padding: 10px; } .cabinet-shell { padding: 10px; } }
  </style>
</head>
<body>
  <main id="root" class="profile-page profile-work-mode"></main>
  <script>
    window.getAuthHeaders = () => ({ 'Content-Type': 'application/json' });
    window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    window.showNotification = () => {};
  </script>
  <script src="/js/my-day-habits.js"></script>
  <script>
    const root = document.getElementById('root');
    async function render() {
      root.innerHTML = window.MyDayHabits.renderPanel();
      window.MyDayHabits.bind(root, render);
    }
    window.fixtureReady = (async () => {
      window.MyDayHabits.state.mode = 'habits';
      await window.MyDayHabits.load(true);
      await render();
    })();
  </script>
</body>
</html>`;
}

function startServer() {
    const initialValues = { 15: 25, 16: 2, 17: 0 };
    const values = { ...initialValues };
    let mutationRequests = 0;
    let failNext = false;

    function habit(id, name, metric, targetValue) {
        const value = values[id];
        const completed = metric === 'boolean' ? value === 1 : value >= targetValue;
        return {
            id,
            name,
            metric,
            targetValue,
            cadence: 'daily',
            completed,
            skipped: false,
            impacts: [],
            checkin: value || metric !== 'boolean' ? { state: 'done', value, completed } : null,
            progress: { value, target: targetValue, completed },
            weeklyProgress: { completed: completed ? 1 : 0, target: 7 }
        };
    }

    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const sendJson = (status, payload) => {
            response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify(payload));
        };

        if (request.method === 'POST' && url.pathname === '/__reset') {
            Object.assign(values, initialValues);
            mutationRequests = 0;
            failNext = false;
            sendJson(200, { success: true });
            return;
        }
        if (request.method === 'POST' && url.pathname === '/__fail-next') {
            failNext = true;
            sendJson(200, { success: true });
            return;
        }
        if (url.pathname === '/__state') {
            sendJson(200, { values, mutationRequests });
            return;
        }
        if (request.method === 'GET' && url.pathname === '/api/my-day/habits') {
            sendJson(200, {
                success: true,
                habits: [
                    habit(15, 'Фокус без екранів', 'minutes', 30),
                    habit(16, 'Склянки води', 'count', 5),
                    habit(17, 'Ранкова зарядка', 'boolean', 1)
                ]
            });
            return;
        }

        const checkinMatch = url.pathname.match(/^\/api\/my-day\/habits\/(\d+)\/check-ins\/[^/]+$/);
        if (request.method === 'PUT' && checkinMatch) {
            let raw = '';
            request.on('data', chunk => { raw += chunk; });
            request.on('end', () => {
                mutationRequests += 1;
                const payload = JSON.parse(raw || '{}');
                const id = Number(checkinMatch[1]);
                setTimeout(() => {
                    if (failNext) {
                        failNext = false;
                        sendJson(500, { success: false, error: 'Тимчасова помилка збереження.' });
                        return;
                    }
                    values[id] = Number(payload.value);
                    const target = id === 15 ? 30 : (id === 16 ? 5 : 1);
                    sendJson(200, {
                        success: true,
                        checkin: {
                            habitId: id,
                            state: payload.state,
                            value: values[id],
                            completed: values[id] >= target
                        }
                    });
                }, 140);
            });
            return;
        }

        if (url.pathname === '/') {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(harnessHtml());
            return;
        }

        const filePath = path.join(ROOT, url.pathname.replace(/^\//, ''));
        if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) {
            response.writeHead(404);
            response.end('Not found');
            return;
        }
        const contentType = path.extname(filePath) === '.js' ? 'text/javascript' : 'text/css';
        response.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
        fs.createReadStream(filePath).pipe(response);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function apiState(page) {
    return page.evaluate(() => fetch('/__state').then(response => response.json()));
}

async function waitForStatus(page, habitId, pattern) {
    await page.waitForFunction(({ habitId, source, flags }) => {
        const entry = document.querySelector(`[data-my-day-habit-entry="${habitId}"]`);
        return new RegExp(source, flags).test(entry?.querySelector('[data-my-day-habit-status]')?.textContent || '');
    }, { habitId: String(habitId), source: pattern.source, flags: pattern.flags });
}

async function applyTheme(page, dark) {
    if (!dark) return;
    await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.body.classList.add('dark-mode');
    });
}

async function runScenario(browser, baseUrl, viewport, dark) {
    await fetch(`${baseUrl}/__reset`, { method: 'POST' });
    const page = await browser.newPage({ viewport });
    await page.goto(baseUrl);
    await page.evaluate(() => window.fixtureReady);
    await applyTheme(page, dark);

    const minuteEntry = page.locator('[data-my-day-habit-entry="15"]');
    const minuteInput = minuteEntry.locator('[data-my-day-habit-value]');
    const minuteSave = minuteEntry.locator('[data-my-day-habit-save]');
    assert.equal(await minuteInput.inputValue(), '25');
    assert.equal(await minuteInput.getAttribute('max'), '1440');
    assert.match(await minuteEntry.locator('.my-day-habit-unit').textContent(), /^хв$/);
    assert.equal(await page.locator('[data-my-day-habit-check="17"]').count(), 1, 'boolean habit keeps checkbox control');

    await minuteInput.fill('1440');
    await minuteEntry.locator('[data-my-day-habit-step="1"]').click();
    assert.equal(await minuteInput.inputValue(), '1440');
    await minuteInput.fill('0');
    await minuteEntry.locator('[data-my-day-habit-step="-1"]').click();
    assert.equal(await minuteInput.inputValue(), '0');

    for (const invalid of ['', '-1', '1.5', '1441']) {
        const before = (await apiState(page)).mutationRequests;
        await minuteInput.fill(invalid);
        await minuteSave.click();
        await waitForStatus(page, 15, /Введіть|від’ємним|ціле число|Максимум 1440/);
        assert.equal(await minuteInput.getAttribute('aria-invalid'), 'true');
        assert.equal((await apiState(page)).mutationRequests, before, `invalid value ${invalid || '<blank>'} must not reach API`);
    }

    await page.evaluate(() => fetch('/__fail-next', { method: 'POST' }));
    await minuteInput.fill('47');
    await minuteSave.click();
    assert.equal(await minuteEntry.getAttribute('aria-busy'), 'true');
    assert.equal(await minuteInput.isDisabled(), true);
    assert.equal(await minuteEntry.locator('[data-my-day-habit-step]').first().isDisabled(), true);
    await waitForStatus(page, 15, /Тимчасова помилка/);
    assert.equal(await minuteInput.inputValue(), '47', 'failed value remains editable for retry');
    assert.equal(await minuteInput.isDisabled(), false);

    await minuteSave.click();
    await waitForStatus(page, 15, /Збережено: 47 хв/);
    assert.equal((await apiState(page)).values['15'], 47);
    assert.equal(await minuteInput.inputValue(), '47');

    await page.reload();
    await page.evaluate(() => window.fixtureReady);
    await applyTheme(page, dark);
    assert.equal(await page.locator('[data-my-day-habit-entry="15"] [data-my-day-habit-value]').inputValue(), '47', 'full refresh restores persisted minutes');

    const reloadedInput = page.locator('[data-my-day-habit-entry="15"] [data-my-day-habit-value]');
    await reloadedInput.fill('48');
    await reloadedInput.press('Enter');
    await waitForStatus(page, 15, /Збережено: 48 хв/);
    assert.equal((await apiState(page)).values['15'], 48, 'Enter saves minutes');

    const countEntry = page.locator('[data-my-day-habit-entry="16"]');
    await countEntry.locator('[data-my-day-habit-value]').fill('4');
    await countEntry.locator('[data-my-day-habit-save]').click();
    await waitForStatus(page, 16, /Збережено: 4 раз/);
    assert.equal((await apiState(page)).values['16'], 4, 'count habits retain numeric save behavior');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `habit controls overflow by ${overflow}px`);
    if (dark) {
        const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        assert.equal(background, 'rgb(2, 6, 23)', 'dark scenario keeps the dark surface after refresh');
    }
    const stepSize = await page.locator('[data-my-day-habit-entry="15"] [data-my-day-habit-step]').first().evaluate(node => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    });
    assert.ok(stepSize.width >= 40 && stepSize.height >= 40, 'step controls keep a touch-friendly hit area');

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await page.screenshot({
        fullPage: true,
        path: path.join(OUTPUT_DIR, `habit-minutes-${viewport.width}-${dark ? 'dark' : 'light'}.png`)
    });
    await page.close();
}

(async () => {
    const server = await startServer();
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: true });
    try {
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
            await runScenario(browser, baseUrl, viewport, false);
            await runScenario(browser, baseUrl, viewport, true);
        }
        console.log('My Day habit minutes browser smoke passed.');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
