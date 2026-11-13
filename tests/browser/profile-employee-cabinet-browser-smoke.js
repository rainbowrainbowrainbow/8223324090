'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const evidence = path.join(root, 'output', 'profile-proof');
const origin = 'http://profile-fixture.test';

function salary(month, gross) {
    const march = month === '2024-03';
    return { month, gross, state: 'ready', status: 'approved', deductions: 100, paid: 500,
        balance: gross - 600, detail: { physicalHours: 10, additionalRoleHours: 2,
            lines: [{ label: 'Оплата за одиницю', kind: 'piece', quantity: 3, rate: 200, amount: 600 }], rates: [
            { profession: 'host', rate: 200, amount: 400, date: month + '-08', unit: 'hour', kind: 'additional' }
        ] }, adjustments: [{ date: month + '-08', type: 'penalty', amount: 100, reason: 'Запізнення', status: 'applied' }],
        late: [{ date: month + '-08', minutes: 12, planned: '10:00', actual: month + '-08T08:12:00Z',
            adjustments: [{ amount: 100, status: 'applied' }] }],
        installments: [{ kind: 'advance', status: 'paid', approved: 500, scheduled: month + '-15',
            movements: [{ kind: 'payment', date: month + (march ? '-15' : '-16'), amount: 500 }] }] };
}

function results(month) {
    const period = { attendance: { daysRecorded: 2, measuredArrivals: 2, onTime: 1, present: 2,
        absent: 0, late: 1, lateMinutes: 12 }, tasks: { completed: 3, overdue: 1 },
        checklistCompleted: 2, coursesCompleted: [], ratings: [{ score: 4, date: month + '-08', explanation: 'Тестова оцінка' }] };
    const previous = new Date(month + '-01T00:00:00Z');
    previous.setUTCDate(0);
    return { month, state: 'ready', current: { ...period, month }, previous: { ...period, month: previous.toISOString().slice(0, 7) } };
}

async function main() {
    const { chromium } = require('playwright');
    fs.mkdirSync(evidence, { recursive: true });
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.PROFILE_BROWSER_PATH ? { executablePath: process.env.PROFILE_BROWSER_PATH } : {})
    });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.setDefaultTimeout(7000);
        page.on('pageerror', error => console.error(error));
        const requests = [];
        const pending = [];
        let hold = true;
        let failedOnce = false;
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (url.pathname === '/profile') {
                const html = fs.readFileSync(path.join(root, 'profile.html'), 'utf8')
                    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
                return route.fulfill({ contentType: 'text/html', body: html });
            }
            if (url.pathname.startsWith('/api/auth/profile/me/')) {
                const month = url.searchParams.get('month');
                requests.push(url.pathname + '?' + month);
                const isSalary = url.pathname.endsWith('/salary');
                if (isSalary && month === '2024-02' && hold) {
                    await new Promise(resolve => pending.push(resolve));
                }
                if (isSalary && month === '2024-04' && !failedOnce) {
                    failedOnce = true;
                    return route.fulfill({ status: 503, json: {} });
                }
                return route.fulfill({ json: isSalary ? salary(month, month === '2024-02' ? 2100 : 3450) : results(month) });
            }
            const relative = url.pathname.slice(1);
            if (!/^(css|images|fonts)\//.test(relative)) return route.abort();
            const file = path.join(root, relative);
            return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.abort();
        });
        async function open(url, own = true) {
            await page.goto(origin + url);
            await page.addScriptTag({ path: path.join(root, 'js/profile-page.js') });
            await page.evaluate(ownProfile => {
                document.body.classList.add('shell-ready');
                document.getElementById('mainApp')?.classList.remove('hidden');
                document.getElementById('loginScreen')?.classList.add('hidden');
                window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
                    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
                window.getAuthHeaders = () => ({});
                window.handleAuthError = () => false;
                isOwnProfile = ownProfile;
                profileData = { user: { name: 'Тестовий працівник', username: 'fixture', role: 'admin' },
                    staffProfile: { role_type: 'animator', secondary_professions: ['host'] },
                    professionCatalog: [
                        { key: 'animator', title: 'Аніматор', checklist: ['Підготувати реквізит'] },
                        { key: 'host', title: 'Ведучий', checklist: [] }
                    ], myTasks: [{ id: 1, title: 'Загальна задача', category: 'checklist' }] };
                const query = new URLSearchParams(location.search);
                activeTab = ownProfile ? query.get('tab') || 'professions' : 'professions';
                window.addEventListener('popstate', () => switchTab(new URLSearchParams(location.search).get('tab') || 'professions', { skipUrl: true }));
                renderProfile();
                if (ownProfile && Object.hasOwn(PROFILE_EMPLOYEE_TABS, activeTab)) void loadProfileEmployeeMonth(activeTab);
            }, own);
        }
        await open('/profile?month=2024-02');
        const selected = page.locator('.profile-profession-switch[data-profile-profession="host"]');
        await selected.focus();
        await selected.press('Enter');
        await page.locator('.profile-profession-switch[data-profile-profession="host"][aria-pressed="true"]').waitFor();
        assert.equal(await selected.getAttribute('aria-pressed'), 'true');
        assert.equal(await selected.evaluate(node => node === document.activeElement), true);
        assert.equal(await page.locator('.profile-profession-roster .is-primary').count(), 1);
        assert.match(await page.locator('.profile-profession-checklist-panel').innerText(), /ще не доданий/);
        assert.equal(await page.getByText('Редагувати в HR', { exact: true }).count(), 0);
        await page.locator('#tabContent').screenshot({ path: path.join(evidence, 'professions-mobile.png') });
        await page.getByRole('button', { name: 'Зарплата', exact: true }).click();
        await page.getByText('Завантаження…', { exact: true }).waitFor();
        const month = page.locator('#profileEmployeeMonthInput');
        await month.fill('2024-03');
        await page.getByText(/3\s450/).waitFor();
        await page.getByText(/Оплата за одиницю · 3 од\..*за роботу/).waitFor();
        const olderResponse = page.waitForResponse(response => response.url().includes('/salary?month=2024-02'));
        hold = false;
        pending.splice(0).forEach(resolve => resolve());
        await (await olderResponse).finished();
        assert.equal(await page.getByText(/2\s100/).count(), 0);
        await page.locator('#tabContent').screenshot({ path: path.join(evidence, 'salary-mobile.png') });
        await month.fill('2024-04');
        await page.getByRole('alert').waitFor();
        await page.getByRole('button', { name: 'Спробувати ще раз' }).click();
        await page.getByText(/3\s450/).waitFor();
        await page.goBack();
        await page.waitForFunction(() => document.querySelector('#profileEmployeeMonthInput')?.value === '2024-03');
        await page.goForward();
        await page.waitForFunction(() => document.querySelector('#profileEmployeeMonthInput')?.value === '2024-04');
        await page.getByRole('button', { name: 'Мої результати', exact: true }).click();
        await page.getByText('1 із 2', { exact: true }).first().waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.locator('#tabContent').screenshot({ path: path.join(evidence, 'results-mobile.png') });
        await open('/profile?tab=salary&month=2024-03');
        await page.getByText(/3\s450/).waitFor();
        const requestCount = requests.length;
        await open('/profile?id=77&tab=salary', false);
        assert.equal(await page.getByRole('button', { name: 'Зарплата', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Мої результати', exact: true }).count(), 0);
        assert.equal(requests.length, requestCount);
        console.log('Employee profile mobile browser checks passed.');
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
