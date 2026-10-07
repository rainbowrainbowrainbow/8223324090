'use strict';

// Actual application, HTTP and PostgreSQL proof. Only fixtures and a deliberately
// lost response are synthetic; no finance response or calculation is mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { chromium } = require(process.env.FINANCE_QA_PLAYWRIGHT || 'playwright');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, { ...process.env, DATABASE_URL: '' });
assert.equal(database.isLocal, true);
const base = process.env.TEST_URL;
const output = path.resolve(__dirname, '../../output/playwright/finance-money');

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const pool = new Pool({ connectionString: database.url.toString(), ssl: false });
    let browser;
    try {
        const bookingId = 'manual-browser-booking';
        await pool.query(`INSERT INTO bookings
            (id,date,time,line_id,status,price,business_context,room,room_resource_id)
            VALUES ($1,'2099-06-15','10:00','manual-browser-qa','confirmed',10000,
                    'event_genix','Manual QA room','manual-qa-room')`, [bookingId]);
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
        await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin
            ? route.continue() : route.abort());
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.locator('#username').fill(process.env.TEST_USER);
        await page.locator('#password').fill(process.env.TEST_PASS);
        await page.locator('#loginForm button[type="submit"]').click();
        await page.locator('#mainApp').waitFor({ state: 'visible', timeout: 45000 });
        await page.goto(`${base}/finance?businessContext=event_genix&tab=shift`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-finance-group="cash"]').click();
        await page.locator('.fin-tab[data-tab="shift"]').click();
        await page.locator('#fmCreateAccount').waitFor({ state: 'visible', timeout: 30000 });

        async function createAccount(name) {
            await page.locator('#fmCreateAccount').click();
            await page.locator('#accName').fill(name);
            await page.locator('#accEmoji').selectOption('💼');
            await page.locator('#accType').selectOption('cash');
            await page.locator('#addAccountModal button', { hasText: 'Зберегти' }).click();
            await page.locator('#addAccountModal').waitFor({ state: 'hidden' });
            await page.waitForFunction(text => Array.from(document.querySelectorAll('#fmAccount option'))
                .some(option => option.textContent.includes(text)), name);
            const account = (await pool.query('SELECT id FROM finance_accounts WHERE name=$1 AND business_context=$2',
                [name, 'event_genix'])).rows[0];
            assert.ok(account);
            await page.locator('#fmAccount').selectOption(String(account.id));
            return account.id;
        }
        async function action(command, fields = {}) {
            await page.locator('#fmAction').selectOption(command);
            for (const [selector, value] of Object.entries(fields)) await page.locator(`#${selector}`).fill(value);
        }
        async function submit() {
            const responsePromise = page.waitForResponse(response => response.url().includes('/manual-money/commands')
                && response.request().method() === 'POST');
            await page.locator('#fmSubmit').click();
            const response = await responsePromise;
            const result = await response.json();
            assert.ok(response.ok(), JSON.stringify(result));
            assert.equal(result.success, true);
            await page.waitForFunction(() => !document.querySelector('#fmSubmit').disabled
                && /підтверджено|Дубль не створено/.test(document.querySelector('#fmCommandStatus').textContent));
            return result;
        }
        async function selectAccount(id) { await page.locator('#fmAccount').selectOption(String(id)); }
        async function receipt(id, amount) {
            await selectAccount(id);
            await action('booking_receipt', { fmBookingRef: bookingId, fmAmount: amount });
            await page.locator('#fmFindBooking').click();
            await page.waitForFunction(() => document.querySelector('#fmBookingSummary').textContent.includes('Залишок до сплати:'));
            return submit();
        }

        const firstId = await createAccount('QA Каса 1');
        await action('enroll', { fmAmount: '5000,00', fmReason: 'Counted opening fixture' });
        await submit();
        await action('open_shift'); await submit();
        const secondId = await createAccount('QA Каса 2');
        await action('enroll', { fmAmount: '0', fmReason: 'Empty opening fixture' });
        await submit();
        await action('open_shift'); await submit();

        await selectAccount(firstId);
        await action('expense', { fmAmount: '800,25', fmDescription: 'QA матеріали' });
        await page.locator('#fmCreateCategory').click();
        assert.equal(await page.locator('#financeCategoryType').inputValue(), 'expense');
        await page.locator('#financeCategoryName').fill('QA матеріали');
        await page.locator('#saveFinanceCategoryBtn').click();
        await page.locator('#financeCategoryModal').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#fmAmount').inputValue(), '800,25', 'inline category retains money draft');
        assert.ok(await page.locator('#fmCategory').inputValue(), 'new category selected');

        let lostRequest;
        const commandPattern = /\/api\/finance\/manual-money\/commands(?:\?|$)/;
        await page.route(commandPattern, async route => {
            const response = await route.fetch();
            assert.ok(response.ok(), 'first request committed before its response was lost');
            lostRequest = route.request().postDataJSON();
            await route.abort('failed');
        }, { times: 1 });
        await page.locator('#fmSubmit').click();
        await page.locator('#fmRetry').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.querySelector('#fmRetryError').textContent.includes('невідомий'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('#fmRetry').waitFor({ state: 'visible' });
        const replayPromise = page.waitForResponse(response => response.url().includes('/manual-money/commands'));
        await page.locator('#fmRetry').click();
        const replay = await replayPromise;
        assert.deepEqual(replay.request().postDataJSON(), lostRequest, 'reload reuses exact persisted command');
        assert.equal((await replay.json()).replayed, true);
        await page.locator('#fmPendingBox').waitFor({ state: 'hidden' });
        const expenseCount = (await pool.query("SELECT COUNT(*)::integer AS n FROM finance_manual_operations WHERE command='expense'")).rows[0].n;
        assert.equal(expenseCount, 1);

        const firstReceipt = await receipt(firstId, '3000');
        await receipt(secondId, '7000');
        await selectAccount(firstId);
        await action('transfer', { fmAmount: '2000', fmReason: 'Move counted cash to till 2' });
        await page.locator('#fmToAccount').selectOption(String(secondId));
        await submit();
        await action('refund', { fmAmount: '1000', fmReason: 'Partial refund fixture' });
        await page.locator('#fmOriginal').selectOption(firstReceipt.operationId);
        await submit();
        await action('close_shift', { fmAmount: '4199,75', fmReason: 'Closing cash counted exactly' });
        await submit();
        assert.match(await page.locator('#fmAccountSummary').innerText(), /4 199,75/);
        await action('open_shift'); await submit();
        assert.match(await page.locator('#fmAccountSummary').innerText(), /4 199,75/);
        await selectAccount(secondId);
        assert.match(await page.locator('#fmAccountSummary').innerText(), /9 000,00/);

        await selectAccount(firstId);
        await action('expense');
        for (const theme of ['dark', 'light']) {
            await page.evaluate(next => {
                localStorage.setItem('pzp_dark_mode', String(next === 'dark'));
                document.documentElement.setAttribute('data-theme', next);
                document.documentElement.style.colorScheme = next;
                document.body.classList.toggle('dark-mode', next === 'dark');
            }, theme);
            for (const width of [1440, 390]) {
                await page.setViewportSize({ width, height: 1000 });
                await page.locator('#fmTitle').scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: true });
                const overflow = await page.locator('#financeMoneyWorkspace').evaluate(element => {
                    const box = element.getBoundingClientRect();
                    return { left: box.left, right: box.right, viewport: window.innerWidth,
                        scroll: element.scrollWidth, client: element.clientWidth };
                });
                assert.ok(overflow.left >= -1 && overflow.right <= width + 1 && overflow.scroll <= overflow.client + 1,
                    `manual workspace fits viewport: ${JSON.stringify(overflow)}`);
            }
        }
        assert.deepEqual(errors, [], 'actual finance page has no uncaught browser errors');
        console.log('Finance actual-app: two tills, kopecks, inline category, lost-response replay after reload, split receipts, transfer, refund, close/reopen and four responsive screenshots PASS');
    } finally {
        await browser?.close();
        await pool.end();
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
