'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'hr-team-browser-smoke');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function onboardingMarkup() {
    const source = read('hr.html');
    const start = source.indexOf('<div id="accountOnboardingOverlay"');
    assert.ok(start >= 0);
    const tags = /<\/?div\b[^>]*>/gi;
    tags.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = tags.exec(source))) {
        depth += /^<div\b/i.test(match[0]) ? 1 : -1;
        if (depth === 0) return source.slice(start, tags.lastIndex);
    }
    throw new Error('Account onboarding overlay is incomplete');
}

function fixture(accessState, businessAccessReady, options = {}) {
    const access = { role: 'director', defaultBusinessContext: 'dar', businessContexts: ['dar'] };
    const readiness = accessState ? { accessState, businessAccessReady } : {};
    return {
        success: true,
        loginReady: true,
        ...(options.nested ? {} : readiness),
        credential: { username: 'synthetic.receipt', password: 'SyntheticReceipt234' },
        receipt: {
            account: { id: 9001, name: 'Synthetic QA Account', username: 'synthetic.receipt', role: 'director' },
            staff: { id: 9002, name: 'Synthetic QA Profile', created: true },
            professions: [{ key: 'animator', isPrimary: true }],
            conditions: [],
            access: { ...access, ...(options.nested ? readiness : {}) },
            warnings: accessState === 'unknown' || !accessState
                ? [{ code: 'BUSINESS_ACCESS_STATUS_UNKNOWN', message: 'Статус членства не підтверджено. Перевірте його окремо.' }]
                : []
        }
    };
}

async function install(page) {
    const css = ['css/base.css', 'css/modals.css', 'css/hr-page.css', 'css/pages-hr-foundation.css', 'css/pages-hr-staff.css'].map(read).join('\n');
    await page.route('**/*', route => route.abort());
    await page.setContent(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><style>${css}</style></head><body data-page-group="hr"><main><button id="receiptTrigger" type="button">Відкрити синтетичну квитанцію</button></main>${onboardingMarkup()}</body></html>`);
    await page.evaluate(() => {
        window.AppState = { currentUser: { id: 1, role: 'creator', activeBusinessContext: 'event_genix' } };
        window.__receiptCopies = [];
        window.showNotification = () => {};
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => window.__receiptCopies.push(value) } });
        window.__receiptAddEventListener = document.addEventListener.bind(document);
        document.addEventListener = (type, listener, options) => type === 'DOMContentLoaded' ? undefined : window.__receiptAddEventListener(type, listener, options);
    });
    await page.addScriptTag({ content: read('js/hr-page.js') });
    await page.evaluate(() => {
        document.addEventListener = window.__receiptAddEventListener;
        document.getElementById('receiptTrigger').addEventListener('click', event => {
            accountOnboardingState = {
                open: true, submitting: false, returnFocus: event.currentTarget,
                payload: { access: { defaultBusinessContext: 'dar' } }, receipt: null, credential: null
            };
            bindAccountOnboardingControls();
            const overlay = document.getElementById('accountOnboardingOverlay');
            overlay.classList.remove('hidden');
            overlay.removeAttribute('aria-hidden');
            setAccountOnboardingBackgroundInert(true);
            renderAccountOnboardingReceipt(window.__receiptFixture);
        });
    });
}

async function run(browser) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const page = await browser.newPage({ viewport });
        page.setDefaultTimeout(10_000);
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        try {
            await install(page);
            const cases = [
                { name: 'active', payload: fixture('active', true), message: /Доступ до вибраного бізнесу активний\./ },
                { name: 'pending', payload: fixture('pending_membership', false), message: /Доступ до вибраного бізнесу очікує членства\./ },
                { name: 'unknown', payload: fixture('unknown', false), message: /Стан доступу до вибраного бізнесу не вдалося підтвердити/ },
                { name: 'missing', payload: fixture(), message: /Стан доступу до вибраного бізнесу не вдалося підтвердити/ },
                { name: 'nested', payload: fixture('active', true, { nested: true }), message: /Доступ до вибраного бізнесу активний\./ },
                { name: 'password-unconfirmed', payload: { ...fixture('active', true), loginReady: false }, message: /Готовність пароля до входу не підтверджено/ }
            ];
            for (const scenario of cases) {
                await page.evaluate(payload => { window.__receiptFixture = payload; }, scenario.payload);
                await page.locator('#receiptTrigger').click();
                const overlay = page.locator('#accountOnboardingOverlay');
                const receipt = page.locator('#accountOnboardingReceipt');
                await receipt.waitFor({ state: 'visible' });
                assert.equal(await overlay.getAttribute('role'), 'dialog');
                assert.equal(await overlay.getAttribute('aria-modal'), 'true');
                assert.equal(await page.evaluate(() => document.activeElement.id), 'accountOnboardingReceipt');
                assert.equal(await page.locator('main').evaluate(element => element.inert), true);
                const status = receipt.locator('.hr-account-receipt-access');
                assert.match(await status.innerText(), scenario.message);
                assert.equal(await status.getAttribute('role'), 'status');
                assert.equal(await status.getAttribute('aria-live'), 'polite');
                if (scenario.payload.loginReady) assert.match(await status.innerText(), /Пароль готовий до входу/);
                else assert.doesNotMatch(await status.innerText(), /Пароль готовий до входу/);
                const business = receipt.locator('.hr-account-detail-card').filter({ hasText: 'Вибраний бізнес' });
                assert.equal(await business.locator('strong').innerText(), 'Дар', 'receipt uses the created account business, not the operator Park context');
                assert.match(await receipt.locator('.hr-account-credential').innerText(), /SyntheticReceipt234/);
                if (scenario.payload.receipt.warnings.length) assert.match(await receipt.locator('.hr-account-receipt-warnings').innerText(), /Статус членства не підтверджено/);

                const copyButton = receipt.locator('[data-account-onboarding-copy]');
                await copyButton.click();
                assert.equal(await page.evaluate(() => window.__receiptCopies.at(-1)), 'Username: synthetic.receipt\nPassword: SyntheticReceipt234');
                assert.equal(await page.evaluate(() => accountOnboardingState.credential.password), 'SyntheticReceipt234');
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
                assert.equal(await overlay.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
                const receiptBox = await receipt.boundingBox();
                assert.ok(receiptBox.y >= 0 && receiptBox.y + receiptBox.height <= viewport.height + 1, 'receipt fits its scrollable viewport');
                if (['active', 'pending', 'unknown'].includes(scenario.name)) {
                    await receipt.evaluate(element => { element.scrollTop = 0; });
                    await page.screenshot({
                        path: path.join(OUTPUT_DIR, `account-receipt-${scenario.name}-${viewport.width}-redacted.png`),
                        fullPage: true,
                        mask: [receipt.locator('.hr-account-credential code')]
                    });
                    if (scenario.name === 'unknown' && viewport.width === 390) {
                        await receipt.locator('[data-account-onboarding-finish]').scrollIntoViewIfNeeded();
                        await page.screenshot({
                            path: path.join(OUTPUT_DIR, 'account-receipt-unknown-390-actions-redacted.png'),
                            fullPage: true,
                            mask: [receipt.locator('.hr-account-credential code')]
                        });
                    }
                }

                await page.locator('#accountOnboardingClose').focus();
                await page.keyboard.press('Shift+Tab');
                assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-account-onboarding-finish')), true);
                await page.keyboard.press('Tab');
                assert.equal(await page.evaluate(() => document.activeElement.id), 'accountOnboardingClose');
                if (scenario.name === 'active') {
                    await page.keyboard.press('Shift+Tab');
                    await page.keyboard.press('Enter');
                } else await page.keyboard.press('Escape');
                assert.equal(await overlay.isVisible(), false);
                assert.equal(await page.evaluate(() => document.activeElement.id), 'receiptTrigger');
                assert.equal(await page.locator('main').evaluate(element => element.inert), false);
                assert.equal(await receipt.innerHTML(), '', 'closing removes one-time credentials from the DOM');
                assert.equal(await page.evaluate(() => accountOnboardingState.credential), null);
            }
            assert.deepEqual(pageErrors, [], 'receipt interaction produces no browser errors');
        } finally {
            await page.close();
        }
    }
    console.log('HR account onboarding receipt browser smoke passed (synthetic desktop/mobile, no API writes)');
}

module.exports = { run };
