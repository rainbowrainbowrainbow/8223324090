'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../../package.json');

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
    const previousMonth = previous.toISOString().slice(0, 7);
    const last = new Date(month + '-01T00:00:00Z');
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    return { month, state: 'ready',
        current: { ...period, month, from: month + '-01', through: last.toISOString().slice(0, 10) },
        previous: { ...period, month: previousMonth, from: previousMonth + '-01', through: previous.toISOString().slice(0, 10) },
        dailyTasks: { overdue: 1, days: Array.from({ length: 7 }, (_, index) => ({
            date: `${month}-0${index + 1}`, work: index % 3, personal: index % 2
        })) },
        substitutions: month === '2024-04' ? [
            { id:'91', date:'2024-04-08', role:'replacement', state:'active', partial:true, professionKey:'animator', simultaneousProfessionKeys:['host'] },
            { id:'89', date:'2024-04-01', role:'original', state:'cancelled', partial:false, professionKey:'host' }
        ] : []
    };
}

async function main() {
    const { chromium } = require('./timeline-room-summary-browser-smoke').requirePlaywright();
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
        const employeeRendererVersions = [];
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
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
            if (url.pathname === '/api/auth/telegram-crm') {
                return route.fulfill({ json: { success: true, status: 'disconnected', pilotEnabled: true, mode: 'on' } });
            }
            if (url.pathname === '/api/auth/security') return route.fulfill({ json: { success: true } });
            if (url.pathname === '/api/training/knowledge-base') {
                const title = url.searchParams.get('role') === 'manager' ? 'Гайд арт-директора' : 'Гайд ведучого';
                return route.fulfill({ json: { articles: [{ id: 7, title, summary: 'Тестовий навчальний матеріал' }] } });
            }
            if (url.pathname === '/api/training/materials') return route.fulfill({ json: { materials: [] } });
            const relative = url.pathname.slice(1);
            if (relative === 'js/profile-employee-views.js') employeeRendererVersions.push(url.searchParams.get('v'));
            if (!/^(css|images|fonts)\//.test(relative) && !['js/profile-page.js', 'js/profile-employee-views.js'].includes(relative)) return route.abort();
            const file = path.join(root, relative);
            return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.abort();
        });
        async function open(url, own = true) {
            await page.goto(origin + url);
            await page.addScriptTag({ path: path.join(root, 'js/telegram-crm-profile.js') });
            await page.addScriptTag({ url: `${origin}/js/profile-page.js?v=${version}` });
            await page.evaluate(ownProfile => {
                document.body.classList.add('shell-ready');
                document.getElementById('mainApp')?.classList.remove('hidden');
                document.getElementById('loginScreen')?.classList.add('hidden');
                window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
                    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
                window.getAuthHeaders = () => ({});
                window.handleAuthError = () => false;
                window.apiGet = async path => (await fetch(`/api${path}`)).json();
                window.AppState = { currentUser: { id: 77 } };
                isOwnProfile = ownProfile;
                profileData = { user: { name: 'Тестовий працівник', username: 'fixture', role: 'admin' },
                    staffProfile: { role_type: 'art_director', secondary_professions: ['host', 'art_director', 'host'] },
                    professionCatalog: [
                        { key: 'art_director', title: 'Арт-директор', department: 'Креатив', checklist: ['Перевірити дизайни'] },
                        { key: 'host', title: 'Ведучий', checklist: [] }
                    ], myTasks: [{ id: 1, title: 'Загальна задача', category: 'checklist' }] };
                const query = new URLSearchParams(location.search);
                activeTab = ownProfile ? normalizeProfileTab(query.get('tab')) || 'workbase' : 'professions';
                window.addEventListener('popstate', () => switchTab(new URLSearchParams(location.search).get('tab') || 'workbase', { skipUrl: true }));
                renderProfile();
                if (ownProfile && activeTab === 'workbase') {
                    void loadProfileWorkMaterials();
                    focusProfileWorkBaseSection();
                }
                if (ownProfile && Object.hasOwn(PROFILE_EMPLOYEE_TABS, activeTab)) void loadProfileEmployeeMonth(activeTab);
            }, own);
        }
        await open('/profile?month=2024-02');
        const profileNav = page.locator('.profile-park-nav .profile-primary-tab');
        assert.deepEqual(await profileNav.evaluateAll(tabs => tabs.map(tab => tab.dataset.profileTab)),
            ['myday', 'control', 'results', 'salary', 'workbase', 'settings']);
        assert.equal(await page.locator('.profile-park-nav').getByText(/^(Ще|Скоро)$/).count(), 0);
        assert.equal(await page.getByText('Арт-директор', { exact: true }).count(), 1);
        assert.equal(await page.locator('[data-profile-profession="art_director"]').innerText(), 'Арт-директор\nКреатив\nОсновна');
        await page.getByText('Перевірити дизайни', { exact: true }).waitFor();
        assert.equal(await page.locator('#work-base-checklists').getByText('Загальна задача', { exact: true }).count(), 0);
        await page.getByText('Гайд арт-директора', { exact: true }).waitFor();
        await page.locator('#tabContent').screenshot({ path: path.join(evidence, 'work-base-mobile.png') });
        const selected = page.locator('.profile-work-base-profession[data-profile-profession="host"]');
        await selected.focus();
        await selected.press('Enter');
        await page.locator('.profile-work-base-profession[data-profile-profession="host"][aria-pressed="true"]').waitFor();
        assert.equal(await selected.getAttribute('aria-pressed'), 'true');
        assert.equal(await selected.evaluate(node => node === document.activeElement), true);
        await page.getByText('Гайд ведучого', { exact: true }).waitFor();
        assert.match(await page.locator('#work-base-checklists').innerText(), /ще не доданий/);
        assert.equal(await page.getByText('Редагувати в HR', { exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Зарплата', exact: true }).click();
        await page.getByText('Завантаження…', { exact: true }).waitFor();
        const month = page.getByLabel('Місяць', { exact: true });
        await month.selectOption('03');
        await page.getByText(/3\s450/).waitFor();
        const breakdown = page.locator('details.park-employee-disclosure').filter({ has: page.locator('summary', { hasText: 'Розрахунок' }) });
        assert.equal(await breakdown.getAttribute('open'), null);
        await breakdown.locator('summary').click();
        await page.getByText(/Оплата за одиницю · 3 од\..*за роботу/).waitFor();
        for (const label of ['Ставки за професіями', 'Премії та утримання за записами HR', 'Запізнення', 'Аванси й виплати']) {
            await page.locator('summary').filter({ hasText: label }).click();
        }
        for (const amount of [/3\s450/, /100,00/, /500,00/, /2\s850/]) {
            await page.locator('.profile-employee-summary').getByText(amount).first().waitFor();
        }
        const olderResponse = page.waitForResponse(response => response.url().includes('/salary?month=2024-02'));
        hold = false;
        pending.splice(0).forEach(resolve => resolve());
        await (await olderResponse).finished();
        assert.equal(await page.getByText(/2\s100/).count(), 0);
        await page.locator('#tabContent').screenshot({ path: path.join(evidence, 'salary-mobile.png') });
        await month.selectOption('04');
        await page.getByRole('alert').waitFor();
        await page.getByRole('button', { name: 'Спробувати ще раз' }).click();
        await page.getByText(/3\s450/).waitFor();
        await page.goBack();
        await page.waitForFunction(() => document.querySelector('#profileEmployeeMonthSelect')?.value === '03');
        await page.goForward();
        await page.waitForFunction(() => document.querySelector('#profileEmployeeMonthSelect')?.value === '04');
        await page.getByRole('button', { name: 'Мої результати', exact: true }).click();
        const comparison = page.locator('.profile-employee-comparison');
        await comparison.locator('summary').click();
        await page.getByText('1 із 2', { exact: true }).first().waitFor();
        assert.match(await comparison.locator('thead').innerText(), /01\.04\.24/);
        const substitutions = page.locator('.profile-employee-details').filter({ has: page.getByRole('heading', {name:'Мої підміни'}) });
        assert.match(await substitutions.innerText(), /Часткова підміна №91 · Аніматор · суміщення — Ведучий\s+Погоджено/);
        assert.match(await substitutions.innerText(), /Роботу передано №89 · Ведучий\s+Скасовано/);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await substitutions.screenshot({ path: path.join(evidence, 'substitutions-mobile.png') });
        await page.locator('#tabContent').screenshot({ path: path.join(evidence, 'results-mobile.png') });
        await month.selectOption('03');
        await substitutions.getByText('За цей місяць підмін немає.', { exact: true }).waitFor();
        assert.equal(await substitutions.locator('li').count(), 0);
        await page.setViewportSize({width:320,height:790});
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.locator('#tabContent').screenshot({ path: path.join(evidence, 'results-320.png') });
        await page.getByRole('button', { name: 'Мій день', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/profile' && url.searchParams.get('tab') === 'myday');
        await open('/profile?tab=workbase#work-base-checklists');
        await page.waitForFunction(() => document.activeElement?.id === 'work-base-checklists');
        await page.getByRole('button', { name: 'Налаштування', exact: true }).click();
        await page.getByRole('heading', { name: 'Telegram', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Підключити Telegram', exact: true }).waitFor();
        await page.getByText('Логін для входу', { exact: true }).waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(evidence, 'settings-mobile.png'), timeout: 30000 });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.evaluate(() => document.body.classList.add('dark-mode'));
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(evidence, 'settings-desktop-dark.png'), timeout: 30000 });
        for (const [tab, target, file] of [
            ['Робоча база', '#workBaseProfessionsTitle', 'work-base'],
            ['Мої результати', '.profile-results-highlights', 'results'],
            ['Зарплата', '.profile-pay-summary', 'salary']
        ]) {
            await page.getByRole('button', { name: tab, exact: true }).click();
            await page.locator(target).waitFor();
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: path.join(evidence, `${file}-desktop-dark.png`), timeout: 30000 });
        }
        await page.setViewportSize({ width: 320, height: 790 });
        await open('/profile?tab=salary&month=2024-03');
        await page.getByText(/3\s450/).waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const requestCount = requests.length;
        await open('/profile?id=77&tab=salary', false);
        assert.equal(await page.getByRole('button', { name: 'Зарплата', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Мої результати', exact: true }).count(), 0);
        assert.equal(requests.length, requestCount);
        assert.ok(employeeRendererVersions.length > 0);
        assert.ok(employeeRendererVersions.every(requestedVersion => requestedVersion === version));
        assert.deepEqual(errors, []);
        console.log('Profile browser checks passed: Work Base, deep links, settings, results, salary and access.');
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
