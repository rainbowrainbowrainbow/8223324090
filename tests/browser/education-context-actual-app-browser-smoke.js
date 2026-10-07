'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.EDU_QA_PLAYWRIGHT);

assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
const base = process.env.TEST_URL;

async function api(method, path, token, body) {
    const response = await fetch(`${base}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function waitForRequest(requests, from, predicate) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const found = requests.slice(from).find(predicate);
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Expected delayed education request was not sent');
}

const group = (id, name) => ({ id, name, status: 'active', capacity: 3, members: [] });
const journal = (id, title) => ({
    booking: { id, date: '2026-12-15', time: '09:00', title, groupName: 'QA' },
    members: [], frozen: false, cancelled: false
});
const report = title => ({
    summary: { held: 0, cancelled: 0, scheduled: 1, journalsNotStarted: 0,
        present: 0, absent: 0, excused: 0, unmarked: 0 },
    lessons: [{ date: '2026-12-15', time: '09:00', title, groupName: 'QA', phase: 'scheduled', journalStarted: false }]
});

(async () => {
    const login = await api('POST', '/api/auth/login', '', {
        username: process.env.TEST_USER,
        password: process.env.TEST_PASS
    });
    assert.equal(login.status, 200, 'disposable test login');
    const token = login.body.accessToken || login.body.token;
    const cabinet = await api('PUT', '/api/business/cabinet?businessContext=dar', token, {
        businessType: 'education', timelineMode: 'education', resourceModel: 'cabinet'
    });
    assert.equal(cabinet.status, 200, 'disposable Dar education profile');

    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', route => {
            const requestUrl = new URL(route.request().url());
            return requestUrl.origin === new URL(base).origin ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
        await page.locator('#username').fill(process.env.TEST_USER);
        await page.locator('#password').fill(process.env.TEST_PASS);
        await page.locator('#loginForm button[type="submit"]').click();
        await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45_000 });
        await page.goto(`${base}/?businessContext=dar&date=2026-12-15`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.EducationGroups && window.EducationAttendance
            && window.TimelineBusinessContext?.current()?.apiValue === 'dar');
        await page.locator('[data-education-schedule-tab="groups"]').click();

        const switchTo = async business => {
            const observed = await page.evaluate(async next => {
                const result = await window.CrmBusinessContext.switchTo(next, { navigate: false, updateUrl: true });
                return {
                    result,
                    crm: window.CrmBusinessContext.current(),
                    timeline: window.TimelineBusinessContext.current().apiValue,
                    query: window.location.search
                };
            }, business);
            assert.equal(observed.timeline, business, `business switch did not update the timeline: ${JSON.stringify(observed)}`);
        };

        await page.locator('#mainApp').waitFor({state:'visible'});
        await page.waitForFunction(()=>window.isAuthenticatedRuntimeReady?.()&&window.EducationGroups.state.listStatus==='ready');
        await page.waitForLoadState('networkidle');
        const groups = [];
        let freshAfter=Infinity;
        const delivered=new WeakSet(), pendingDeliveries=new Set();
        // These are controlled frontend contract tests with mocked payloads,
        // not an end-to-end education lifecycle or PostgreSQL persistence proof.
        const deliver = async (route, payload) => {
            if(delivered.has(route))return;
            delivered.add(route);
            const finished = page.waitForEvent('requestfinished', { predicate: request => request === route.request() });
            await route.fulfill(payload);
            await finished;
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        };
        // Business and authenticated-runtime events may each load the active A.
        // Hold stale A/B, but never leave a newer active-A mock unresolved.
        await page.route('**/api/education/groups?*', route => {
            groups.push(route);
            if(groups.length-1>=freshAfter&&route.request().url().includes('businessContext=dar')){
                const task=deliver(route,{status:200,json:{groups:[group(3,'Fresh A')]}});
                pendingDeliveries.add(task);
                task.finally(()=>pendingDeliveries.delete(task));
                return task;
            }
        });
        await page.evaluate(() => { void window.EducationGroups.load(); });
        const first = await waitForRequest(groups, 0, route => route.request().url().includes('businessContext=dar'));
        const beforeB = groups.length;
        await switchTo('event_genix');
        await waitForRequest(groups, beforeB, route => route.request().url().includes('businessContext=event_genix'));
        const beforeFinalA = groups.length;
        await switchTo('dar');
        freshAfter=beforeFinalA;
        for(const route of groups.slice(beforeFinalA))await deliver(route,{status:200,json:{groups:[group(3,'Fresh A')]}});
        const beforeExplicitA = groups.length;
        await page.evaluate(() => { void window.EducationGroups.load(); });
        const finalA = await waitForRequest(groups, beforeExplicitA,
            route => route.request().url().includes('businessContext=dar'));
        await deliver(finalA, { status: 200, json: { groups: [group(3, 'Fresh A')] } });
        await page.waitForFunction(() => window.EducationGroups.state.groups.some(group => group.name === 'Fresh A'));
        const freshState = await page.evaluate(() => ({
            groups: window.EducationGroups.state.groups.map(item => item.name),
            business: window.TimelineBusinessContext.current().apiValue,
            status: document.getElementById('educationGroupsStatus')?.textContent
        }));
        assert.deepEqual(freshState.groups, ['Fresh A'], `fresh group response was ignored: ${JSON.stringify({ freshState, pending: groups.map(route => route.request().url()), pageErrors })}`);
        for (const route of groups.slice(beforeB, beforeFinalA)) {
            await deliver(route, { status: 200, json: { groups: [group(2, 'Stale B')] } });
        }
        await deliver(first, { status: 200, json: { groups: [group(1, 'Stale A')] } });
        for (const route of groups.slice(beforeFinalA)) {
            if (route !== finalA) await deliver(route, { status: 200, json: { groups: [group(3, 'Fresh A')] } });
        }
        assert.deepEqual(await page.evaluate(() => window.EducationGroups.state.groups.map(item => item.name)), ['Fresh A']);
        assert.match(await page.locator('#educationGroupsList').innerText(), /Fresh A/);
        await Promise.all([...pendingDeliveries]);await page.unroute('**/api/education/groups?*');

        const journals = [];
        await page.route('**/api/education/attendance/qa-lesson-a?*', route => { journals.push(route); });
        await page.evaluate(() => { void window.EducationAttendance.openBooking('qa-lesson-a'); });
        const oldJournal = await waitForRequest(journals, 0, () => true);
        await switchTo('event_genix');
        await deliver(oldJournal, { status: 200, json: { journal: journal('qa-lesson-a', 'Private A lesson') } });
        assert.equal(await page.evaluate(() => window.EducationAttendance.state.journal), null);
        assert.doesNotMatch(await page.locator('#educationAttendanceJournal').innerText(), /Private A lesson/);
        await page.unroute('**/api/education/attendance/qa-lesson-a?*');

        await switchTo('dar');
        const reports = [];
        await page.route('**/api/education/reports?*', route => { reports.push(route); });
        await page.evaluate(() => { void window.EducationAttendance.runReport(); });
        const oldReport = await waitForRequest(reports, 0, () => true);
        await switchTo('event_genix');
        await deliver(oldReport, { status: 200, json: { report: report('Private A report') } });
        assert.doesNotMatch(await page.locator('#educationReportResult').innerText(), /Private A report/);
        await page.unroute('**/api/education/reports?*');

        await switchTo('dar');
        await page.locator('#educationGroupsList').selectOption('');
        await page.locator('#educationGroupName').fill('Private A draft');
        await page.locator('#educationGroupCapacity').fill('3');
        const saves = [];
        const savePattern = /\/api\/education\/groups\/?(?:\?|$)/;
        await page.route(savePattern, route => {
            if (route.request().method() === 'POST') saves.push(route);
            else return route.continue();
        });
        await page.locator('#educationGroupForm button[type="submit"]').click();
        const oldSave = await waitForRequest(saves, 0, () => true);
        assert.match(oldSave.request().postData() || '', /"businessContext":"dar"/);
        await switchTo('event_genix');
        assert.equal(await page.locator('#educationGroupName').inputValue(), '');
        await deliver(oldSave, { status: 201, json: { group: group(7, 'Private A draft') } });
        assert.equal(await page.locator('#educationGroupName').inputValue(), '');
        assert.equal(await page.locator('#educationGroupsList').inputValue(), '');
        assert.equal(await page.evaluate(() => window.EducationGroups.state.current), null);
        assert.doesNotMatch(await page.locator('#educationGroupsStatus').innerText(), /збережено/);
        await page.unroute(savePattern);
        assert.deepEqual(pageErrors, [], 'actual app has no uncaught browser errors');
        console.log('Education actual-app A→B→A groups, journal, report, and in-flight save: PASS');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
