#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('../helpers/playwright')();
const ROOT = path.resolve(__dirname, '../..');
const read = filename => fs.readFileSync(path.join(ROOT, filename), 'utf8');
function structureMarkup() {
    const html = read('hr.html');
    const start = html.indexOf('<div id="tab-structure"');
    assert.ok(start >= 0);
    const tags = /<\/?div\b[^>]*>/g;
    tags.lastIndex = start;
    let depth = 0, tag;
    while ((tag = tags.exec(html))) {
        depth += tag[0].startsWith('</') ? -1 : 1;
        if (!depth) return html.slice(start, tags.lastIndex);
    }
    throw new Error('Structure panel not found');
}
async function run() {
    let downloads = 0, failChunk = false;
    const panel = structureMarkup();
    const styles = (read('hr.html').match(/<link rel="stylesheet" href="css\/[^"]+">/g) || []).join('\n');
    const bootstrap = `
        window.AppState = {currentUser:{id:999,role:'creator',name:'Synthetic QA'}};
        window.canAccess=()=>true;
        window.showNotification=()=>{};
        window.apiVerifyToken=async()=>AppState.currentUser;
        const add=document.addEventListener.bind(document);
        document.addEventListener=(type,...args)=>type==='DOMContentLoaded'?undefined:add(type,...args);
    `;
    const configure = `
        window.__reads=0;
        teamAccessContext=()=>window.__context||'synthetic:session1';
        ensureProfessionsLoaded=async()=>[];
        hrFetch=async url=>{
            if(url==='/company-structure') {
                window.__reads++;
                return {success:true,data:{nodes:[{id:'director',title:'Тестовий директор',parentId:null,x:80,y:40}],updatedAt:'2026-11-07T00:00:00Z'}};
            }
            throw new Error('Unexpected request '+url);
        };
        document.getElementById('openStructure').onclick=async()=>{
            document.getElementById('openStructure').classList.add('active');
            document.getElementById('tab-structure').classList.add('active');
            await loadCompanyStructure();
        };
    `;
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/hr') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(`<!doctype html><html lang="uk" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head><body data-page-group="hr"><button id="openStructure" class="hr-tab" data-tab="structure">Відкрити структуру</button>${panel}<script>${bootstrap}</script><script src="/js/ui.js"></script><script src="/js/hr-page.js?v=synthetic-test"></script><script>${configure}</script></body></html>`);
        } else if (url.pathname === '/js/hr-structure-page.js') {
            downloads++;
            assert.equal(url.search, '?v=synthetic-test');
            res.setHeader('Content-Type', 'text/javascript');
            if (failChunk) { res.statusCode = 503; res.end('unavailable'); }
            else res.end(read('js/hr-structure-page.js'));
        } else if (/^\/(js|css)\/[\w.-]+$/.test(url.pathname) && fs.existsSync(path.join(ROOT, url.pathname))) {
            res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
            res.end(read(url.pathname));
        } else { res.statusCode = 404; res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true,
            ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
        for (const width of [390, 1440]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            try {
                const before = downloads;
                await page.goto(`http://127.0.0.1:${server.address().port}/hr`, { waitUntil: 'networkidle' });
                assert.equal(downloads, before, 'Today/core does not eagerly download structure');
                assert.equal(await page.evaluate(() => !!window.HrStructureModule), false);
                await page.click('#openStructure');
                await page.waitForFunction(() => companyStructureLoadState === 'ready');
                assert.equal(downloads, before + 1);
                assert.equal(await page.evaluate(() => window.__reads), 1);
                assert.equal(await page.locator('#companyOrgChart').getByText('Тестовий директор', { exact: true }).count() > 0
                    || await page.locator('#companyOrgTree').getByText('Тестовий директор', { exact: true }).count() > 0, true);
                await page.click('#openStructure');
                await page.waitForFunction(() => window.__reads === 2);
                assert.equal(downloads, before + 1, 'reopening reuses the loaded module');
                for (const theme of ['light', 'dark']) {
                    await page.evaluate(dark => {
                        document.body.classList.toggle('dark-mode', dark);
                        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
                    }, theme === 'dark');
                    if (process.env.HR_STRUCTURE_SCREENSHOTS_DIR) {
                        fs.mkdirSync(process.env.HR_STRUCTURE_SCREENSHOTS_DIR, { recursive: true });
                        await page.screenshot({ path: path.join(process.env.HR_STRUCTURE_SCREENSHOTS_DIR, `structure-lazy-${width}-${theme}.png`), fullPage: true });
                    }
                }
                assert.deepEqual(errors, []);
            } finally { await page.close(); }
        }
        const page = await browser.newPage();
        try {
            failChunk = true;
            await page.goto(`http://127.0.0.1:${server.address().port}/hr`);
            await page.click('#openStructure');
            await page.locator('#btnRetryCompanyStructure').waitFor({ state: 'visible' });
            assert.equal(await page.evaluate(() => window.__reads), 0);
            failChunk = false;
            await page.click('#btnRetryCompanyStructure');
            await page.waitForFunction(() => companyStructureLoadState === 'ready');
            assert.equal(await page.evaluate(() => window.__reads), 1);
        } finally { await page.close(); }
        const race = await browser.newPage();
        let resume;
        try {
            const paused = new Promise(resolve => { resume = resolve; });
            const requested = race.waitForRequest(request => request.url().includes('/js/hr-structure-page.js'), { timeout: 10000 });
            await race.route('**/js/hr-structure-page.js*', async route => {
                await paused; await route.continue();
            });
            await race.goto(`http://127.0.0.1:${server.address().port}/hr`);
            await race.click('#openStructure');
            await requested;
            await race.evaluate(() => { window.__context = 'synthetic:session2'; });
            resume();
            await race.waitForFunction(() => companyStructureLoadState === 'ready');
            assert.equal(await race.evaluate(() => window.__reads), 1, 'fresh context reads once after the cold download');
            assert.equal(await race.evaluate(() => companyStructureContext), 'synthetic:session2');
        } finally { resume?.(); await race.close(); }
        console.log('HR structure actual lazy-loading browser smoke passed (390/1440, light/dark, failure/retry, cold context switch)');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
