const assert = require('node:assert/strict');
const path = require('node:path');

async function assertNoOverflow(page) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}

async function verifySettings(page, origin, evidence) {
    let size = 0;
    let connected = false;
    const timestamp = i => new Date(Date.UTC(2026, 0, i)).toISOString();
    await page.route('**/api/auth/security', route => {
        const devices = Array.from({ length: size }, (_, i) => ({
            device_info: `QA device ${i + 1}`, ip_address: '192.0.2.10',
            created_at: timestamp(i + 1), expires_at: timestamp(30)
        }));
        if (size) devices.push({ ...devices[size - 1], created_at: timestamp(27) });
        return route.fulfill({ json: { success: true, sessions: devices,
            events: Array.from({ length: size }, (_, i) => ({ event_type: 'login_success', actor_username: `QA event ${i + 1}`, created_at: timestamp(i + 1) })) } });
    });
    await page.route('**/api/auth/telegram-crm', route => route.fulfill({
        json: { success: true, status: connected ? 'connected' : 'disconnected', mode: 'enabled', pilotEnabled: true,
            ...(connected ? { telegramId: '123456789', username: 'qa_profile', botUsername: 'QA_Profile_Bot' } : {}) }
    }));
    const account = page.locator('.profile-settings-account');
    const preview = page.locator('#profileAvatarPreview');
    const headerAvatar = page.locator('.profile-work-avatar').first();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/profile?tab=settings');
    await account.getByRole('heading', { name: 'Telegram' }).waitFor();
    await account.getByText('Не підключено', { exact: true }).waitFor();
    await account.getByText('Активних пристроїв не знайдено.', { exact: true }).waitFor();
    await account.getByText('Подій безпеки акаунта ще немає.', { exact: true }).waitFor();
    assert.equal(await account.getByRole('button', { name: 'Вийти', exact: true }).count(), 0);
    assert.equal(await page.locator('.header #logoutBtn').count(), 1);
    assert.equal(await preview.locator('img').count(), 0);
    for (const avatar of [preview, headerAvatar]) {
        assert.equal(await avatar.evaluate(el => getComputedStyle(el).borderRadius), '50%');
    }

    size = 5;
    await page.reload();
    const lists = account.locator('.profile-security-card');
    await lists.first().getByText('QA device 5', { exact: true }).waitFor();
    for (const list of [lists.first(), lists.last()]) {
        assert.equal(await list.locator('.profile-security-row:visible').count(), 5);
        assert.equal(await list.locator('summary').count(), 0);
    }
    size = 7;
    connected = true;
    await page.route('**/api/auth/profile', async route => {
        const response = await route.fetch();
        const json = await response.json();
        json.user.username = 'qa_'.repeat(34);
        await route.fulfill({ response, json });
    });
    await page.reload();
    await account.getByText('Підтверджено', { exact: true }).waitFor();
    await account.getByText('qa_'.repeat(34), { exact: true }).waitFor();
    await lists.first().getByText('QA device 7', { exact: true }).waitFor();
    assert.match(await lists.first().locator('.profile-security-row').first().innerText(), /QA device 7/);
    assert.match(await lists.last().locator('.profile-security-row').first().innerText(), /QA event 7/);
    for (const [index, list] of [lists.first(), lists.last()].entries()) {
        const summary = list.locator('summary');
        const disclosure = list.locator('details');
        assert.equal(await list.locator('.profile-security-row:visible').count(), 5);
        await summary.press(index ? 'Space' : 'Enter');
        assert.notEqual(await disclosure.getAttribute('open'), null);
        assert.equal(await list.locator('.profile-security-row:visible').count(), 7);
        await summary.press('Enter');
        assert.equal(await disclosure.getAttribute('open'), null);
        assert.equal(await list.locator('.profile-security-row:visible').count(), 5);
    }
    await page.evaluate(() => window.applyCrmThemeMode(false));
    for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(evidence, `profile-settings-${width}.png`), fullPage: true, animations: 'disabled' });
        await assertNoOverflow(page);
        assert.ok(await page.locator('.profile-identity-meta-row').evaluate(row =>
            row.scrollWidth <= row.clientWidth + 1), 'the profile header wraps a long login');
        const [a, b] = await page.locator('.profile-settings-shell > section').evaluateAll(panels =>
            panels.map(panel => panel.getBoundingClientRect().toJSON()));
        if (width === 1440) {
            assert.ok(b.x > a.x && Math.abs(a.y - b.y) <= 1 && Math.abs(a.height - b.height) <= 1, JSON.stringify({ a, b }));
        } else {
            assert.ok(Math.abs(a.x - b.x) <= 1 && b.y >= a.bottom, JSON.stringify({ a, b }));
        }
    }
    await page.unroute('**/api/auth/profile');
    await page.unroute('**/api/auth/security');
    await page.unroute('**/api/auth/telegram-crm');

    for (const height of [64, 112]) {
        const png = await page.evaluate(height => {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = height;
            const context = canvas.getContext('2d');
            context.fillStyle = '#f0b44d';
            context.fillRect(0, 0, 64, height);
            context.fillStyle = '#315f94';
            context.fillRect(8, 16, 48, height / 2);
            return canvas.toDataURL('image/png').split(',')[1];
        }, height);
        await page.locator('#profileAvatarFile').setInputFiles({
            name: 'qa-avatar.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')
        });
        await preview.locator('img[src^="data:"]').waitFor();
        await page.locator('#profileAvatarZoom').fill('1.35');
        await page.locator('#profileAvatarPositionX').fill('63');
        await page.locator('#profileAvatarPositionY').fill('39');
        const save = page.locator('#profileAvatarUploadBtn:enabled');
        await save.scrollIntoViewIfNeeded();
        const [uploaded] = await Promise.all([
            page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/profile/avatar/upload'
                && response.request().method() === 'POST'),
            save.click()
        ]);
        assert.ok(uploaded.ok());
        await headerAvatar.locator('img').waitFor();
        await page.reload();
        for (const avatar of [preview, headerAvatar]) {
            await avatar.locator('img').waitFor();
            assert.equal(await avatar.evaluate(node => getComputedStyle(node).borderRadius), '50%');
            assert.equal(await avatar.locator('img').evaluate(node => getComputedStyle(node).objectPosition), '63% 39%');
            assert.match(await avatar.locator('img').getAttribute('style'), /scale\(1\.35\)/);
        }
        await preview.screenshot({ path: path.join(evidence, `profile-avatar-${height === 64 ? 'square' : 'portrait'}-390.png`) });
    }
}

async function verifySalary(page, origin, evidence) {
    let state = 'empty';
    let failNext = false;
    await page.route('**/api/auth/profile/me/salary?*', route => {
        if (failNext) {
            failNext = false;
            return route.fulfill({ status: 503, json: { error: 'QA retry' } });
        }
        const month = new URL(route.request().url()).searchParams.get('month');
        return route.fulfill({ json: { success: true, month, state: state === 'empty' ? state : 'ready',
            status: state === 'empty' ? null : state, locked: state === 'approved',
            gross: state === 'empty' ? null : 3450, paid: state === 'empty' ? null : 500 } });
    });
    const panel = page.locator('.profile-employee-month');
    await page.goto(origin + '/profile?tab=salary&month=2025-12');
    await panel.getByText('За цей місяць немає збереженого розрахунку.', { exact: true }).waitFor();
    assert.equal(await panel.getByText('Нараховано', { exact: true }).count(), 0);
    const month = page.getByLabel('Місяць', { exact: true });
    const year = page.getByLabel('Рік', { exact: true });
    const selectedLabel = () => month.locator('option:checked').textContent();
    assert.equal(await selectedLabel(), 'грудень');
    state = 'preview';
    await page.getByRole('button', { name: 'Наступний місяць', exact: true }).press('Enter');
    await page.waitForURL('**/profile?tab=salary&month=2026-01');
    assert.equal(await selectedLabel(), 'січень');
    assert.equal(await year.inputValue(), '2026');
    await panel.getByText('Попередньо нараховано', { exact: true }).waitFor();
    state = 'approved';
    failNext = true;
    await month.selectOption('02');
    await panel.getByRole('alert').waitFor();
    await panel.getByRole('button', { name: 'Спробувати ще раз' }).press('Enter');
    await panel.locator('.profile-pay-status').filter({ hasText: /Затверджено[\s\S]*Період закрито/ }).waitFor();
    await panel.getByText('Нараховано', { exact: true }).waitFor();
    for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await assertNoOverflow(page);
        await panel.screenshot({ path: path.join(evidence, `profile-salary-${width}.png`) });
    }
    state = 'empty';
    await page.getByRole('button', { name: 'Попередній місяць', exact: true }).click();
    await panel.getByText('За цей місяць немає збереженого розрахунку.', { exact: true }).waitFor();
    await panel.screenshot({ path: path.join(evidence, 'profile-salary-empty-1440.png') });
    await page.unroute('**/api/auth/profile/me/salary?*');
}

async function verifyLocales(browser, origin, session) {
    for (const locale of ['uk-UA', 'en-US', 'ru-RU']) {
        const context = await browser.newContext({ locale, serviceWorkers: 'block' });
        try {
            await context.route('https://**/*', route => route.abort());
            await context.addInitScript(({ token, user }) => {
                localStorage.setItem('pzp_access_token', token);
                localStorage.setItem('pzp_token', token);
                localStorage.setItem('pzp_current_user', JSON.stringify(user));
                localStorage.setItem('pzp_crm_business_context', 'event_genix');
            }, session);
            const page = await context.newPage();
            for (const tab of ['salary', 'results']) {
                await page.goto(origin + `/profile?tab=${tab}&month=2025-12`);
                await page.getByLabel('Місяць', { exact: true }).waitFor();
                assert.deepEqual(await page.locator('#profileEmployeeMonthSelect option').allTextContents(),
                    ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень']);
            }
        } finally {
            await context.close();
        }
    }
}

module.exports = { verifyLocales, verifySalary, verifySettings };
