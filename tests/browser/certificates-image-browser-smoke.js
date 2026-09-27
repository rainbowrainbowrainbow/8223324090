'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const QRCode = require('qrcode');
const { installQrDecoder, decodeQrFromPng } = require('./certificate-qr-decoder');

function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        const entry = String(process.env.PATH || '').split(path.delimiter)
            .find(item => /node_modules[\\/]\.bin[\\/]?$/i.test(item));
        if (entry) return require(path.join(path.dirname(entry), 'playwright'));
        throw error;
    }
}

const { chromium } = requirePlaywright();
const ROOT = path.resolve(__dirname, '../..');
const CERT = {
    certCode: 'SYNTHETIC-IMAGE-01',
    displayValue: 'Олександрія Коваленко-Гриценко та родина',
    typeText: 'Подарунковий сертифікат на одноразовий сімейний вхід до парку',
    validUntil: '2027-12-31',
    status: 'active'
};

async function main() {
    const app = express();
    let failQr = false;
    const qrDataUrl = await QRCode.toDataURL('https://example.test/certificates/check?code=SYNTHETIC-IMAGE-01', {
        width: 320, margin: 2, errorCorrectionLevel: 'M'
    });
    app.get('/fixture', (_req, res) => res.type('html').send(`<!doctype html><html lang="uk"><head>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <link rel="stylesheet" href="/css/pages-certificates.css"></head>
        <body><div id="preview" class="cert-standalone-preview" style="width:100%;max-width:1200px"></div>
        <script>window.API_BASE='/api';window.getAuthHeaders=()=>({});window.apiFetchWithAuthRetry=(...args)=>fetch(...args)</script>
        <script src="/js/certificate-preview.js"></script></body></html>`));
    app.get('/api/certificates/qr/:code', (req, res) => {
        if (req.params.code !== CERT.certCode) return res.sendStatus(404);
        if (failQr) return res.sendStatus(503);
        res.json({ dataUrl: qrDataUrl });
    });
    for (const dir of ['css', 'js', 'images']) app.use('/' + dir, express.static(path.join(ROOT, dir)));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        for (const device of [
            { name: 'desktop', width: 1280, mobile: false, touch: false, ua: 'Synthetic Desktop' },
            { name: 'Android', width: 390, mobile: true, touch: true, ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130' },
            { name: 'iPhone', width: 390, mobile: true, touch: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' }
        ]) {
            const context = await browser.newContext({ viewport: { width: device.width, height: 844 },
                isMobile: device.mobile, hasTouch: device.touch, userAgent: device.ua });
            const page = await context.newPage();
            await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
            await page.goto(`${base}/fixture`);
            await installQrDecoder(page);
            for (const season of ['winter', 'spring', 'summer', 'autumn']) {
                const result = await page.evaluate(async cert => {
                    window.qrRects = [];
                    window.textRuns = [];
                    const original = CanvasRenderingContext2D.prototype.drawImage;
                    const originalText = CanvasRenderingContext2D.prototype.fillText;
                    CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
                        if (image.src?.startsWith('data:image/png')) window.qrRects.push(args);
                        return original.call(this, image, ...args);
                    };
                    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
                        if (this.fillStyle === '#0d2e5c' || this.fillStyle === '#2e5090') {
                            window.textRuns.push({ text, width: this.measureText(text).width, color: this.fillStyle });
                        }
                        return originalText.call(this, text, ...args);
                    };
                    try {
                        const preview = await window.CertificatePreview.renderInto('preview', cert);
                        const generated = await window.CertificatePreview.generateCertificateCanvas(cert);
                        const sample = preview.getContext('2d').getImageData(162, window.qrRects[0][1] + 12, 200, 200).data;
                        const border = preview.getContext('2d').getImageData(
                            window.qrRects[0][0] - 5, window.qrRects[0][1] - 5, 1, 1).data;
                        let dark = 0;
                        for (let i = 0; i < sample.length; i += 4) {
                            if (sample[i] < 90 && sample[i + 1] < 90 && sample[i + 2] < 90) dark++;
                        }
                        return { width: preview.width, height: preview.height,
                            displayedWidth: preview.getBoundingClientRect().width,
                            qrRects: window.qrRects, dark, border: [...border], textRuns: window.textRuns,
                            samePng: preview.toDataURL('image/png') === generated.toDataURL('image/png'),
                            exportedPng: generated.toDataURL('image/png') };
                    } finally {
                        CanvasRenderingContext2D.prototype.drawImage = original;
                        CanvasRenderingContext2D.prototype.fillText = originalText;
                    }
                }, { ...CERT, season });
                assert.deepEqual([result.width, result.height], [1200, 800], `${device.name}/${season}: canonical PNG size`);
                assert(result.displayedWidth <= device.width, `${device.name}/${season}: preview fits the viewport`);
                assert(result.samePng, `${device.name}/${season}: preview and export PNG match`);
                const decoded = await decodeQrFromPng(page, result.exportedPng);
                assert.deepEqual([decoded.width, decoded.height], [1200, 800],
                    `${device.name}/${season}: decoded PNG has the canonical size`);
                assert.equal(decoded.url,
                    'https://example.test/certificates/check?code=SYNTHETIC-IMAGE-01',
                    `${device.name}/${season}: final PNG QR opens the exact certificate deep link`);
                assert(result.dark > 1000, `${device.name}/${season}: QR has visible dark modules`);
                assert(result.border.slice(0, 3).every(channel => channel >= 245), `${device.name}/${season}: QR has a white quiet zone`);
                assert(result.textRuns.filter(run => run.color === '#0d2e5c').length >= 4,
                    `${device.name}/${season}: long recipient wraps on both canvases`);
                assert(result.textRuns.every(run => run.width <= 390), `${device.name}/${season}: dynamic text fits the card`);
                assert.equal(result.qrRects.length, 2, `${device.name}/${season}: both canvases include QR`);
                for (const [x, y, width, height] of result.qrRects) {
                    assert(x >= 44 && x + width <= 480, `${device.name}/${season}: QR fits the card horizontally`);
                    assert(y >= 36 && y + height < 744, `${device.name}/${season}: QR clears the footer`);
                }
            }
            if (device.name === 'Android') {
                failQr = true;
                const fallback = await page.evaluate(async cert => {
                    const result = await window.CertificatePreview.renderInto('preview', cert);
                    let rejected = false;
                    try { await window.CertificatePreview.generateCertificateCanvas(cert); }
                    catch { rejected = true; }
                    return { tag: result.tagName, rejected, canvasCount: document.querySelectorAll('#preview canvas').length,
                        text: document.querySelector('#preview').textContent };
                }, CERT);
                assert.equal(fallback.tag, 'ARTICLE');
                assert(fallback.rejected, 'QR outage blocks PNG export');
                assert.equal(fallback.canvasCount, 0, 'QR outage does not show a finished image');
                assert.match(fallback.text, /QR/);
                assert.doesNotMatch(fallback.text, /iPhone/);
                failQr = false;
                await page.getByRole('button', { name: 'Повторити створення зображення' }).click();
                await page.locator('#preview canvas').waitFor();
            }
            await context.close();
        }
        console.log('Certificate image browser smoke passed: desktop, Android, iPhone, seasons, PNG geometry, QR failure/retry.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
