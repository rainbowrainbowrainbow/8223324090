'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requirePlaywright } = require('./hr-checklists-async-browser-smoke');
const { withDeletionRouter } = require('../helpers/park-hr-deletion-router');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/hr-staff-deletion');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

async function main() {
    fs.mkdirSync(output, { recursive: true });
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    try {
        await withDeletionRouter(async ({ state, calls, origin }) => {
            const page = await browser.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            async function setup(width = 1100) {
                state.actor = {};
                state.counts = {};
                await page.setViewportSize({ width, height: 820 });
                await page.goto(origin + '/api/hr/staff/9701/delete-readiness');
                await page.setContent(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><style>${[
                    'css/base.css', 'css/modals.css', 'css/hr-page.css', 'css/pages-hr-staff.css'
                ].map(read).join('\n')}</style></head><body><main><button id="deleteFixture" data-delete-staff-id="9701" type="button">Видалити синтетичний дубль</button></main></body></html>`);
                await page.evaluate(() => {
                    window.AppState = { currentUser: { id: 9101, role: 'director', activeBusinessContext: 'event_genix' } };
                    window.getCrmBusinessScope = user => ({ mode: 'single', activeContext: user.activeBusinessContext });
                    window.__savedAddListener = document.addEventListener.bind(document);
                    document.addEventListener = (event, callback, options) => {
                        if (event !== 'DOMContentLoaded') window.__savedAddListener(event, callback, options);
                    };
                });
                await page.addScriptTag({ content: read('js/ui.js') });
                await page.addScriptTag({ content: read('js/hr-page.js') });
                await page.evaluate(() => {
                    document.addEventListener = window.__savedAddListener;
                    canManage = true;
                    teamStaff = [{ id: 9701, name: 'Синтетичний дубль' }];
                    window.__deletionNotices = [];
                    window.__deletionMethods = [];
                    window.__realHrFetch = hrFetch;
                    showNotification = message => window.__deletionNotices.push(message);
                    loadTeam = async () => {};
                    refreshHrOperationalViews = async () => {};
                    hrFetch = async (url, options = {}) => {
                        window.__deletionMethods.push(options.method || 'GET');
                        const response = await fetch('/api/hr' + url, { method: options.method || 'GET',
                            headers: { 'Content-Type': 'application/json', 'X-Business-Context': AppState.currentUser.activeBusinessContext },
                            ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
                        return response.json();
                    };
                    document.getElementById('deleteFixture').onclick = () => {
                        window.__deleteDone = false;
                        window.__deletePromise = deleteStaffProfile(9701).finally(() => { window.__deleteDone = true; });
                    };
                });
            }
            async function openForm() {
                await page.click('#deleteFixture');
                await page.locator('#fm_confirmation').waitFor({ state: 'visible' });
            }
            async function finish(text = 'ТАК') {
                await page.fill('#fm_confirmation', text);
                await page.click('.form-modal-overlay .confirm-ok');
                await page.waitForFunction(() => window.__deleteDone);
            }
            for (const width of [1100, 390]) {
                await setup(width);
                await openForm();
                await page.screenshot({ path: path.join(output, `confirmation-${width}.png`), fullPage: true });
                await finish();
                assert.deepEqual(await page.evaluate(() => window.__deletionMethods), ['GET', 'DELETE']);
                assert.match((await page.evaluate(() => window.__deletionNotices)).at(-1), /видалено/);
            }
            await setup();
            let unblockRapidRead;
            state.beforeSql = sql => sql.startsWith('SELECT id, name, department')
                ? new Promise(resolve => { unblockRapidRead = resolve; }) : undefined;
            await page.click('#deleteFixture');
            for (let i = 0; i < 100 && !unblockRapidRead; i++) await new Promise(resolve => setTimeout(resolve, 10));
            assert.ok(unblockRapidRead);
            assert.equal(await page.locator('#deleteFixture').isDisabled(), true);
            const rapidBounds = await page.locator('#deleteFixture').boundingBox();
            await page.mouse.click(rapidBounds.x + 5, rapidBounds.y + 5);
            unblockRapidRead();
            state.beforeSql = null;
            await page.locator('#fm_confirmation').waitFor({ state: 'visible' });
            assert.equal(await page.locator('.form-modal-overlay').count(), 1);
            await finish();
            assert.deepEqual(await page.evaluate(() => window.__deletionMethods), ['GET', 'DELETE']);
            assert.equal(await page.locator('#deleteFixture').isEnabled(), true);

            await setup();
            await openForm();
            await page.click('.form-modal-overlay .confirm-cancel');
            await page.waitForFunction(() => window.__deleteDone);
            assert.deepEqual(await page.evaluate(() => window.__deletionMethods), ['GET']);

            await setup();
            await openForm();
            await finish('так');
            assert.deepEqual(await page.evaluate(() => window.__deletionMethods), ['GET']);

            for (const change of ['business', 'session', 'away-and-back']) {
                await setup(390);
                await openForm();
                await page.evaluate(kind => {
                    if (kind === 'business') AppState.currentUser.activeBusinessContext = 'dar';
                    if (kind === 'session') localStorage.setItem('pzp_auth_session_generation', String(Date.now()));
                    if (kind === 'away-and-back') teamLoadRequestSeq++;
                }, change);
                await finish();
                assert.deepEqual(await page.evaluate(() => window.__deletionMethods), ['GET'], change);
            }
            await setup();
            state.counts = { employee_profiles: 1 };
            const start = calls.length;
            await page.click('#deleteFixture');
            await page.locator('.confirm-overlay').waitFor({ state: 'visible' });
            assert.match(await page.locator('.confirm-message').innerText(), /CRM-профілі або акаунти/);
            await page.click('.confirm-ok');
            await page.waitForFunction(() => window.__deleteDone);
            assert.equal(calls.slice(start).some(sql => sql.startsWith('DELETE')), false);

            await setup();
            let releaseRead;
            state.beforeSql = sql => sql.startsWith('SELECT id, name, department')
                ? new Promise(resolve => { releaseRead = resolve; }) : undefined;
            await page.click('#deleteFixture');
            for (let i = 0; i < 100 && !releaseRead; i++) await new Promise(resolve => setTimeout(resolve, 10));
            assert.ok(releaseRead);
            await page.evaluate(() => { AppState.currentUser.activeBusinessContext = 'dar'; });
            releaseRead();
            state.beforeSql = null;
            await page.waitForFunction(() => window.__deleteDone);
            assert.equal(await page.locator('#fm_confirmation').count(), 0);
            assert.deepEqual(await page.evaluate(() => window.__deletionMethods), ['GET']);
            await setup();
            await page.evaluate(() => { hrFetch = async () => { throw new Error('offline'); }; });
            await page.click('#deleteFixture');
            await page.waitForFunction(() => window.__deleteDone);
            assert.match((await page.evaluate(() => window.__deletionNotices)).at(-1), /з’єднання/);

            for (const check of ['missing', 'present', 'offline']) {
                await setup();
                await page.evaluate(mode => {
                    hrFetch = async (url, options = {}) => {
                        window.__deletionMethods.push(options.method || 'GET');
                        if (url.endsWith('/delete-readiness')) return { success: true, data: { can_delete: true } };
                        if (options.method === 'DELETE' || mode === 'offline') throw new Error('offline');
                        return mode === 'missing' ? { success: false, status: 404 } : { success: true, data: { id: 9701 } };
                    };
                }, check);
                await openForm();
                await finish();
                assert.deepEqual(await page.evaluate(() => window.__deletionMethods), ['GET', 'DELETE', 'GET']);
                assert.match((await page.evaluate(() => window.__deletionNotices)).at(-1), /карт|Карт|стан/);
            }

            await setup();
            await page.evaluate(() => {
                hrFetch = window.__realHrFetch;
                window.apiFetchWithAuthRetry = async (url, options = {}) => {
                    window.__deletionMethods.push(options.method || 'GET');
                    if (url.endsWith('/delete-readiness')) return new Response(JSON.stringify({ success: true, data: { can_delete: true } }), { status: 200 });
                    if (options.method === 'DELETE') throw new TypeError('network lost');
                    return new Response(JSON.stringify({ success: false, error: 'missing' }), { status: 404 });
                };
            });
            await openForm();
            await finish();
            assert.deepEqual(await page.evaluate(() => window.__deletionMethods), ['GET', 'DELETE', 'GET']);
            assert.match((await page.evaluate(() => window.__deletionNotices)).at(-1), /не знайдено/);

            await setup();
            await openForm();
            await page.evaluate(() => { window.__secondDelete = deleteStaffProfile(9701); });
            await page.evaluate(() => window.__secondDelete);
            assert.equal(await page.locator('.form-modal-overlay').count(), 1);
            await finish();
            assert.deepEqual(await page.evaluate(() => window.__deletionMethods), ['GET', 'DELETE']);
            assert.deepEqual(errors, []);
            await page.close();
        });
        console.log('Staff deletion browser smoke passed: desktop/mobile, confirmation, context races, dependencies, connection recovery and repeat clicks.');
    } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
