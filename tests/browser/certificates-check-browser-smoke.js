'use strict';

// Synthetic transport, real certificate HTML/CSS/page logic and shared confirmation UI.
// Backend authorization/concurrency is tested separately against PostgreSQL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
function requirePlaywright() {
    try {
        return require('playwright');
    } catch (error) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}
const { chromium } = requirePlaywright();
const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(ROOT, 'output/playwright/certificate-check');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const api = read('js/api.js');
const certificateApi = api.slice(api.indexOf('function certificateApiFailure('), api.indexOf('// v11.0: Kleshnya API'));
const prelude = `
const API_BASE = '/api';
window.fixtureAvailable = true;
window.apiVerifyToken = async () => ({id: 1, username: 'synthetic-reception', role: 'reception'});
window.hydrateBusinessOperatingProfile = async () => {};
window.hydrateActionPermissions = async () => ({});
window.getLegacyBusinessSurfaceAvailability = () => ({available: window.fixtureAvailable});
window.getLegacyBusinessSurfaceContextKey = () => 'event_genix';
window.noteLegacyBusinessSurfaceUnavailable = () => {};
window.getAuthHeaders = () => ({'Content-Type':'application/json'});
window.apiFetchWithAuthRetry = (url, options) => fetch(url, options);
window.apiErrorFromResponse = async response => Object.assign(new Error((await response.json()).error), {status:response.status});
window.showAuthenticatedPageShell = () => document.getElementById('mainApp').classList.remove('hidden');
window.Sidebar = { markShellReady: () => document.body.classList.add('shell-ready') };
window.showNotification = () => {};
window.initDarkMode = () => {};
`;
const html = read('certificates.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace('</body>', '<script src="/js/ui.js"></script><script src="/fixture-bootstrap.js"></script><script src="/js/certificates-page.js"></script></body>');

async function main() {
    const app = express();
    let posts = 0;
    let consumed = false;
    const issued = [];
    app.use(express.json());
    app.get('/certificates/check', (_req, res) => res.type('html').send(html));
    app.get('/certificates/new', (_req, res) => res.type('html').send(html));
    app.get('/fixture-bootstrap.js', (_req, res) => res.type('js').send(prelude + certificateApi));
    app.get('/api/certificates/code/:code', async (req, res) => {
        if (req.params.code === 'SLOW') await new Promise(resolve => setTimeout(resolve, 350));
        if (req.params.code === 'MISSING') return res.status(404).json({ error: 'Certificate not found' });
        const status = ({ USED: 'used', BLOCKED: 'blocked', REVOKED: 'revoked' })[req.params.code]
            || (consumed ? 'used' : 'active');
        const effectiveStatus = req.params.code === 'EXPIRED' ? 'expired' : status;
        const redemptionReason = effectiveStatus !== 'active' ? effectiveStatus
            : req.params.code === 'VERIFY' ? 'verification_only'
                : req.params.code === 'DENIED' ? 'redemption_unavailable' : 'available';
        res.json({ id: 1, certCode: req.params.code, typeText: req.params.code === 'VERIFY' ? 'Абонемент' : 'на одноразовий вхід',
            validUntil: req.params.code === 'EXPIRED' ? '2020-01-01' : '2099-12-31',
            status, effectiveStatus, canRedeem: redemptionReason === 'available', redemptionReason });
    });
    app.get('/api/certificates/:id', (req, res) => res.json({
        id: Number(req.params.id), certCode: `DETAIL-${req.params.id}`,
        displayMode: 'fio', displayValue: 'Тест',
        typeText: req.params.id === '2' ? 'Абонемент' : 'на одноразовий вхід',
        validUntil: req.params.id === '3' ? '2020-01-01' : '2099-12-31', status: 'active'
    }));
    app.post('/api/certificates', (req, res) => {
        issued.push(req.body);
        res.status(201).json({ id: issued.length, certCode: `ISSUED-${issued.length}`,
            displayMode: req.body.displayMode, displayValue: req.body.displayValue,
            typeText: req.body.typeText, typeCode: req.body.typeCode,
            validUntil: req.body.validUntil, status: 'active', issueSource: 'single' });
    });
    app.post('/api/certificates/1/redeem', async (_req, res) => {
        posts++;
        await new Promise(resolve => setTimeout(resolve, 250));
        consumed = true;
        res.json({ success: true, certificate: { id: 1, certCode: 'CERT-FIXTURE', typeText: 'на одноразовий вхід', validUntil: '2099-12-31', status: 'used' } });
    });
    for (const dir of ['css', 'js', 'images']) app.use('/' + dir, express.static(path.join(ROOT, dir)));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const base = `http://127.0.0.1:${server.address().port}`;
        await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
        const open = async code => {
            await page.goto(base + '/certificates/check?code=' + code);
            try { await page.locator('#certificateCheckResult:not(.hidden)').waitFor({ timeout: 8000 }); }
            catch (error) {
                console.error(await page.locator('#certificateCheckResult').evaluate(element => {
                    const chain = [];
                    for (let node = element; node; node = node.parentElement) {
                        const style = getComputedStyle(node);
                        chain.push({ tag: node.tagName, id: node.id, className: node.className, display: style.display, visibility: style.visibility });
                    }
                    return chain;
                }), errors);
                throw error;
            }
        };
        await open('CERT-FIXTURE');
        assert.equal(posts, 0, 'a scan cannot redeem');
        await page.locator('[data-cert-check-state="redeemable"]').waitFor();
        await page.getByText('Цей сертифікат можна погасити після підтвердження.', { exact: false }).waitFor();
        await page.locator('#certificateCheckCode').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('#certificateCheckSubmit').evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('[data-cert-redeem]').evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('Enter');
        await page.getByRole('dialog').waitFor();
        await page.waitForFunction(() => document.querySelector('.confirm-overlay')?.contains(document.activeElement));
        await page.keyboard.press('Escape');
        assert.equal(posts, 0, 'keyboard cancel cannot redeem');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        fs.mkdirSync(OUTPUT, { recursive: true });
        await page.screenshot({ path: path.join(OUTPUT, 'mobile-active.png'), fullPage: true });
        await page.getByRole('button', { name: 'Погасити сертифікат', exact: true }).click();
        await page.getByRole('button', { name: 'Погасити', exact: true }).click();
        assert.equal(await page.locator('[data-cert-redeem]').isDisabled(), true);
        await page.locator('[data-cert-check-state="used"]').waitFor();
        assert.equal(posts, 1);
        assert.equal(await page.locator('[data-cert-redeem]').count(), 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile page must not overflow horizontally');
        await page.screenshot({ path: path.join(OUTPUT, 'mobile-used.png'), fullPage: true });

        consumed = false;
        for (const [code, expectedState, explanation] of [
            ['VERIFY', 'verification_only', 'Цей тип доступний лише для перевірки.'],
            ['DENIED', 'redemption_unavailable', 'Для вашого облікового запису погашення зараз недоступне.'],
            ['USED', 'used', 'Повторне використання неможливе.'],
            ['EXPIRED', 'expired', 'Сертифікат більше не дійсний.'],
            ['BLOCKED', 'blocked', 'Сертифікат не можна використати.'],
            ['REVOKED', 'revoked', 'Сертифікат не можна використати.'],
            ['MISSING', 'missing', 'Перевірте код і спробуйте ще раз.']
        ]) {
            await open(code);
            await page.locator(`[data-cert-check-state="${expectedState}"]`).waitFor();
            await page.getByText(explanation, { exact: false }).waitFor();
            assert.equal(await page.locator('[data-cert-redeem]').count(), 0, `${code}: no redemption button`);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${code}: mobile page must not overflow`);
        }
        await page.locator('#certificateCheckCode').fill('VERIFY');
        await page.keyboard.press('Enter');
        await page.locator('[data-cert-check-state="verification_only"]').waitFor();
        await page.evaluate(() => window.CertificatePage.openDetail(2));
        assert.equal(await page.getByRole('link', { name: 'Перевірити сертифікат' }).getAttribute('href'), '/certificates/check?code=DETAIL-2');
        assert.equal(await page.getByText('Перевірити й погасити').count(), 0, 'details must not promise redemption');
        await page.evaluate(() => window.CertificatePage.openDetail(3));
        await page.locator('#certificatePageDetailContent .cert-page-badge').getByText('Прострочений').waitFor();
        await page.locator('#certificatePageDetailClose').click();
        await open('CERT-FIXTURE');
        await page.getByRole('button', { name: 'Погасити сертифікат', exact: true }).click();
        await page.evaluate(() => { window.fixtureAvailable = false; window.dispatchEvent(new Event('crmBusinessContextChanged')); });
        await page.getByRole('button', { name: 'Погасити', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert.equal(posts, 1, 'scope switch during confirmation cannot redeem');
        assert.ok(await page.locator('#certificateCheckResult').evaluate(element => element.classList.contains('hidden')));

        await open('CERT-FIXTURE');
        await page.locator('#certificateCheckCode').fill('SLOW');
        await page.getByRole('button', { name: 'Перевірити', exact: true }).click();
        await page.evaluate(() => { window.fixtureAvailable = false; window.dispatchEvent(new Event('crmBusinessContextChanged')); });
        await page.waitForResponse(response => response.url().endsWith('/code/SLOW'));
        assert.ok(await page.locator('#certificateCheckResult').evaluate(element => element.classList.contains('hidden')), 'late lookup cannot restore an old scope');
        await page.goto(base + '/certificates/new');
        await page.locator('#certificatesNewView:not(.hidden)').waitFor();
        for (const [preset, label, typeCode] of [
            ['на одноразовий вхід', 'на одноразовий вхід', 'one_time_admission'],
            ['абонемент', 'абонемент', 'subscription'],
            ['custom', 'VIP назва', 'verification_only']
        ]) {
            await page.locator('#certPageTypePreset').selectOption(preset);
            if (preset === 'custom') await page.locator('#certPageTypeText').fill(label);
            await page.locator('#certPageDisplayValue').fill(`Тест ${issued.length + 1}`);
            await Promise.all([
                page.waitForResponse(response => response.url().endsWith('/api/certificates') && response.request().method() === 'POST'),
                page.locator('#certPageSubmitBtn').click()
            ]);
            assert.equal(issued.at(-1).typeText, label);
            assert.equal(issued.at(-1).typeCode, typeCode);
        }
        assert.deepEqual(errors, []);
        console.log('Certificate browser smoke passed: all states, keyboard confirmation/cancel, scope switch, stale lookup, mobile layout and stable issuance types.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
