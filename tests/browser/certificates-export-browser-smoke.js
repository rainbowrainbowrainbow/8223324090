'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const QRCode = require('qrcode');

function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        const entry = String(process.env.PATH || '').split(path.delimiter)
            .find(item => /node_modules[\\/]\.bin[\\/]?$/i.test(item));
        if (entry) return require(path.join(path.dirname(entry), 'playwright'));
        throw error;
    }
}

const { chromium, webkit } = requirePlaywright();
const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(ROOT, 'output/playwright/certificate-check');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const api = read('js/api.js');
const certificateApi = api.slice(api.indexOf('function certificateApiFailure('), api.indexOf('// v11.0: Kleshnya API'));
const prelude = `
const API_BASE = '/api';
window.apiVerifyToken = async () => ({id: 1, username: 'synthetic-reception', role: 'reception'});
window.clearAuthStorage = () => {};
window.hydrateBusinessOperatingProfile = async () => {};
window.hydrateActionPermissions = async () => ({});
window.canAccessPage = () => true;
window.getLegacyBusinessSurfaceAvailability = () => ({available: true});
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
    .replace('</body>', `<script src="/js/ui.js"></script><script src="/fixture-bootstrap.js"></script>
        <script src="/js/certificate-preview.js"></script><script src="/js/certificate-image-export.js"></script>
        <script src="/js/certificates-page.js"></script></body>`);

async function main() {
    const app = express();
    app.use(express.json());
    const issued = [];
    let qrRequests = 0;
    let qrUnavailable = false;
    let sessionLost = false;
    app.get('/certificates/new', (_req, res) => res.type('html').send(html));
    app.get('/fixture-bootstrap.js', (_req, res) => res.type('js').send(prelude + certificateApi));
    app.get('/api/certificates/qr/:code', async (req, res) => {
        qrRequests++;
        if (qrUnavailable) return res.sendStatus(503);
        res.json({ dataUrl: await QRCode.toDataURL(`https://example.test/certificates/check?code=${encodeURIComponent(req.params.code)}`) });
    });
    app.get('/api/certificates/:id', (req, res) => {
        if (sessionLost) return res.sendStatus(401);
        const cert = issued.find(item => String(item.id) === req.params.id);
        if (!cert) return res.sendStatus(404);
        res.json(cert);
    });
    app.post('/api/certificates', (req, res) => {
        const id = issued.length + 1;
        const cert = { ...req.body, id, certCode: `SYNTHETIC-IMAGE-${id}`, status: 'active',
            issuedAt: '2026-09-27T10:00:00Z', issueSource: 'single' };
        issued.push(cert);
        res.status(201).json(cert);
    });
    for (const dir of ['css', 'js', 'images']) app.use('/' + dir, express.static(path.join(ROOT, dir)));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        const useWebkit = process.env.CERT_EXPORT_BROWSER === 'webkit';
        browser = await (useWebkit ? webkit : chromium).launch({ headless: true });
        for (const device of (useWebkit ? [
            { name: 'iPhone WebKit emulation', width: 390, mobile: true, touch: true,
                ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' }
        ] : [
            { name: 'desktop', width: 1280, mobile: false, touch: false, ua: 'Synthetic Desktop' },
            { name: 'Android', width: 390, mobile: true, touch: true, ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130' },
            { name: 'iPhone emulation', width: 390, mobile: true, touch: true,
                ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' }
        ])) {
            const context = await browser.newContext({ viewport: { width: device.width, height: 844 },
                isMobile: device.mobile, hasTouch: device.touch, userAgent: device.ua, acceptDownloads: true });
            const page = await context.newPage();
            const pageErrors = [];
            page.on('pageerror', error => pageErrors.push(error.message));
            await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
            await page.addInitScript(() => {
                window.popupAttempts = 0;
                window.open = () => { window.popupAttempts++; throw new Error('popup blocked'); };
                window.exportUrls = { created: [], revoked: [] };
                const create = URL.createObjectURL.bind(URL);
                const revoke = URL.revokeObjectURL.bind(URL);
                URL.createObjectURL = blob => { const url = create(blob); window.exportUrls.created.push(url); return url; };
                URL.revokeObjectURL = url => { window.exportUrls.revoked.push(url); return revoke(url); };
                const timeout = window.setTimeout.bind(window);
                window.setTimeout = (callback, delay, ...args) => timeout(callback, delay === 60000 ? 30 : delay, ...args);
            });
            await page.goto(`${base}/certificates/new`);
            await page.locator('#certificatesNewView:not(.hidden)').waitFor();
            await page.locator('#certPageDisplayValue').fill(`Тестовий отримувач ${device.name}`);
            await Promise.all([
                page.waitForResponse(response => response.url().endsWith('/api/certificates') && response.request().method() === 'POST'),
                page.locator('#certPageSubmitBtn').click()
            ]);
            await page.locator('#certCreatePreview canvas').waitFor();
            const issuedBeforeExport = issued.length;
            await page.locator('#certCreateResult [data-cert-open]').click();
            const detail = page.locator('#certificatePageDetailModal:not(.hidden)');
            await detail.waitFor();
            if (device.name === 'desktop') {
                const detailWidth = await detail.locator('.cert-detail-modal-content').evaluate(node => node.getBoundingClientRect().width);
                assert.ok(detailWidth >= 676, `desktop detail has room for the certificate and summary: ${detailWidth}px`);
            }
            const exportButton = detail.getByRole('button', { name: 'Відкрити зображення' });
            await exportButton.click();
            const dialog = page.locator('.cert-image-export-dialog');
            await dialog.waitFor();
            try { await dialog.locator('img:not([hidden])').waitFor(); }
            catch (error) {
                console.error({ device: device.name, status: await dialog.locator('.cert-image-export-status').textContent(),
                    pageErrors });
                throw error;
            }
            fs.mkdirSync(OUTPUT, { recursive: true });
            await page.screenshot({ path: path.join(OUTPUT, `export-${device.name.toLowerCase().replace(/\s+/g, '-')}.png`) });
            assert.equal(await dialog.locator('img').evaluate(image => image.naturalWidth), 1200,
                `${device.name}: ready preview contains full PNG`);
            assert.equal(await page.evaluate(() => window.popupAttempts), 0, `${device.name}: no blank popup`);
            assert.equal(await dialog.evaluate(element => element.getBoundingClientRect().right <= innerWidth), true,
                `${device.name}: export dialog fits viewport`);
            assert.equal(issued.length, issuedBeforeExport, `${device.name}: export does not issue another certificate`);
            const [download] = await Promise.all([
                page.waitForEvent('download'), dialog.getByRole('button', { name: 'Зберегти зображення' }).click()
            ]);
            assert.equal(download.suggestedFilename(), `SYNTHETIC-IMAGE-${issuedBeforeExport}.png`);
            assert.deepEqual([...fs.readFileSync(await download.path()).subarray(0, 8)],
                [137, 80, 78, 71, 13, 10, 26, 10], `${device.name}: downloaded file is a PNG`);
            assert.doesNotMatch(await dialog.locator('.cert-image-export-status').textContent(), /збережено|завантажено/i);
            await dialog.getByRole('button', { name: 'Повернутися до сертифіката' }).click();
            await dialog.waitFor({ state: 'detached' });
            await page.waitForFunction(() => window.exportUrls.created.every(url => window.exportUrls.revoked.includes(url)));
            assert.equal(await exportButton.evaluate(element => document.activeElement === element), true,
                `${device.name}: focus returns to the detail action`);

            if (device.name === 'Android') {
                await page.evaluate(() => {
                    window.shareMode = 'cancel';
                    Object.defineProperty(navigator, 'canShare', { configurable: true, value: ({ files }) => files.length === 1 });
                    Object.defineProperty(navigator, 'share', { configurable: true, value: () => {
                        window.shareUserGesture = navigator.userActivation.isActive;
                        return window.shareMode === 'cancel'
                            ? Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
                            : Promise.resolve();
                    } });
                });
                await exportButton.click();
                await dialog.getByRole('button', { name: 'Поділитися' }).waitFor();
                await dialog.getByRole('button', { name: 'Поділитися' }).click();
                await dialog.getByText('Поширення скасовано.', { exact: false }).waitFor();
                assert.equal(await page.evaluate(() => window.shareUserGesture), true, 'native share starts in the click gesture');
                await page.evaluate(() => { window.shareMode = 'success'; });
                await dialog.getByRole('button', { name: 'Поділитися' }).click();
                await dialog.getByText('Повернулися з меню поширення.', { exact: false }).waitFor();
                await dialog.getByRole('button', { name: 'Повернутися до сертифіката' }).click();
                await dialog.waitFor({ state: 'detached' });

                await page.evaluate(() => Object.defineProperty(navigator, 'canShare', {
                    configurable: true, value: () => false
                }));
                const qrBefore = qrRequests;
                await exportButton.click();
                // A second launch must reuse the open dialog instead of regenerating the image.
                await page.evaluate(() => window.CertificateImageExport.open({
                    loadCertificate: () => { throw new Error('duplicate generation'); }
                }));
                await dialog.locator('img:not([hidden])').waitFor();
                assert.equal(await dialog.locator('[data-export-action="share"]').isHidden(), true,
                    'unsupported share is not offered');
                assert.equal(qrRequests, qrBefore + 1, 'double launch generates one PNG');
                await dialog.getByRole('button', { name: 'Повернутися до сертифіката' }).click();
                await dialog.waitFor({ state: 'detached' });

                qrUnavailable = true;
                await exportButton.click();
                await dialog.getByText('Не вдалося завантажити QR.', { exact: false }).waitFor();
                assert.equal(await dialog.locator('img').isHidden(), true, 'QR failure cannot show incomplete PNG');
                qrUnavailable = false;
                await dialog.getByRole('button', { name: 'Повторити' }).click();
                await dialog.locator('img:not([hidden])').waitFor();
                await dialog.getByRole('button', { name: 'Повернутися до сертифіката' }).click();
                await dialog.waitFor({ state: 'detached' });

                sessionLost = true;
                await exportButton.click();
                await dialog.getByText('Сеанс завершився.', { exact: false }).waitFor();
                sessionLost = false;
                await dialog.getByRole('button', { name: 'Повторити' }).click();
                await dialog.locator('img:not([hidden])').waitFor();
                await dialog.getByRole('button', { name: 'Повернутися до сертифіката' }).click();
                await dialog.waitFor({ state: 'detached' });
                assert.equal(issued.length, issuedBeforeExport, 'cancel, errors and retries do not issue a certificate');
            }
            await context.close();
        }
        console.log(`Certificate export browser smoke passed (${process.env.CERT_EXPORT_BROWSER || 'chromium'}): issuance to PNG, save, share fallback, blocked popup, QR/session retry, and URL cleanup.`);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
