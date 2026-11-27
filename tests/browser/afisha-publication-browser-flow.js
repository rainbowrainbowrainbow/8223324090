'use strict';

const assert = require('node:assert/strict');
const { requirePlaywright, routeMockedApi, businessProfilePayload, SMOKE_USER } =
    require('./timeline-room-summary-browser-smoke');

async function inBrowser(fixture, userId, run) {
    const browser = await requirePlaywright().chromium.launch({
        headless: true,
        ...(process.env.EVENTGENIX_BROWSER_CHANNEL ? { channel: process.env.EVENTGENIX_BROWSER_CHANNEL } : {})
    });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
        const user = { ...SMOKE_USER, id: userId };
        await context.addInitScript(value => {
            localStorage.setItem('pzp_token', 'fixture');
            localStorage.setItem('pzp_access_token', 'fixture');
            localStorage.setItem('pzp_current_user', JSON.stringify(value));
            localStorage.setItem('pzp_crm_business_context', 'event_genix');
            localStorage.setItem('pzp_crm_business_context_user', String(value.id));
        }, user);
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        await routeMockedApi(page);
        await page.route('**/api/auth/verify**', route => route.fulfill({ json: { user } }));
        await page.route('**/api/business/profile**', route => {
            const profile = businessProfilePayload();
            const park = profile.businessProfile.businesses[0];
            park.timeline.defaultTimelineView = 'animators';
            park.timeline.enabledModules.afisha = true;
            park.timeline.timelineFeatures.afisha = true;
            park.modules = [...new Set([...(park.modules || []), 'chat'])];
            return route.fulfill({ json: profile });
        });
        const real = route => route.continue({ headers: {
            ...route.request().headers(), 'x-fixture-user': String(userId)
        } });
        await run(page, fixture.base, real);
    } finally {
        await browser.close();
    }
}

async function publishPosterInBrowser({ fixture, initialIds, importText, fixtureEvent, firstImage, partCount }) {
    await inBrowser(fixture, 1, async (page, base, real) => {
        await page.route('**/api/afisha/**', real);
        await page.route('**/api/timeline/promotions**', real);
        await page.route('**/api/lines/**', route => route.fulfill({ json: [{ id: '1', name: 'Аніматор', color: '#6952ce' }] }));
        await page.route('**/api/bookings/**', route => route.fulfill({ json: [] }));
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.AppState && window.TimelineAfisha && window.__crmBusinessNavigationPending !== true
            && !document.getElementById('mainApp').classList.contains('hidden'));
        await page.evaluate(async () => {
            AppState.selectedDate = new Date('2026-10-19T12:00:00');
            AppState.multiDayMode = false;
            await window.TimelineView.set('animators', { render: false });
            await renderTimeline();
        });
        await page.locator('[data-toggle-marketing]').click();
        await page.locator('[data-add-afisha]').click();
        await page.getByRole('button', { name: 'Кілька заходів' }).click();
        await page.locator('[name=importText]').fill(importText);
        await page.getByRole('button', { name: 'Перевірити розклад' }).click();
        await page.locator('[data-import-preview]').getByText(fixtureEvent, { exact: false }).waitFor();
        await page.getByRole('button', { name: 'Додати 2 заходи' }).click();
        await page.getByText('Додано заходів: 2.', { exact: false }).waitFor();
        const stored = await fixture.pool.query('SELECT id FROM afisha WHERE title = $1', [fixtureEvent]);
        await page.locator('.line-grid[data-line-id="afisha"] .afisha-flag[data-afisha-id="' + stored.rows[0].id + '"]').waitFor();

        const open = () => page.locator('[data-publish-afisha]').click();
        const dialog = page.getByRole('dialog', { name: 'Опублікувати афішу' });
        await open();
        await dialog.getByText('Текстова афіша без зображення.').waitFor();
        await dialog.locator('[name=layout]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: firstImage });
        await dialog.getByRole('button', { name: 'Зберегти макет' }).click();
        await dialog.getByText('Макет збережено.').waitFor();
        assert.equal(await partCount(), 0);
        await dialog.getByRole('button', { name: 'Закрити' }).click();
        await open();
        await dialog.locator('img[alt="Макет афіші"]').waitFor();
        await page.waitForFunction(() => document.querySelector('img[alt="Макет афіші"]')?.naturalWidth === 6);
        for (const id of initialIds) await dialog.locator('[data-publication-recipients] input[value="' + id + '"]').check();
        await dialog.getByRole('button', { name: 'Переглянути', exact: true }).click();
        await dialog.locator('[data-publication-preview]').getByText('ParkRozvag · Загальний чат · Telegram', { exact: true }).waitFor();
        await dialog.locator('[data-publication-preview]').getByText('#Афіша команди · Чат CRM', { exact: true }).waitFor();
        assert.match(await dialog.locator('pre').first().textContent(), new RegExp('16:20 — ' + fixtureEvent));
        await dialog.getByRole('button', { name: 'Надіслати зараз' }).click();
        await dialog.getByText('Допис поставлено в чергу.', { exact: false }).waitFor();
    });
}

async function readPosterInBrowser({ fixture, channel, fixtureEvent, attachmentUrl }) {
    await inBrowser(fixture, 2, async (page, base, real) => {
        await page.route('**/api/chat/channels', route => route.continue({
            url: route.request().url() + '?accessProbe=1',
            headers: { ...route.request().headers(), 'x-fixture-user': '2' }
        }));
        await page.route('**/api/chat/channels/' + channel + '/messages**', real);
        await page.route('**' + attachmentUrl, real);
        await page.route('**/api/chat' + attachmentUrl.replace('/uploads/chat/', '/uploads/'), real);
        await page.goto(base + '/chat.html', { waitUntil: 'domcontentloaded' });
        const row = page.locator('.chat-channel-item').filter({ hasText: '#Афіша команди' });
        await row.waitFor();
        if (!(await row.getAttribute('class')).includes('active')) await row.click();
        const message = page.locator('.chat-bubble').filter({ hasText: fixtureEvent });
        await message.getByText(fixtureEvent, { exact: false }).waitFor();
        const image = message.locator('img').first();
        await image.waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('.chat-bubble img')].some(img => img.naturalWidth === 6));
    });
}

module.exports = { publishPosterInBrowser, readPosterInBrowser };
