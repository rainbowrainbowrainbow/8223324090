'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requirePlaywright, routeMockedApi, businessProfilePayload, createStaticServer, SMOKE_USER } =
    require('./timeline-room-summary-browser-smoke');

(async () => {
    const playwright = requirePlaywright();
    const browser = await playwright.chromium.launch({ headless: true,
        ...(process.env.EVENTGENIX_BROWSER_CHANNEL ? { channel: process.env.EVENTGENIX_BROWSER_CHANNEL } : {}) });
    const { server, baseUrl } = await createStaticServer();
    let context;
    try {
        context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
        await context.addInitScript(user => {
            localStorage.setItem('pzp_token', 'fixture');
            localStorage.setItem('pzp_access_token', 'fixture');
            localStorage.setItem('pzp_current_user', JSON.stringify(user));
            localStorage.setItem('pzp_crm_business_context', 'event_genix');
            localStorage.setItem('pzp_crm_business_context_user', String(user.id));
        }, SMOKE_USER);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await routeMockedApi(page);
        let legacyDiscoveryCalls = 0;
        await page.route('**/api/telegram/chats', route => {
            legacyDiscoveryCalls++;
            return route.fulfill({ json: { chats: [] } });
        });
        await page.route('**/api/business/profile**', route => {
            const profile = businessProfilePayload();
            const timeline = profile.businessProfile.businesses[0].timeline;
            timeline.defaultTimelineView = 'animators';
            timeline.enabledModules.afisha = true;
            timeline.timelineFeatures.afisha = true;
            return route.fulfill({ json: profile });
        });
        await page.route('**/api/lines/**', route => route.fulfill({ json: [
            { id: '1', name: 'Аніматор 1', color: '#6952ce' },
            { id: '2', name: 'Аніматор 2', color: '#4595d2' }
        ] }));
        await page.route('**/api/bookings/**', route => route.fulfill({ json: [] }));
        const events = [{ id: 1, date: '2026-10-19', time: '14:00', title: 'Космічна афіша', duration: 60,
            type: 'event', description: '', original_time: '14:00', line_id: '1', second_line_id: '2', promotion_id: 7 }];
        const promotion = { id: 7, title: 'Осіння акція', description: '', color_key: 'amber',
            starts_on: '2026-10-19', ends_on: '2026-10-25', version: 1 };
        let publishRequests = 0;
        const recipients = [];
        let features = { animatorApprovals: true, afishaAnnouncements: false };
        const routeSelections = {};
        const telegramDirectory = [
            { key: '-1001:', chatId: '-1001', chatTitle: 'First group' },
            { key: '-1001:11', chatId: '-1001', chatTitle: 'First group', threadId: '11', threadTitle: 'Test CRM' },
            { key: '-1002:', chatId: '-1002', chatTitle: 'Second group' },
            { key: '-1002:22', chatId: '-1002', chatTitle: 'Second group', threadId: '22', threadTitle: 'Planning' }
        ];
        await page.route('**/api/afisha/**', async route => {
            const request = route.request();
            const pathname = new URL(request.url()).pathname;
            if (pathname === '/api/afisha/announcements/telegram-routes/digest') {
                assert.deepEqual(request.postDataJSON(), { target: '-1001:11' });
                routeSelections.digest = '-1001:11';
                return route.fulfill({ json: { success: true } });
            }
            if (pathname === '/api/afisha/announcements/telegram-features') {
                const next = request.postDataJSON();
                assert.deepEqual(next, { animatorApprovals: true, afishaAnnouncements: true });
                features = next;
                return route.fulfill({ json: { telegramFeatures: features } });
            }
            if (pathname === '/api/afisha/announcements/recipients') {
                if (request.method() === 'POST') {
                    const input = request.postDataJSON();
                    assert.equal(input.active, false);
                    if (input.platform === 'telegram') {
                        assert.equal(input.chatId, '-1002');
                        assert.equal(input.threadId, '22');
                    } else {
                        assert.equal(input.platform, 'crm_chat');
                        assert.equal(input.channelId, '77');
                    }
                    const { webhook, ...publicConfig } = input;
                    const recipient = { ...publicConfig, id: String(recipients.length + 1), webhookConfigured: Boolean(webhook) };
                    if (input.platform === 'telegram') recipient.nextAt = '2026-10-20T05:00:00Z';
                    recipients.push(recipient);
                    return route.fulfill({ status: 201, json: { recipient } });
                }
                return route.fulfill({ json: { recipients, crmChannels: [{ id: 77, name: '#Керівники' }], dailyDigest: { chatId: '-1002', threadId: '22' },
                    approvalTarget: { chatId: '-1002', threadId: '22' }, telegramFeatures: features, telegramDirectory, routeSelections,
                    routingPreview: [
                        { feature: 'approval', botProfile: 'operational', chatId: '-1002', threadId: '22' },
                        { feature: 'digest', botProfile: 'legacy_notifications', chatId: routeSelections.digest ? '-1001' : '-1003', threadId: routeSelections.digest ? '11' : '30', weekday: '12:32', weekend: '10:00' },
                        { feature: 'reminder', botProfile: 'legacy_notifications', chatId: '-1003', threadId: '30', time: '20:00' }
                    ] } });
            }
            if (pathname === '/api/afisha/announcements/telegram-chats') {
                return route.fulfill({ json: { chats: [{ id: '-1001', title: 'Перша група' }, { id: '-1002', title: 'Друга група' }] } });
            }
            if (pathname === '/api/afisha/announcements/recipients/1/preview') {
                return route.fulfill({ json: { scheduledAt: '2026-10-20T05:00:00Z', parts: ['Наступна афіша'] } });
            }
            if (pathname === '/api/afisha/announcements/recipients/1/history') {
                return route.fulfill({ json: { journal: [{ slot_key: 'daily:2026-10-19', kind: 'daily',
                    at: '2026-10-19T07:00:00Z', status: 'sent', parts: [{ status: 'sent', text: 'Ранкова афіша' }] }] } });
            }
            const publicationRecipients = [{ id: '70', name: 'Команда парку', platform: 'telegram', selected: true },
                { id: '77', name: '#Керівники', platform: 'crm_chat', selected: true }];
            if (pathname === '/api/afisha/announcements/publication-options') {
                return route.fulfill({ json: { recipients: publicationRecipients, layout: null } });
            }
            if (pathname === '/api/afisha/announcements/preview') {
                assert.equal(new URL(request.url()).searchParams.get('businessContext'), 'event_genix');
                const input = request.postDataJSON();
                assert.equal(input.from, '2026-10-01');
                return route.fulfill({ json: {
                    recipients: publicationRecipients, deliveryState: publicationRecipients.map(({ id }) => ({ id })),
                    parts: ['Космічна афіша <test>', 'Осіння акція'],
                    previewToken: input.to
                } });
            }
            if (pathname === '/api/afisha/announcements/publish') {
                publishRequests++;
                assert.deepEqual(request.postDataJSON(), { previewToken: '2026-10-30', recipientIds: ['70', '77'], resend: false });
                return route.fulfill({ status: 202, json: { queued: 2 } });
            }
            if (pathname === '/api/afisha/timeline' && request.method() === 'POST') {
                const input = request.postDataJSON();
                const item = { ...input, id: 2, original_time: input.time, line_id: input.lineIds[0] || null,
                    second_line_id: input.lineIds[1] || null, promotion_id: input.promotionId };
                events.push(item);
                return route.fulfill({ status: 201, json: { success: true, item } });
            }
            if (/^\/api\/afisha\/\d{4}-\d{2}-\d{2}$/.test(pathname)) {
                const date = pathname.split('/').pop();
                return route.fulfill({ json: events.filter(event => event.date === date) });
            }
            return route.fulfill({ json: { success: true } });
        });
        await page.route('**/api/timeline/promotions**', route => route.fulfill({ json: { context: 'event_genix', promotions: [promotion] } }));
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.AppState && window.TimelineAfisha && window.__crmBusinessNavigationPending !== true
            && !document.getElementById('mainApp').classList.contains('hidden'));
        await page.evaluate(async () => {
            AppState.selectedDate = new Date('2026-10-19T12:00:00');
            AppState.multiDayMode = false;
            if (window.TimelineView?.set) await window.TimelineView.set('animators', { render: false });
            await renderTimeline();
        });
        await page.locator('[data-toggle-marketing]').click();
        await page.locator('.timeline-afisha-summary-event').waitFor();
        assert.equal(await page.locator('.line-grid[data-line-id="afisha"] .afisha-flag[data-afisha-id="1"]').count(), 1);
        assert.equal(await page.locator('.line-grid[data-line-id="1"] .afisha-flag[data-afisha-id="1"]').count(), 1);
        assert.equal(await page.locator('.line-grid[data-line-id="2"] .afisha-flag[data-afisha-id="1"]').count(), 1);
        assert.equal(await page.locator('[data-linked-afisha="1"]').count(), 1);
        const publication = page.getByRole('dialog', { name: 'Опублікувати афішу' });
        await page.locator('[data-publish-afisha]').click();
        assert.equal(await publication.locator('[name=from]').inputValue(), '2026-10-01');
        assert.equal(await publication.locator('[name=to]').inputValue(), '2026-10-31');
        assert.equal(await publication.locator('[data-publish]').isDisabled(), true);
        await publication.getByText('Текстова афіша без зображення.').waitFor();
        await publication.locator('[data-preview]').click();
        await publication.locator('[data-publication-preview]').getByText('Команда парку · Telegram').waitFor();
        await publication.locator('[data-publication-preview]').getByText('#Керівники · Чат CRM').waitFor();
        assert.equal(await publication.locator('pre').first().textContent(), 'Космічна афіша <test>');
        await publication.locator('[name=to]').fill('2026-10-30');
        assert.equal(await publication.locator('[data-publish]').isDisabled(), true);
        await publication.locator('[data-preview]').click();
        await publication.locator('[data-publication-preview]').getByText('#Керівники · Чат CRM').waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        const publishBox = await publication.locator('.timeline-marketing-dialog').boundingBox();
        assert.ok(publishBox && publishBox.x >= 0 && publishBox.x + publishBox.width <= 390);
        await publication.locator('[data-publish]').click();
        await publication.getByText('Допис поставлено в чергу.', { exact: false }).waitFor();
        assert.equal(publishRequests, 1);
        assert.equal(await publication.locator('[data-publish]').isDisabled(), true);
        await page.keyboard.press('Escape');
        await publication.waitFor({ state: 'detached' });
        await page.setViewportSize({ width: 1440, height: 960 });
        await page.locator('[data-add-afisha]').click();
        await page.locator('[data-create-form] input[name="title"]').fill('Нова афіша');
        await page.locator('[data-create-form] select[name="promotion"]').selectOption('7');
        await page.locator('[data-create-form] [data-lines] input').first().check();
        await page.locator('[data-create-form] [data-lines] input').last().check();
        await page.locator('[data-create-form] button[type="submit"]').click();
        await page.locator('.line-grid[data-line-id="afisha"] .afisha-flag[data-afisha-id="2"]').waitFor();
        assert.equal(await page.locator('.line-grid[data-line-id="1"] .afisha-flag[data-afisha-id="2"]').count(), 1);
        assert.equal(await page.locator('.line-grid[data-line-id="2"] .afisha-flag[data-afisha-id="2"]').count(), 1);
        const marketingToggle = page.locator('[data-toggle-marketing]');
        if (await marketingToggle.getAttribute('aria-expanded') !== 'true') await marketingToggle.click();
        const output = path.join(__dirname, '../../output/playwright');
        fs.mkdirSync(output, { recursive: true });
        await page.screenshot({ path: path.join(output, 'timeline-afisha-dual-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.timeline-afisha-summary-event[data-afisha-id="2"]').click();
        const box = await page.locator('.timeline-marketing-dialog').boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'mobile dialog stays inside viewport');
        await page.screenshot({ path: path.join(output, 'timeline-afisha-dual-mobile.png') });
        await page.locator('.timeline-marketing-dialog [data-close]').click();
        await page.setViewportSize({ width: 1440, height: 960 });
        await page.evaluate(async () => {
            AppState.multiDayMode = true;
            AppState.daysToShow = 7;
            await renderTimeline();
        });
        await page.waitForFunction(() => ['afisha', '1', '2'].every(lineId =>
            document.querySelectorAll('.day-section[data-date="2026-10-19"] .mini-line-grid[data-line-id="' + lineId +
                '"] .afisha-flag[data-afisha-id="2"]').length === 1));
        await page.screenshot({ path: path.join(output, 'timeline-afisha-dual-week.png') });
        await page.evaluate(async () => { await showSettings(); });
        const settings = page.locator('#settingsAfishaAnnouncements');
        await settings.locator(':scope > summary').click();
        await settings.getByText('Додайте першу групу').waitFor();
        const routing = settings.locator('[data-telegram-routing-list]');
        await routing.locator('li > span').filter({ hasText: /Second group.*Planning/ }).waitFor();
        await routing.getByText(/Щоденне зведення.*-1003.*будні 12:32, вихідні 10:00/).waitFor();
        await routing.getByText(/Нагадування на завтра.*-1003.*20:00/).waitFor();
        await settings.locator('details > summary').last().click();
        await settings.locator('[data-telegram-directory-list]').getByText('First group · Test CRM').waitFor();
        const digestRoute = routing.locator('li').nth(1).locator('select');
        await digestRoute.selectOption('-1001:11');
        await digestRoute.locator('..').locator('button').click();
        await routing.getByText(/First group.*Test CRM.*12:32/).waitFor();
        assert.equal(await settings.locator('[name=animatorApprovals]').isChecked(), true);
        assert.equal(await settings.locator('[name=afishaAnnouncements]').isChecked(), false);
        await settings.locator('[name=afishaAnnouncements]').check();
        await settings.getByRole('button', { name: 'Зберегти функції' }).click();
        await settings.getByText('Функції збережено.').waitFor();
        await settings.locator('[data-add-announcement-recipient]').click();
        const edit = page.getByRole('dialog', { name: 'Додати отримувача' });
        await edit.locator('[name=telegramTarget]').selectOption('-1002:22');
        await edit.locator('[name=name]').fill('Команда парку');
        await edit.locator('[name=telegramTarget] option:checked[value="-1002:22"]').waitFor({ state: 'attached' });
        await edit.locator('[data-digest-warning]').waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        const editBox = await edit.locator('.timeline-marketing-dialog').boundingBox();
        assert.ok(editBox && editBox.x >= 0 && editBox.x + editBox.width <= 390);
        await edit.getByRole('button', { name: 'Зберегти отримувача' }).click();
        await settings.getByText('Команда парку').waitFor();
        await settings.getByRole('button', { name: 'Переглянути допис' }).click();
        const next = page.getByRole('dialog', { name: 'Наступний допис · Команда парку' });
        await next.getByText('Наступна афіша').waitFor();
        await next.getByRole('button', { name: 'Закрити' }).click();
        await settings.getByRole('button', { name: 'Історія доставки' }).click();
        const history = page.getByRole('dialog', { name: 'Історія доставки · Команда парку' });
        await history.locator('summary').click();
        await history.getByText('Ранкова афіша').waitFor();
        await history.getByRole('button', { name: 'Закрити' }).click();
        await settings.locator('[data-add-announcement-recipient]').click();
        await edit.locator('[name=platform]').selectOption('crm_chat');
        assert.equal(await edit.locator('[name=telegramTarget]').isVisible(), false);
        await edit.locator('[name=crmTarget]').selectOption('77');
        await edit.getByRole('button', { name: 'Зберегти отримувача' }).click();
        await settings.getByText('#Керівники').waitFor();
        assert.equal((await settings.textContent()).includes('token='), false);
        assert.equal(legacyDiscoveryCalls, 0);
        assert.deepEqual(errors, []);
        console.log('Timeline Afisha dual browser smoke passed: day, week and mobile screenshots captured.');
    } finally {
        await context?.close().catch(() => {});
        await browser.close().catch(() => {});
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
