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
const out = path.resolve(process.env.EDU_READY_OUTPUT || 'output/education-ready/04', `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const results = createResults();
const evidence = { phase: process.env.EDU_LIFECYCLE_PHASE || 'postfix', viewport, checks: results.results, proofs: {}, pageErrors: [], screenshots: [] };
const focused = (process.env.EDU_LIFECYCLE_ONLY || '').split(',').filter(Boolean);
evidence.coverage = focused.length ? { mode: 'FOCUSED', selected: focused } : { mode: 'FULL' };
const pool = new Pool({ host: '127.0.0.1', port: 55469, database: DATABASES.fixed, user: 'postgres', ssl: false });
let token, manifest, browser;
function flush() {
    let text = JSON.stringify(evidence, null, 2);
    for (const value of [token, process.env.TEST_USER, process.env.TEST_PASS].filter(Boolean)) text = text.split(value).join('[REDACTED]');
    fs.writeFileSync(path.join(out, 'verification.json'), text);
}
async function check(id, action, dependsOn = []) {
    if (focused.length && !['fixtures','page-errors', ...focused].includes(id)) {
        results.results.push({ id, name: id, status: 'NOT_RUN' }); flush(); return;
    }
    await results.check(id, id, action, id === 'fixtures' ? {} : { dependsOn: ['fixtures', ...dependsOn] }); flush(); console.log(`${results.results.at(-1).status} ${id}`);
}
async function api(route, status = 200, method = 'GET', body) {
    const response = await fetch(base + route, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const data = await response.json();
    if (response.status !== status) evidence.lastContractFailure = { path: route.split('?')[0], method, status: response.status, expected: status, code: data.code, error: data.error };
    assert.equal(response.status, status, `${method} ${route.split('?')[0]} ${data.error || ''}`); return data;
}
async function row(id) { return (await pool.query('SELECT id,date::text,time,duration,program_name,room,room_resource_id,line_id,group_name,kids_count,status,extra_data FROM bookings WHERE id=$1', [id])).rows[0]; }
async function pageFor(action) {
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Europe/Kyiv', viewport, hasTouch: process.env.EDU_READY_PHONE === 'true', isMobile: process.env.EDU_READY_PHONE === 'true' });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => evidence.pageErrors.push(error.message));
    try {
        await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.locator('#username').fill(process.env.TEST_USER); await page.locator('#password').fill(process.env.TEST_PASS);
        await page.locator('#loginForm button[type="submit"]').click(); await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
        await action(page);
    } catch (error) {
        evidence.lastFailure = await page.evaluate(() => ({ view: window.EducationScheduleWorkspace?.state, groups: window.EducationGroups?.state.listStatus, date: document.getElementById('timelineDate')?.value, panel: document.getElementById('bookingPanel')?.className, hint: document.getElementById('bookingSubmitHint')?.textContent, room: document.getElementById('roomSelect')?.value, rooms: [...(document.getElementById('roomSelect')?.options || [])].map(o => ({ value: o.value, type: o.dataset.resourceType, id: o.dataset.resourceId })), duration: document.getElementById('educationLessonDuration')?.value }));
        await shot(page, `failure-${evidence.checks.length}`); flush(); throw error;
    } finally { await context.close(); }
}
async function go(page, view, date = manifest.anchorDate) {
    await page.goto(`${base}/?businessContext=dar&educationSchedule=groups&date=${date}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
    await page.waitForFunction(() => window.CrmBusinessContext?.current?.() === 'dar'
        && window.TimelineBusinessContext?.presentation?.().mode === 'education'
        && window.EducationScheduleWorkspace?.state.activeView === 'groups'
        && window.EducationGroups?.state.listStatus === 'ready' && window.EducationGroups.state.groups.length >= 6);
    if (view !== 'groups') await page.locator(`[data-education-schedule-tab="${view}"]`).click();
    if (view === 'today') await page.waitForFunction(date => window.EducationScheduleWorkspace?.state.activeView === 'today'
        && window.EducationScheduleWorkspace.state.date === date && !window.EducationScheduleWorkspace.state.loading, date);
    if (view === 'schedule') {
        await page.locator('#timelineViewPanelToggle').click(); await page.locator('[data-schedule-view-mode="day"]').click();
    }
}
async function open(page, id, view = 'today', date = manifest.anchorDate) {
    await go(page, view, date);
    const card = page.locator(view === 'today' ? `[data-education-booking-id="${id}"]` : `.booking-block[data-booking-id="${id}"]`).first();
    await card.click(); await page.locator('#bookingModal').waitFor({ state: 'visible' });
}
async function edit(page, id, date = manifest.anchorDate) {
    const expected = await row(id);
    await open(page, id, 'today', date); await page.locator('#bookingModal .btn-edit-booking').click();
    await page.locator('#educationLessonTitle').waitFor({ state: 'visible' });
    await page.waitForFunction(expected => document.getElementById('educationLessonTitle').value === expected.title
        && document.getElementById('educationLessonDuration').value === String(expected.duration)
        && !document.getElementById('bookingForm').inert, { title: expected.extra_data.educationLesson.title, duration: expected.duration });
}
async function save(page, id) {
    const response = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/bookings/${id}`).catch(error => ({ error }));
    await page.locator('#bookingSubmitBtn').click(); const saved = await response; if (saved.error) throw saved.error;
    assert.equal(saved.status(), 200, JSON.stringify(await saved.json()));
    await page.locator('#bookingPanel').waitFor({ state: 'hidden' }); return saved.request().postDataJSON();
}
async function shot(page, name) { assert.ok(!(await page.locator('body').innerText()).includes(process.env.TEST_USER)); await page.screenshot({ path: path.join(out, `${name}.png`) }); evidence.screenshots.push(`${name}.png`); }
async function main() {
    await check('fixtures', async () => {
        const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.TEST_USER, password: process.env.TEST_PASS }) });
        assert.equal(login.status, 200); const auth = await login.json(); token = auth.accessToken || auth.token;
        manifest = (await seedDataset(pool, 'fixed')).manifest;
        for (const business of ['dar', 'maysternya_doli']) await api(`/api/business/cabinet?businessContext=${business}`, 200, 'PUT', { businessType: 'education', timelineMode: 'education', resourceModel: 'cabinet' });
        evidence.anchor = manifest.anchorDate;
    });
    if (!manifest) return;
    browser = await chromium.launch({ headless: true });
    await check('F05-title-only-duration', () => pageFor(async page => {
        const id = manifest.ids.bookings['robots-4']; const before = await row(id); assert.equal(before.duration, 45);
        await edit(page, id);
        const duration = page.locator('#educationLessonDuration');
        evidence.proofs.F05 = { before, oldDurationVisible: await page.locator('#customDuration').isVisible(), oldDuration: await page.locator('#customDuration').inputValue(), durationVisible: await duration.isVisible() };
        await shot(page, 'F05-edit-before-save');
        await page.locator('#educationLessonTitle').fill('Будуємо світлофор — працюємо з датчиками');
        evidence.proofs.F05.payload = await save(page, id); const after = await row(id); evidence.proofs.F05.after = after; flush();
        await open(page, id); const detail = await page.locator('#bookingDetails').innerText(); evidence.proofs.F05.detail = detail;
        const durable = (await api(`/api/bookings/detail/${id}?businessContext=dar`)).booking;
        assert.equal(after.duration, 45); assert.equal(durable.duration, 45); assert.equal(durable.extraData.educationLesson.title, 'Будуємо світлофор — працюємо з датчиками');
        assert.equal(evidence.proofs.F05.durationVisible, true); assert.match(detail, /11:30\s*-\s*12:15/);
        for (const key of ['date','time','room','room_resource_id','line_id','kids_count','status']) assert.deepEqual(after[key], before[key], key);
    }));
    if (evidence.phase !== 'baseline') {
        await check('duration-30-45-60-90-and-invalid', () => pageFor(async page => {
            const id = manifest.ids.bookings['robots-4']; const original = await row(id);
            for (const minutes of [30, 45, 60, 90]) {
                await edit(page, id); assert.equal(await page.locator('#educationLessonDuration').inputValue(), String((await row(id)).duration));
                await page.locator('#educationLessonDuration').fill(String(minutes)); await save(page, id);
                const current = await row(id); assert.equal(current.duration, minutes);
                assert.equal((await api(`/api/bookings/detail/${id}?businessContext=dar`)).booking.duration, minutes);
                for (const key of ['date','time','room','line_id','kids_count']) assert.deepEqual(current[key], original[key]);
                await edit(page, id); await page.locator('#educationLessonTitle').fill(`Будуємо світлофор — ${minutes} хвилин`); await save(page, id);
                assert.equal((await row(id)).duration, minutes, 'Topic-only save retains chosen minutes');
            }
            await edit(page, id);
            let writes = 0; page.on('request', r => { if (r.method() === 'PUT' && new URL(r.url()).pathname === `/api/bookings/${id}`) writes++; });
            for (const invalid of ['', '0', '-1', '1.5', '1441']) {
                await page.locator('#educationLessonDuration').fill(invalid); await page.locator('#educationLessonTitle').click();
                await page.waitForFunction(() => document.getElementById('bookingSubmitBtn').getAttribute('aria-disabled') === 'true');
                await page.locator('#educationLessonDuration').press('Enter');
                await page.waitForFunction(() => document.getElementById('educationLessonDuration').getAttribute('aria-invalid') === 'true');
                assert.equal((await row(id)).duration, 90);
            }
            assert.equal(writes, 0); await shot(page, 'invalid-duration');
            evidence.proofs.duration = { valid: [30,45,60,90], invalid: ['',0,-1,1.5,1441], invalidWrites: writes };
        }));
        await check('edit-hydration-blocks-premature-input', () => pageFor(async page => {
            const id = manifest.ids.bookings['robots-4']; const before = await row(id);
            let release, arrived;
            const held = new Promise(resolve => { arrived = resolve; });
            const barrier = new Promise(resolve => { release = resolve; });
            const endpoint = `**/api/banquets/by-booking/${id}/deposit*`;
            await open(page, id);
            let writes = 0;
            page.on('request', request => {
                if (['POST','PUT','DELETE'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/bookings')) writes++;
            });
            await page.route(endpoint, async route => {
                const response = await route.fetch(); arrived(response.status());
                await barrier; await route.fulfill({ response });
            }, { times: 1 });
            try {
                await page.locator('#bookingModal .btn-edit-booking').click();
                assert.equal(await Promise.race([held, new Promise((_, reject) => {
                    const deadline = setTimeout(() => reject(new Error('Edit hydration response not observed')), 12000); deadline.unref();
                })]), 200);
                await page.waitForFunction(() => document.getElementById('bookingForm').inert
                    && document.getElementById('bookingForm').getAttribute('aria-busy') === 'true');
                await page.keyboard.press('Tab');
                assert.equal(await page.evaluate(() => document.getElementById('bookingForm').contains(document.activeElement)), false);
                assert.deepEqual(await row(id), before);
                assert.equal(writes, 0);
                release();
                await page.waitForFunction(() => !document.getElementById('bookingForm').inert);
                await page.locator('#bookingTime').selectOption('12:00'); await save(page, id);
                const after = await row(id); assert.equal(after.time, '12:00'); assert.equal(after.duration, before.duration);
                evidence.proofs.editReadiness = { actualResponseHeld: true, busyAndInert: true, prematureWrites: 0, before, after };
                await edit(page, id); await page.locator('#bookingTime').selectOption(before.time); await save(page, id);
                assert.deepEqual(await row(id), before);
            } finally { release(); await page.unroute(endpoint); }
        }));
        await check('single-field-edits-preserve-other-fields', () => pageFor(async page => {
            const id = manifest.ids.bookings['robots-4'];
            const cases = [
                { key: 'teacherId', selector: '#educationLessonTeacher', value: String(manifest.ids.teachers[0]) },
                { key: 'groupId', selector: '#educationLessonGroupId', value: String(manifest.ids.groups.arts) },
                { key: 'room', selector: '#roomSelect', value: 'Творчий простір «Палітра»' },
                { key: 'time', selector: '#bookingTime', value: '12:00' }
            ];
            evidence.proofs.fieldEdits = [];
            for (const item of cases) {
                const before = await row(id); await edit(page, id); await page.waitForFunction(() => !document.getElementById('educationLessonTeacher').disabled);
                await page.locator(item.selector).selectOption(item.value); const payload = await save(page, id); const after = await row(id);
                evidence.proofs.fieldEdits.push({ changed: item.key, before, after, payload }); flush();
                const lessonBefore = before.extra_data.educationLesson, lessonAfter = after.extra_data.educationLesson;
                if (['teacherId','groupId'].includes(item.key)) assert.equal(String(lessonAfter[item.key]), item.value);
                else assert.equal(after[item.key].slice(0, item.value.length), item.value);
                assert.equal(after.duration, before.duration);
                for (const key of ['date','time','room','kids_count']) if (key !== item.key) assert.deepEqual(after[key], before[key], `${item.key} must retain ${key}`);
                for (const key of ['title','teacherId','groupId','courseCode','lessonType']) if (key !== item.key) assert.equal(String(lessonAfter[key]), String(lessonBefore[key]), key);
                const detail = (await api(`/api/bookings/detail/${id}?businessContext=dar`)).booking; assert.equal(detail.duration, after.duration);
            }
        }));
        await check('full-ui-group-member-create-edit-cancel', () => pageFor(async page => {
            const groupId = manifest.ids.groups.empty; await go(page, 'groups'); await page.locator('#educationGroupsList').selectOption(String(groupId));
            await page.waitForFunction(id => String(window.EducationGroups.state.current?.id) === id, String(groupId));
            await page.locator('#educationGroupName').fill('Суботня лабораторія — світло та колір');
            await page.locator('#educationGroupTeacher').selectOption(String(manifest.ids.teachers[0])); await page.locator('#educationGroupForm button[type="submit"]').click();
            await page.waitForFunction(() => document.getElementById('educationGroupsStatus').textContent === 'Групу збережено.');
            await page.locator('#educationChildSearch').fill('Романюк'); await page.locator('#educationChildFind').click();
            await page.locator(`#educationChildSelect option[value="${manifest.ids.children['child-1']}"]`).waitFor({ state: 'attached' });
            await page.locator('#educationChildSelect').selectOption(String(manifest.ids.children['child-1'])); await page.locator('#educationMemberStart').fill('2026-10-03');
            const enrolled = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/${groupId}/members`));
            await page.locator('#educationGroupEnrollForm button[type="submit"]').click(); assert.equal((await enrolled).status(), 201);
            assert.equal((await pool.query('SELECT count(*)::int n FROM education_group_members WHERE group_id=$1', [groupId])).rows[0].n, 1);
            await go(page, 'schedule', '2030-01-10');
            await page.locator('.grid-cell[data-time="15:00"][data-line="edu-cabinet-1"]').first().click(); await page.locator('#bookingPanel').waitFor({ state: 'visible' });
            await page.locator('#customerSearch').fill('Наталія Романюк'); await page.locator(`.customer-search-item[data-id="${manifest.ids.parents['parent-0']}"]`).click();
            await page.locator('#educationLessonTitle').fill('Досліджуємо світло й кольори'); await page.locator('#educationLessonGroupId').selectOption(String(groupId));
            assert.equal(await page.locator('#educationLessonGroup').inputValue(), 'Суботня лабораторія — світло та колір');
            await page.locator('#educationLessonTeacher').selectOption(String(manifest.ids.teachers[0])); await page.locator('#educationLessonDuration').fill('45');
            const created = page.waitForResponse(r => r.request().method() === 'POST' && /^\/api\/bookings(?:\/full)?$/.test(new URL(r.url()).pathname));
            await page.locator('#bookingSubmitBtn').click(); const response = await created; assert.equal(response.status(), 200, JSON.stringify(await response.json()));
            const rows = (await pool.query("SELECT id FROM bookings WHERE program_name=$1 AND business_context='dar'", ['Досліджуємо світло й кольори'])).rows; assert.equal(rows.length, 1); const id = rows[0].id;
            await open(page, id, 'today', '2030-01-10'); assert.match(await page.locator('#bookingDetails').innerText(), /15:00\s*-\s*15:45/);
            const before = await row(id); assert.equal(String(before.extra_data.educationLesson.groupId), String(groupId));
            await edit(page, id, '2030-01-10'); await page.locator('#educationLessonTitle').fill('Світло, тіні та кольори'); await save(page, id);
            await open(page, id, 'today', '2030-01-10'); assert.match(await page.locator('#bookingDetails').innerText(), /Світло, тіні та кольори/);
            await shot(page, 'canonical-created-lesson');
            page.on('dialog', dialog => dialog.accept());
            const cancelled = page.waitForResponse(r => r.request().method() !== 'GET' && new URL(r.url()).pathname.includes(id));
            await page.locator(`[data-cancellation-booking-id="${id}"]`).click(); await page.locator('#confirmYes').click();
            const cancellation = await cancelled; assert.ok(cancellation.ok());
            await page.waitForFunction(() => document.getElementById('bookingModal').classList.contains('hidden'));
            const after = await row(id); assert.equal(after.status, 'cancelled'); assert.equal(after.duration, 45);
            // Canonical detail deliberately returns404 for cancelled standalone records.
            await api(`/api/bookings/detail/${id}?businessContext=dar`, 404);
            evidence.proofs.lifecycle = { before, after, groupId, childId: manifest.ids.children['child-1'] };
        }));
    }
    if (evidence.phase !== 'baseline') {
        await check('catalog-lesson-keeps-edited-duration', () => pageFor(async page => {
            const id = manifest.ids.bookings['english-5'];
            // Explicit SQL prerequisite makes the existing lesson a catalog-linked legacy record.
            await pool.query("UPDATE bookings SET program_id='lesson_45',program_code='Урок',duration=60,time='12:00' WHERE id=$1", [id]);
            const before = await row(id); await edit(page, id, '2026-10-10');
            assert.equal(await page.locator('#educationLessonDuration').inputValue(), '60');
            await page.locator('#educationLessonTitle').fill('Знайомимося зі світом — читаємо й розмовляємо');
            evidence.proofs.catalog = { before, hint: await page.locator('#bookingSubmitHint').innerText() }; flush(); await save(page, id);
            const after = await row(id); assert.equal(after.duration, 60); assert.equal((await api(`/api/bookings/detail/${id}?businessContext=dar`)).booking.duration, 60);
            for (const key of ['date','time','room','line_id','kids_count']) assert.deepEqual(after[key], before[key]);
            evidence.proofs.catalog = { before, after };
        }));
        await check('canonical-today-day-week', () => pageFor(async page => {
            const id = manifest.ids.bookings['english-4']; const durable = await row(id);
            evidence.proofs.openers = [];
            await open(page, id); assert.match(await page.locator('#bookingDetails').innerText(), /09:30\s*-\s*10:00/); evidence.proofs.openers.push('today');
            await go(page, 'schedule'); await page.locator(`.booking-block[data-booking-id="${id}"]`).first().click();
            await page.locator('#bookingModal').waitFor({ state: 'visible' }); assert.match(await page.locator('#bookingDetails').innerText(), /Слова ввічливості/); evidence.proofs.openers.push('day');
            await page.locator('#bookingModal .modal-close').click(); await page.locator('#timelineViewPanelToggle').click(); await page.locator('[data-schedule-view-mode="week"]').click();
            await page.locator(`.mini-booking-block[data-booking-id="${id}"]`).first().click(); await page.locator('#bookingModal').waitFor({ state: 'visible' });
            assert.match(await page.locator('#bookingDetails').innerText(), /09:30\s*-\s*10:00/); evidence.proofs.openers.push('week'); await shot(page, 'week-canonical-card');
            assert.deepEqual(await row(id), durable); assert.equal((await api(`/api/bookings/detail/${id}?businessContext=dar`)).booking.duration, 30);
        }));
        await check('date-api-contract-and-ui-reload', () => pageFor(async page => {
            // There is no date field in this drawer: timeline date navigation intentionally closes it.
            // This is a separately labeled API contract, never a substitute for an unsuccessful UI write.
            const id = manifest.ids.bookings['robots-4']; const before = await row(id);
            const representation = (await api(`/api/bookings/detail/${id}?businessContext=dar`)).booking;
            await api(`/api/bookings/${id}?businessContext=dar`, 200, 'PUT', { ...representation, date: '2030-02-01' }); const after = await row(id);
            assert.equal(after.date, '2030-02-01');
            for (const key of ['time','duration','room','line_id','room_resource_id','kids_count','group_name','extra_data']) assert.deepEqual(after[key], before[key], key);
            await open(page, id, 'today', '2030-02-01'); assert.match(await page.locator('#bookingDetails').innerText(), /2030-02-01/);
            await page.locator('#bookingModal .btn-edit-booking').click();
            await page.waitForFunction(value => document.getElementById('educationLessonDuration').value === String(value), before.duration);
            assert.equal(await page.locator('#educationLessonDuration').inputValue(), String(before.duration));
            evidence.proofs.dateContract = { level: 'API write plus visible canonical reload', before, after };
        }));
        await check('legacy-label-and-linked-roster-remain-distinct', () => pageFor(async page => {
            const id = manifest.ids.bookings['school-4']; const before = await row(id);
            await edit(page, id); await page.locator('#educationLessonGroup').fill('Молодша група — заняття з логіки'); await save(page, id); const named = await row(id);
            assert.equal(named.extra_data.educationLesson.groupName, 'Молодша група — заняття з логіки');
            assert.equal(String(named.extra_data.educationLesson.groupId), String(before.extra_data.educationLesson.groupId));
            await edit(page, id); await page.locator('#educationLessonGroupId').selectOption(''); await save(page, id); const unlinked = await row(id);
            assert.equal(unlinked.extra_data.educationLesson.groupId, null); assert.equal(unlinked.extra_data.educationLesson.groupName, named.extra_data.educationLesson.groupName);
            assert.equal(unlinked.duration, before.duration);
            assert.equal((await pool.query('SELECT count(*)::int n FROM education_group_members WHERE group_id=$1', [before.extra_data.educationLesson.groupId])).rows[0].n, 6);
            evidence.proofs.labels = { before, named, unlinked };
        }));
        await check('non-education-api-duration-contract', async () => {
            const id = manifest.ids.controlBooking; const before = await row(id);
            const representation = (await api(`/api/bookings/detail/${id}?businessContext=event_genix`)).booking;
            await api(`/api/bookings/${id}?businessContext=event_genix`, 200, 'PUT', { ...representation, duration: 75 }); const after = await row(id);
            assert.equal(after.duration, 75); assert.equal(after.extra_data.educationLesson, undefined);
            for (const key of ['date','time','room','line_id','program_name','status','group_name']) assert.deepEqual(after[key], before[key], key);
            await api(`/api/bookings/${id}?businessContext=event_genix`, 400, 'PUT', { ...representation, duration: 0, updatedAtVersion: undefined, updatedAt: undefined }); assert.equal((await row(id)).duration, 75);
            evidence.proofs.nonEducation = { level: 'API/SQL contract', before, after, existingZeroDurationRejectionRetained: true };
        });
    }
    await check('page-errors', async () => assert.deepEqual(evidence.pageErrors, []));
}
main().catch(error => { evidence.fatal = error.message; process.exitCode = 1; }).finally(async () => { await browser?.close(); await pool.end(); evidence.exitCode = results.exitCode(); flush(); if (results.exitCode()) process.exitCode = 1; });
