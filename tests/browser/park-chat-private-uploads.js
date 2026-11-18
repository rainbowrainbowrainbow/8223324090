'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createParkWorkFixture } = require('../helpers/park-work-app-fixture');
const { requirePlaywright } = require('./timeline-room-summary-browser-smoke');

async function run() {
    const f = await createParkWorkFixture(['waiter']);
    const actor = f.actors[0];
    const output = path.resolve(__dirname, '../../output/park-chat-private-browser');
    fs.mkdirSync(output, { recursive: true });
    const browser = await requirePlaywright().chromium.launch({ headless: true,
        ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
    const results = [];
    try {
        const created = await f.api(f.root, 'POST', '/api/chat/channels', { name: 'Synthetic-files-' + f.suffix });
        assert.equal(created.status, 201);
        const channelId = created.data.id;
        assert.equal((await f.api(f.root, 'POST', `/api/chat/channels/${channelId}/members`, { userId: actor.id })).status, 200);
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
        const wav = Buffer.alloc(44 + 80000);
        wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
        wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(80000, 40);
        for (const [name, bytes, type] of [['Synthetic-image.png', png, 'image/png'],
            ['Synthetic-note.txt', Buffer.from('Synthetic private download'), 'text/plain'], ['Synthetic-voice.wav', wav, 'audio/wav']]) {
            const body = new FormData(); body.append('file', new Blob([bytes], { type }), name);
            const response = await fetch(`${f.origin}/api/chat/channels/${channelId}/upload`, { method: 'POST', headers: f.headers(f.root), body });
            assert.equal(response.status, 201, name);
        }
        for (const width of [1280, 390]) {
            const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
            const page = await context.newPage();
            const errors = []; const uploadRequests = [];
            page.on('pageerror', error => errors.push(error.name));
            page.on('request', request => {
                const url = new URL(request.url());
                if (url.pathname.startsWith('/api/chat/uploads/')) uploadRequests.push({ query: Boolean(url.search), bearer: Boolean(request.headers().authorization) });
            });
            await context.addInitScript(({ token, user, channelId }) => {
                localStorage.setItem('pzp_token', token); localStorage.setItem('pzp_access_token', token);
                localStorage.setItem('pzp_current_user', JSON.stringify(user));
                localStorage.setItem('pzp_crm_business_context', 'event_genix');
                localStorage.setItem('pzp_crm_business_context_user', String(user.id));
                localStorage.setItem('chatLastActiveChannelId', String(channelId));
                window.__privateUploadUrls = { created: 0, revoked: 0 };
                const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
                URL.createObjectURL = value => { window.__privateUploadUrls.created++; return create(value); };
                URL.revokeObjectURL = value => { window.__privateUploadUrls.revoked++; return revoke(value); };
            }, { token: actor.token, user: actor.user, channelId });
            try {
                await page.goto(f.origin + '/chat', { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => document.querySelector('img[data-chat-private-src]')?.dataset.privateState === 'ready');
                const image = page.locator('img[data-chat-private-src]').first();
                assert.ok((await image.getAttribute('src')).startsWith('blob:'));
                assert.equal(await image.evaluate(element => element.naturalWidth), 1);
                await image.focus(); await image.press('Enter');
                await page.locator('.chat-lightbox-overlay').waitFor({ state: 'visible' });
                await page.keyboard.press('Escape');
                await page.locator('.chat-lightbox-overlay').waitFor({ state: 'detached' });
                const file = page.locator('a[data-chat-private-url]').first();
                await file.focus();
                const downloaded = page.waitForEvent('download');
                await file.press('Enter');
                const download = await downloaded;
                assert.equal(download.suggestedFilename(), 'Synthetic-note.txt');
                assert.equal(fs.readFileSync(await download.path(), 'utf8'), 'Synthetic private download');
                const voice = page.locator('.chat-voice-play-btn').first();
                await voice.focus(); await voice.press('Enter');
                await page.waitForFunction(() => document.querySelector('.chat-voice-play-btn')?.classList.contains('playing'));
                await page.screenshot({ path: path.join(output, `private-${width}.png`), fullPage: false });
                assert.equal(uploadRequests.length >= 3, true);
                assert.equal(uploadRequests.every(request => !request.query && request.bearer), true);
                await page.evaluate(() => window.dispatchEvent(new CustomEvent('crm:auth-cleared')));
                const leases = await page.evaluate(() => window.__privateUploadUrls);
                assert.equal(leases.created, leases.revoked);
                assert.equal(await page.locator('img[data-chat-private-src][src]').count(), 0);
                assert.deepEqual(errors, []);
                results.push({ width, image: true, keyboardPreview: true, download: true, voice: true,
                    authenticatedRequests: uploadRequests.length, privateUrlsRevoked: leases.revoked, pageErrors: errors.length });
                fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ isolated: true, results }, null, 2));
                console.log(`Private Chat uploads ${width}: passed`);
            } catch (error) {
                await page.screenshot({ path: path.join(output, `private-${width}-failure.png`) }).catch(() => {});
                throw error;
            } finally { await context.close(); }
        }
    } finally { await browser.close(); await f.db.end(); }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
