'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { chromium } = require(process.env.EDU_QA_PLAYWRIGHT);
const viewport = process.env.EDU_READY_PHONE === 'true' ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
const { DATABASES, assertLocalTarget, seedDataset } = require('../../scripts/lib/education-ready-dataset');
const { createResults } = require('../helpers/education-ready-results');
assertLocalTarget('fixed');
const base = process.env.TEST_URL;
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const out = path.resolve(process.env.EDU_READY_OUTPUT || 'output/education-ready/03', `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const results = createResults();
const evidence = { phase: process.env.EDU_GROUPS_PHASE || 'postfix', viewport, checks: results.results, proofs: {}, pageErrors: [], requests: [], screenshots: [] };
const pool = new Pool({ host: '127.0.0.1', port: 55469, database: DATABASES.fixed, user: 'postgres', ssl: false });
let token, manifest, browser, createdId, foreignTeacher;
function flush() {
    let text = JSON.stringify(evidence, null, 2);
    for (const value of [token, process.env.TEST_USER, process.env.TEST_PASS].filter(Boolean)) text = text.split(value).join('[REDACTED]');
    fs.writeFileSync(path.join(out, 'verification.json'), text);
}
async function check(id, action, dependsOn = []) {
    await results.check(id, id, action, id === 'fixtures' ? {} : { dependsOn: ['fixtures', ...dependsOn] });
    flush(); console.log(`${results.results.at(-1).status} ${id}`);
}
async function api(route, status = 200, method = 'GET', body) {
    const response = await fetch(base + route, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    assert.equal(response.status, status, `${method} ${route.split('?')[0]}`); return response.json();
}
async function pageFor(action, teacherFault = false) {
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Europe/Kyiv', viewport, hasTouch: process.env.EDU_READY_PHONE === 'true', isMobile: process.env.EDU_READY_PHONE === 'true' });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    if (teacherFault) await context.route('**/api/education/groups/teachers?*', route => route.fulfill({ status: 500, json: { error: 'Controlled teacher loader failure' } }));
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => evidence.pageErrors.push(error.message));
    page.on('response', response => {
        const url = new URL(response.url());
        if (/^\/api\/(education|staff)/.test(url.pathname)) evidence.requests.push({ path: url.pathname, method: response.request().method(), status: response.status() });
    });
    try {
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.locator('#username').fill(process.env.TEST_USER); await page.locator('#password').fill(process.env.TEST_PASS);
        await page.locator('#loginForm button[type="submit"]').click(); await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
        await page.goto(`${base}/?businessContext=dar&educationSchedule=groups&date=${manifest.anchorDate}`, { waitUntil: 'domcontentloaded' });
        await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
        await page.waitForFunction(() => window.EducationScheduleWorkspace?.state.activeView === 'groups' && window.CrmBusinessContext?.current?.() === 'dar');
        return await action(page);
    } finally { await context.close(); }
}
async function select(page, id) {
    await page.locator(`#educationGroupsList option[value="${id}"]`).waitFor({ state: 'attached' });
    await page.locator('#educationGroupsList').selectOption(String(id));
    await page.waitForFunction(id => String(window.EducationGroups?.state.current?.id) === String(id), id);
}
function barrier() {
    let release, arrive; const entered = new Promise(resolve => { arrive = resolve; });
    const released = new Promise(resolve => { release = resolve; }); return { release, arrive, entered, released };
}
async function deadline(promise) {
    let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Controlled barrier timeout')), 12000); })]); }
    finally { clearTimeout(timer); }
}
async function shot(page, name) {
    assert.ok(!(await page.locator('body').innerText()).includes(process.env.TEST_USER));
    await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(out, `${name}.png`) }); evidence.screenshots.push(`${name}.png`);
}
async function groupsSql(ids) { return (await pool.query('SELECT id,name,teacher_id,capacity,status FROM education_groups WHERE id=ANY($1::int[]) ORDER BY id', [ids])).rows; }
async function save(page) {
    await page.locator('#educationGroupForm button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('educationGroupsStatus').textContent === 'Групу збережено.' && !document.getElementById('educationGroupForm').hasAttribute('aria-busy'));
}
async function paint(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function search(page, query) {
    await page.locator('#educationChildSearch').fill(query);
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/education/groups/children/search');
    await page.locator('#educationChildFind').click(); assert.equal((await response).status(), 200); await paint(page);
}
async function main() {
    await check('fixtures', async () => {
        const auth = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.TEST_USER, password: process.env.TEST_PASS }) });
        assert.equal(auth.status, 200); const payload = await auth.json(); token = payload.accessToken || payload.token;
        manifest = (await seedDataset(pool, 'fixed')).manifest;
        for (const businessContext of ['dar', 'maysternya_doli']) await api(`/api/business/cabinet?businessContext=${businessContext}`, 200, 'PUT', { businessType: 'education', timelineMode: 'education', resourceModel: 'cabinet' });
        evidence.anchor = manifest.anchorDate; evidence.ids = manifest.ids;
    });
    if (!manifest) return;
    browser = await chromium.launch({ headless: true });
    await check('F01-pending-selection', () => pageFor(async page => {
        const a = manifest.ids.groups.english, b = manifest.ids.groups.robots;
        const before = await groupsSql([a, b]); await select(page, a);
        const gate = barrier();
        await page.route(`**/api/education/groups/${b}?*`, async route => { const response = await route.fetch(); gate.arrive(response.status()); await gate.released; await route.fulfill({ response }); });
        try {
            await page.locator('#educationGroupsList').selectOption(String(b)); assert.equal(await deadline(gate.entered), 200);
            const submit = page.locator('#educationGroupForm button[type="submit"]');
            evidence.proofs.F01 = { selected: await page.locator('#educationGroupsList').inputValue(), saveEnabled: await submit.isEnabled() };
            if (await submit.isEnabled()) {
                await page.locator('#educationGroupName').fill('Юні винахідники — вечірня група');
                const response = page.waitForResponse(r => r.request().method() === 'PUT' && /^\/api\/education\/groups\/\d+$/.test(new URL(r.url()).pathname));
                await submit.click(); evidence.proofs.F01.writeStatus = (await response).status();
            }
            evidence.proofs.F01.before = before; evidence.proofs.F01.after = await groupsSql([a, b]); await shot(page, 'F01-pending');
            assert.deepEqual(evidence.proofs.F01.after, before, 'Pending B must not change A or B');
            assert.equal(await submit.isDisabled(), true);
            assert.equal(await page.locator('#educationGroupArchive').isDisabled(), true);
            assert.equal(await page.locator('#educationGroupRoster').isVisible(), false);
        } finally { gate.release(); }
        if (evidence.phase !== 'baseline') {
            await page.waitForFunction(id => String(window.EducationGroups.state.current?.id) === String(id), b);
            await page.locator('#educationGroupName').fill('Юні винахідники — вечірня група'); await save(page);
            const after = await groupsSql([a, b]); assert.deepEqual(after.find(row => String(row.id) === String(a)), before.find(row => String(row.id) === String(a)));
            assert.equal(after.find(row => String(row.id) === String(b)).name, 'Юні винахідники — вечірня група');
            const detail = (await api(`/api/education/groups/${b}?businessContext=dar`)).group;
            assert.equal(detail.teacher_id, manifest.ids.teachers[1]); evidence.proofs.F01.savedB = after;
        }
    }));
    await check('F02-teacher-retention-on-failure', () => pageFor(async page => {
        const id = manifest.ids.groups.school; await select(page, id); const before = (await groupsSql([id]))[0];
        await page.locator('#educationGroupName').fill('Готуємося до школи — суботня група');
        await save(page); const after = (await groupsSql([id]))[0];
        const detail = (await api(`/api/education/groups/${id}?businessContext=dar`)).group;
        evidence.proofs.F02 = { before, after, apiTeacher: detail.teacher_id }; await shot(page, 'F02-teacher-loader-failure');
        assert.equal(after.teacher_id, before.teacher_id); assert.equal(detail.teacher_id, before.teacher_id);
        assert.equal(await page.locator('#educationGroupTeacher').inputValue(), String(before.teacher_id));
    }, true));
    if (evidence.phase !== 'baseline') {
        await check('teacher-source-and-isolation', () => pageFor(async page => {
            await page.waitForFunction(() => window.EducationGroups.state.teacherStatus === 'ready');
            const primary = await api('/api/education/groups/teachers?businessContext=dar');
            assert.equal(primary.teachers.length, 4);
            assert.ok(primary.teachers.every(row => Object.keys(row).sort().join(',') === 'id,is_active,name'));
            for (const teacher of primary.teachers) assert.equal(await page.locator(`#educationGroupTeacher option[value="${teacher.id}"]`).count(), 1);
            foreignTeacher = (await pool.query("INSERT INTO staff(name,department,position,is_active) VALUES ('Дарина Гончаренко','Навчання','Викладач',true) RETURNING id")).rows[0].id;
            await pool.query('UPDATE education_groups SET teacher_id=$1 WHERE id=$2', [foreignTeacher, manifest.ids.groups.secondary]);
            const second = await api('/api/education/groups/teachers?businessContext=maysternya_doli');
            assert.ok(second.teachers.some(row => Number(row.id) === Number(foreignTeacher)));
            assert.ok(!(await api('/api/education/groups/teachers?businessContext=dar')).teachers.some(row => Number(row.id) === Number(foreignTeacher)));
            // Untrusted historical lesson metadata is not an authoritative staff/business assignment.
            const bookingId = manifest.ids.bookings['english-7'];
            const storedExtra = (await pool.query('SELECT extra_data FROM bookings WHERE id=$1', [bookingId])).rows[0].extra_data;
            await pool.query("UPDATE bookings SET extra_data=jsonb_set(extra_data,'{educationLesson,teacherId}',to_jsonb($2::text)) WHERE id=$1", [bookingId, String(foreignTeacher)]);
            assert.ok(!(await api('/api/education/groups/teachers?businessContext=dar')).teachers.some(row => Number(row.id) === Number(foreignTeacher)));
            await pool.query('UPDATE bookings SET extra_data=$2::jsonb WHERE id=$1', [bookingId, JSON.stringify(storedExtra)]);
            assert.deepEqual((await api('/api/education/groups/teachers?businessContext=event_genix')).teachers, []);
            await api('/api/staff?businessContext=dar&active=true', 403);
            const before = await groupsSql([manifest.ids.groups.english]);
            await api(`/api/education/groups/${manifest.ids.groups.english}?businessContext=dar`, 404, 'PUT', { name: before[0].name, capacity: 6, teacherId: foreignTeacher, businessContext: 'dar' });
            assert.deepEqual(await groupsSql([manifest.ids.groups.english]), before);
            await api(`/api/education/groups/${manifest.ids.groups.secondary}?businessContext=dar`, 404);
            const children = await api('/api/education/groups/children/search?businessContext=dar&q=Софія');
            assert.ok(children.children.length > 0);
            assert.ok(children.children.every(row => ![manifest.ids.children['second-0'], manifest.ids.children['second-1']].map(String).includes(String(row.id))));
            await shot(page, 'teacher-source'); evidence.proofs.teacherSource = { primaryCount: 4, foreignTeacherExcluded: true, forgedLessonReferenceExcluded: true, legacyStaffStatus: 403, fields: ['id', 'name', 'is_active'] };
        }));
        await check('failed-detail-retry-and-stale-response', () => pageFor(async page => {
            const a = manifest.ids.groups.english, b = manifest.ids.groups.arts; await select(page, a); const before = await groupsSql([a, b]);
            await page.route(`**/api/education/groups/${b}?*`, route => route.fulfill({ status: 500, json: { error: 'Controlled detail failure' } }));
            await page.locator('#educationGroupsList').selectOption(String(b));
            await page.locator('#educationGroupRetry').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#educationGroupForm button[type="submit"]').isDisabled(), true);
            assert.equal(await page.locator('#educationGroupName').inputValue(), '');
            assert.deepEqual(await groupsSql([a, b]), before);
            await page.unroute(`**/api/education/groups/${b}?*`); await page.locator('#educationGroupRetry').click();
            await page.waitForFunction(id => String(window.EducationGroups.state.current?.id) === String(id), b);
            const gate = barrier(); await page.route(`**/api/education/groups/${a}?*`, async route => { const response = await route.fetch(); gate.arrive(); await gate.released; await route.fulfill({ response }); });
            try {
                await page.locator('#educationGroupsList').selectOption(String(a)); await deadline(gate.entered); await select(page, b);
                gate.release(); await page.waitForResponse(r => new URL(r.url()).pathname === `/api/education/groups/${a}`); await paint(page);
                assert.equal(await page.locator('#educationGroupsList').inputValue(), String(b));
                assert.equal(await page.locator('#educationGroupName').inputValue(), before.find(row => String(row.id) === String(b)).name);
                assert.deepEqual(await groupsSql([a, b]), before);
            } finally { gate.release(); }
            await shot(page, 'detail-retry');
        }));
        await check('teacher-retry-keeps-draft-and-explicit-none', () => pageFor(async page => {
            await select(page, manifest.ids.groups.school);
            await page.locator('#educationTeachersRetry').waitFor({ state: 'visible' });
            await page.locator('#educationGroupName').fill('Готуємося до школи — ранкова група');
            await page.context().unroute('**/api/education/groups/teachers?*');
            await page.locator('#educationTeachersRetry').click(); await page.waitForFunction(() => window.EducationGroups.state.teacherStatus === 'ready');
            assert.equal(await page.locator('#educationGroupName').inputValue(), 'Готуємося до школи — ранкова група');
            assert.equal(await page.locator('#educationGroupTeacher').inputValue(), String(manifest.ids.teachers[3]));
            await page.locator('#educationGroupTeacher').selectOption(''); await save(page);
            assert.equal((await groupsSql([manifest.ids.groups.school]))[0].teacher_id, null);
            assert.equal((await api(`/api/education/groups/${manifest.ids.groups.school}?businessContext=dar`)).group.teacher_id, null);
        }, true));
        await check('create-double-submit-and-retry', () => pageFor(async page => {
            await page.locator('#educationGroupsList').selectOption('');
            await page.waitForFunction(() => window.EducationGroups.state.teacherStatus === 'ready');
            await page.locator('#educationGroupName').fill('Клуб винахідників — суботня зустріч'); await page.locator('#educationGroupCapacity').fill('1');
            await page.locator('#educationGroupTeacher').selectOption(String(manifest.ids.teachers[1]));
            const routePath = '**/api/education/groups/';
            await page.route(routePath, route => route.request().method() === 'POST' ? route.fulfill({ status: 500, json: { error: 'Controlled save failure' } }) : route.continue());
            await page.locator('#educationGroupForm button[type="submit"]').click();
            await page.waitForFunction(() => document.getElementById('educationGroupsStatus').textContent === 'Controlled save failure');
            assert.equal(await page.locator('#educationGroupName').inputValue(), 'Клуб винахідників — суботня зустріч');
            assert.equal((await pool.query("SELECT count(*)::int n FROM education_groups WHERE name='Клуб винахідників — суботня зустріч'")).rows[0].n, 0);
            await page.unroute(routePath);
            const gate = barrier(); let posts = 0;
            await page.route(routePath, async route => { if (route.request().method() !== 'POST') return route.continue(); posts++; gate.arrive(); await gate.released; await route.continue(); });
            try {
                await page.locator('#educationGroupForm button[type="submit"]').dblclick(); await deadline(gate.entered);
                await page.locator('#educationGroupForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
                gate.release(); await page.waitForFunction(() => document.getElementById('educationGroupsStatus').textContent === 'Групу збережено.');
            } finally { gate.release(); }
            assert.equal(posts, 1);
            const rows = (await pool.query("SELECT * FROM education_groups WHERE name='Клуб винахідників — суботня зустріч'")).rows;
            assert.equal(rows.length, 1); createdId = rows[0].id; assert.equal(rows[0].teacher_id, manifest.ids.teachers[1]);
            assert.equal((await api(`/api/education/groups/${createdId}?businessContext=dar`)).group.capacity, 1);
            evidence.proofs.create = { id: createdId, successfulPosts: posts, count: rows.length };
        }));
        await check('search-enroll-capacity-end-membership-archive', () => pageFor(async page => {
            assert.ok(createdId, 'Create prerequisite must exist'); await select(page, createdId);
            await search(page, 'Романюк');
            await page.locator('#educationChildSelect').selectOption(String(manifest.ids.children['child-0']));
            await page.locator('#educationMemberStart').fill(manifest.anchorDate);
            const gate = barrier(); let enrollPosts = 0;
            await page.route(`**/api/education/groups/${createdId}/members`, async route => { enrollPosts++; gate.arrive(); await gate.released; await route.continue(); });
            try {
                await page.locator('#educationGroupEnrollForm button[type="submit"]').dblclick(); await deadline(gate.entered);
                await page.locator('#educationGroupEnrollForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
                gate.release(); await page.waitForFunction(() => document.getElementById('educationGroupsStatus').textContent === 'Дитину зараховано.');
            } finally { gate.release(); }
            assert.equal(enrollPosts, 1); await page.unroute(`**/api/education/groups/${createdId}/members`);
            const member = (await pool.query('SELECT * FROM education_group_members WHERE group_id=$1', [createdId])).rows;
            assert.equal(member.length, 1); assert.equal(member[0].child_id, manifest.ids.children['child-0']);
            await search(page, 'Романюк'); await page.locator('#educationChildSelect').selectOption(String(manifest.ids.children['child-1']));
            await page.locator('#educationMemberStart').fill(manifest.anchorDate); await page.locator('#educationGroupEnrollForm button[type="submit"]').click();
            await page.waitForFunction(() => document.getElementById('educationGroupsStatus').textContent === 'Group capacity exceeded');
            assert.equal((await pool.query('SELECT count(*)::int n FROM education_group_members WHERE group_id=$1', [createdId])).rows[0].n, 1);
            assert.equal(await page.locator('#educationChildSelect').inputValue(), String(manifest.ids.children['child-1']));
            const end = new Date(`${manifest.anchorDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1); const endDate = end.toISOString().slice(0, 10);
            page.once('dialog', dialog => dialog.accept(endDate)); await page.locator(`[data-end-member="${member[0].id}"]`).click();
            await page.waitForFunction(() => document.getElementById('educationGroupsStatus').textContent === 'Членство завершено.');
            assert.equal((await pool.query('SELECT end_date::text end_date FROM education_group_members WHERE id=$1', [member[0].id])).rows[0].end_date, endDate);
            const unchanged = await groupsSql([manifest.ids.groups.english]);
            page.once('dialog', dialog => dialog.accept()); await page.locator('#educationGroupArchive').click();
            await page.waitForFunction(() => document.getElementById('educationGroupsStatus').textContent === 'Групу архівовано.');
            assert.equal((await groupsSql([createdId]))[0].status, 'archived');
            assert.equal((await api(`/api/education/groups/${createdId}?businessContext=dar`)).group.members.length, 1);
            assert.deepEqual(await groupsSql([manifest.ids.groups.english]), unchanged);
            assert.equal(await page.locator('#educationGroupForm button[type="submit"]').isDisabled(), true); await shot(page, 'membership-archive');
        }), ['create-double-submit-and-retry']);
        await check('capacity-edit-rejects-too-small-keeps-draft', () => pageFor(async page => {
            await select(page, manifest.ids.groups.english); const before = await groupsSql([manifest.ids.groups.english]);
            await page.locator('#educationGroupCapacity').fill('5'); await page.locator('#educationGroupForm button[type="submit"]').click();
            await page.waitForFunction(() => document.getElementById('educationGroupsStatus').textContent === 'Capacity is below existing membership');
            assert.equal(await page.locator('#educationGroupCapacity').inputValue(), '5'); assert.deepEqual(await groupsSql([manifest.ids.groups.english]), before);
            await page.locator('#educationGroupCapacity').fill('6'); await save(page); assert.deepEqual(await groupsSql([manifest.ids.groups.english]), before);
        }));
        await check('business-switch-pending-write', () => pageFor(async page => {
            const id = manifest.ids.groups.arts, gate = barrier(); await select(page, id); const beforeForeign = await groupsSql([manifest.ids.groups.secondary]);
            await page.locator('#educationGroupName').fill('Творча майстерня — нові історії');
            let committed;
            await page.route(`**/api/education/groups/${id}`, async route => {
                const response = await route.fetch(); committed = response.status(); gate.arrive(); await gate.released;
                await route.fulfill({ response }).catch(error => { if (!/closed|canceled|disposed|interception/i.test(error.message)) throw error; });
            });
            try {
                await page.locator('#educationGroupForm button[type="submit"]').click(); await deadline(gate.entered); assert.equal(committed, 200);
                await page.locator('#sidebarBusinessContextSelect').selectOption('maysternya_doli');
                await page.waitForFunction(() => window.CrmBusinessContext?.current?.() === 'maysternya_doli' && document.getElementById('sidebarBusinessContextSelect')?.disabled === false);
                gate.release(); await paint(page);
                assert.equal(await page.locator('#educationGroupName').inputValue(), '');
                assert.deepEqual(await groupsSql([manifest.ids.groups.secondary]), beforeForeign);
                assert.equal((await groupsSql([id]))[0].name, 'Творча майстерня — нові історії');
                assert.ok(!(await page.locator('#educationGroupsList').innerText()).includes('Творча майстерня — нові історії'));
            } finally { gate.release(); }
        }));
        await check('late-search-member-and-archive-responses', () => pageFor(async page => {
            const a = manifest.ids.groups.empty, b = manifest.ids.groups.english;
            const untouched = await groupsSql([b]); await select(page, a);
            const searchGate = barrier();
            await page.route('**/api/education/groups/children/search?*', async route => { const response = await route.fetch(); searchGate.arrive(); await searchGate.released; await route.fulfill({ response }); });
            try {
                await page.locator('#educationChildSearch').fill('Романюк'); await page.locator('#educationChildFind').click(); await deadline(searchGate.entered);
                await select(page, b);
                const delivered = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/children/search'));
                searchGate.release(); await (await delivered).finished(); await paint(page);
                assert.equal(await page.locator('#educationChildSelect option').count(), 1);
            } finally { searchGate.release(); }
            await page.unroute('**/api/education/groups/children/search?*'); await select(page, a); await search(page, 'Романюк');
            await page.locator('#educationChildSelect').selectOption(String(manifest.ids.children['child-1'])); await page.locator('#educationMemberStart').fill(manifest.anchorDate);
            async function heldWrite(routePath, trigger) {
                const gate = barrier(); let writes = 0;
                await page.route(routePath, async route => { writes++; const response = await route.fetch(); assert.ok(response.ok()); gate.arrive(); await gate.released; await route.fulfill({ response }); });
                try {
                    await trigger(); await deadline(gate.entered);
                    await select(page, b); const delivered = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(routePath.slice(2)));
                    gate.release(); await (await delivered).finished(); await paint(page);
                    assert.equal(writes, 1); assert.equal(await page.locator('#educationGroupsList').inputValue(), String(b));
                    assert.equal(await page.locator('#educationGroupName').inputValue(), untouched[0].name);
                    assert.deepEqual(await groupsSql([b]), untouched);
                } finally { gate.release(); await page.unroute(routePath); }
            }
            await heldWrite(`**/api/education/groups/${a}/members`, async () => {
                await page.locator('#educationGroupEnrollForm button[type="submit"]').click();
                await page.locator('#educationGroupEnrollForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
            });
            const member = (await pool.query('SELECT * FROM education_group_members WHERE group_id=$1', [a])).rows;
            assert.equal(member.length, 1); assert.equal(member[0].child_id, manifest.ids.children['child-1']);
            await select(page, a);
            await heldWrite(`**/api/education/groups/${a}/members/${member[0].id}/end`, async () => {
                page.once('dialog', dialog => dialog.accept(manifest.anchorDate)); await page.locator(`[data-end-member="${member[0].id}"]`).click();
                await page.locator(`[data-end-member="${member[0].id}"]`).evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
            });
            assert.equal((await pool.query('SELECT end_date::text FROM education_group_members WHERE id=$1', [member[0].id])).rows[0].end_date, manifest.anchorDate);
            await select(page, a);
            await heldWrite(`**/api/education/groups/${a}/archive`, async () => {
                page.once('dialog', dialog => dialog.accept()); await page.locator('#educationGroupArchive').click();
                await page.locator('#educationGroupArchive').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
            });
            assert.equal((await groupsSql([a]))[0].status, 'archived');
            assert.equal((await api(`/api/education/groups/${b}?businessContext=dar`)).group.name, untouched[0].name);
            evidence.proofs.lateActions = { selectedBUnchanged: true, oneEnroll: true, oneEnd: true, oneArchive: true, staleSearchIgnored: true };
        }));
        await check('lesson-teacher-source-failure-and-retry', () => pageFor(async page => {
            const id = manifest.ids.bookings['english-4'];
            await page.goto(`${base}/?businessContext=dar&educationSchedule=schedule&date=${manifest.anchorDate}`, { waitUntil: 'domcontentloaded' });
            await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
            await page.locator(`.booking-block[data-booking-id="${id}"]`).first().click(); await page.locator('#bookingModal').waitFor({ state: 'visible' });
            await page.locator('#bookingModal .btn-edit-booking').click(); await page.locator('#educationLessonTeacher').waitFor({ state: 'visible' });
            await page.locator('#educationLessonTeachersRetry').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#educationLessonTeacher').inputValue(), String(manifest.ids.teachers[0]));
            assert.equal(await page.locator('#educationLessonTeacher').isDisabled(), true);
            const before = (await pool.query('SELECT extra_data,duration FROM bookings WHERE id=$1', [id])).rows[0];
            await page.context().unroute('**/api/education/groups/teachers?*'); await page.locator('#educationLessonTeachersRetry').click();
            await page.waitForFunction(() => !document.getElementById('educationLessonTeacher').disabled);
            // The earlier explicit-none scenario removed the school group's assignment.
            // Explicit memberships keep the school teacher eligible even after group unassignment.
            const assigned = (await pool.query("SELECT DISTINCT teacher_id FROM education_groups WHERE business_context='dar' AND teacher_id IS NOT NULL ORDER BY teacher_id")).rows.map(row => Number(row.teacher_id));
            assert.deepEqual(assigned, manifest.ids.teachers.slice(0, 3).map(Number));
            const members = (await pool.query("SELECT staff_id FROM education_teacher_memberships WHERE business_context='dar' AND is_active=true ORDER BY staff_id")).rows.map(row=>Number(row.staff_id));
            assert.deepEqual(members,manifest.ids.teachers.map(Number));
            assert.equal(await page.locator('#educationLessonTeacher option').count(), 5);
            assert.equal(await page.locator('#educationLessonTeacher').inputValue(), String(manifest.ids.teachers[0]));
            assert.equal(await page.locator(`#educationLessonTeacher option[value="${foreignTeacher}"]`).count(), 0);
            assert.deepEqual((await pool.query('SELECT extra_data,duration FROM bookings WHERE id=$1', [id])).rows[0], before);
            await shot(page, 'lesson-teacher-retry'); evidence.proofs.lessonTeacher = { assignedPreserved: true, availableTeachers: 3, foreignExcluded: true, noLessonWrite: true };
        }, true), ['teacher-source-and-isolation', 'teacher-retry-keeps-draft-and-explicit-none']);
        await check('inactive-assigned-teacher-and-omitted-field', async () => {
            const id = manifest.ids.groups.english, teacherId = manifest.ids.teachers[0];
            await pool.query('UPDATE staff SET is_active=false WHERE id=$1', [teacherId]);
            await pageFor(async page => {
                await page.waitForFunction(() => window.EducationGroups.state.teacherStatus === 'ready');
                await select(page, id);
                assert.equal(await page.locator('#educationGroupTeacher').inputValue(), String(teacherId));
                await page.locator('#educationGroupName').fill('Англійська: Перші слова — ранкова група'); await save(page);
                assert.equal((await groupsSql([id]))[0].teacher_id, teacherId);
                await api(`/api/education/groups/${id}?businessContext=dar`, 200, 'PUT', { name: 'Англійська: Перші слова — ранкова група', capacity: 7, businessContext: 'dar' });
                const sql = (await groupsSql([id]))[0]; assert.equal(sql.teacher_id, teacherId); assert.equal(sql.capacity, 7);
                assert.equal((await api(`/api/education/groups/${id}?businessContext=dar`)).group.teacher_id, teacherId);
                evidence.proofs.inactiveTeacher = { preservedUiRename: true, omittedApiFieldPreserved: true };
            });
        });
        await check('successful-create-list-failure-retry-retains-identity', () => pageFor(async page => {
            await page.locator('#educationGroupsList').selectOption('');
            await page.locator('#educationGroupName').fill('Маленькі дослідники — недільний клуб'); await page.locator('#educationGroupCapacity').fill('4');
            await page.route('**/api/education/groups?*', route => route.fulfill({ status: 500, json: { error: 'Controlled list refresh failure' } }));
            await page.locator('#educationGroupForm button[type="submit"]').click(); await page.locator('#educationGroupRetry').waitFor({ state: 'visible' });
            const rows = (await pool.query("SELECT id FROM education_groups WHERE name='Маленькі дослідники — недільний клуб'")).rows;
            assert.equal(rows.length, 1); assert.equal(await page.locator('#educationGroupsList').inputValue(), String(rows[0].id));
            assert.equal(await page.locator('#educationGroupForm button[type="submit"]').isDisabled(), true);
            await page.unroute('**/api/education/groups?*'); await page.locator('#educationGroupRetry').click();
            await page.waitForFunction(id => String(window.EducationGroups.state.current?.id) === String(id), rows[0].id);
            assert.equal(await page.locator('#educationGroupName').inputValue(), 'Маленькі дослідники — недільний клуб');
            assert.equal((await pool.query("SELECT count(*)::int n FROM education_groups WHERE name='Маленькі дослідники — недільний клуб'")).rows[0].n, 1);
            assert.equal((await api(`/api/education/groups/${rows[0].id}?businessContext=dar`)).group.name, 'Маленькі дослідники — недільний клуб');
            evidence.proofs.committedCreateRetry = { count: 1, identityPreserved: true };
        }));
    }
    await check('page-errors', async () => assert.deepEqual(evidence.pageErrors, []));
}
main().catch(error => { evidence.fatal = error.message; process.exitCode = 1; }).finally(async () => {
    if (browser) await browser.close(); await pool.end(); evidence.exitCode = process.exitCode || results.exitCode(); process.exitCode = evidence.exitCode; flush();
    console.log(`Evidence: ${path.relative(process.cwd(), out)}; exit=${evidence.exitCode}`);
});
