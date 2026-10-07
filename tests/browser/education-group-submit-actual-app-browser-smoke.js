'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { chromium } = require(process.env.EDU_QA_PLAYWRIGHT);

assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
const base = process.env.TEST_URL;
const postPath = /\/api\/education\/groups\/?(?:\?|$)/;

async function api(method, route, token, body) {
    const response = await fetch(`${base}${route}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function waitFor(predicate, message) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(message);
}

(async () => {
    const pool = new Pool();
    const browser = await chromium.launch({ headless: true });
    try {
        const login = await api('POST', '/api/auth/login', '', {
            username: process.env.TEST_USER, password: process.env.TEST_PASS
        });
        assert.equal(login.status, 200);
        const token = login.body.accessToken || login.body.token;
        const cabinet = await api('PUT', '/api/business/cabinet?businessContext=dar', token, {
            businessType: 'education', timelineMode: 'education', resourceModel: 'cabinet'
        });
        assert.equal(cabinet.status, 200);

        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin
            ? route.continue() : route.abort());
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.locator('#username').fill(process.env.TEST_USER);
        await page.locator('#password').fill(process.env.TEST_PASS);
        await page.locator('#loginForm button[type="submit"]').click();
        await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45_000 });
        await page.goto(`${base}/?businessContext=dar&educationSchedule=groups`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.EducationGroups && window.CrmBusinessContext?.current?.() === 'dar');

        const submit = page.locator('#educationGroupForm button[type="submit"]');
        const nameField = page.locator('#educationGroupName');
        const countRows = async name => Number((await pool.query(
            'SELECT COUNT(*)::int AS count FROM education_groups WHERE business_context = $1 AND name = $2',
            ['dar', name]
        )).rows[0].count);
        const beginNew = async name => {
            await page.locator('#educationGroupsList').selectOption('');
            await nameField.fill(name);
            await page.locator('#educationGroupCapacity').fill('3');
        };
        const assertOneSaved = async (name, expectedPostCount) => {
            await waitFor(() => countRows(name).then(count => count === 1), 'Expected one saved SQL row');
            await page.waitForFunction(() => !document.getElementById('educationGroupForm').hasAttribute('aria-busy')
                && document.getElementById('educationGroupsStatus').textContent === 'Групу збережено.');
            assert.equal(await countRows(name), 1, 'one form action must create one SQL row');
            assert.equal(expectedPostCount(), 1, 'one form action must send one POST');
            const listed = await api('GET', '/api/education/groups?businessContext=dar&includeArchived=true', token);
            assert.equal(listed.status, 200);
            assert.equal(listed.body.groups.filter(group => group.name === name).length, 1, 'API list has one group');
        };

        const doubleName = `EDU double ${crypto.randomUUID().slice(0, 8)}`;
        await beginNew(doubleName);
        let doublePosts = 0;
        let releaseDouble;
        const doubleBarrier = new Promise(resolve => { releaseDouble = resolve; });
        await page.route(postPath, async route => {
            if (route.request().method() !== 'POST') return route.continue();
            doublePosts += 1;
            await doubleBarrier;
            await route.continue();
        });
        await submit.dblclick({ delay: 60 });
        await waitFor(async () => doublePosts > 0, 'Double-click POST must reach barrier');
        releaseDouble();
        await assertOneSaved(doubleName, () => doublePosts);
        await page.unroute(postPath);

        const enterName = `EDU enter ${crypto.randomUUID().slice(0, 8)}`;
        await beginNew(enterName);
        let enterPosts = 0;
        let releaseEnter;
        const enterBarrier = new Promise(resolve => { releaseEnter = resolve; });
        await page.route(postPath, async route => {
            if (route.request().method() !== 'POST') return route.continue();
            enterPosts += 1;
            await enterBarrier;
            await route.continue();
        });
        await nameField.press('Enter');
        await nameField.press('Enter');
        await waitFor(async () => enterPosts > 0, 'Enter POST must reach barrier');
        releaseEnter();
        await assertOneSaved(enterName, () => enterPosts);
        await page.unroute(postPath);

        for (const code of [403, 409, 500]) {
            const name = `EDU retry ${code} ${crypto.randomUUID().slice(0, 8)}`;
            await beginNew(name);
            let failedPosts = 0;
            await page.route(postPath, async route => {
                if (route.request().method() !== 'POST') return route.continue();
                failedPosts += 1;
                await route.fulfill({ status: code, json: { error: `Synthetic ${code}` } });
            });
            await submit.click();
            await waitFor(async () => (await page.locator('#educationGroupsStatus').innerText()).includes(`Synthetic ${code}`),
                `Expected ${code} error status`);
            assert.equal(failedPosts, 1);
            assert.equal(await nameField.inputValue(), name, `${code}: draft preserved`);
            assert.equal(await submit.isEnabled(), true, `${code}: submit restored`);
            assert.equal(await countRows(name), 0, `${code}: error created no SQL row`);
            await page.unroute(postPath);
            let retryPosts = 0;
            await page.route(postPath, async route => {
                if (route.request().method() === 'POST') retryPosts += 1;
                await route.continue();
            });
            await submit.click();
            await assertOneSaved(name, () => retryPosts);
            await page.unroute(postPath);
        }
        assert.deepEqual(pageErrors, []);
        console.log('Education group submit actual-app double click, Enter, 403/409/500 and retry: PASS');
    } finally {
        await browser.close();
        await pool.end();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
