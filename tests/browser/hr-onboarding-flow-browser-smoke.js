'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function requirePlaywright() {
    try { return require('playwright'); } catch {}
    for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
        const normalized = entry.replace(/[\\/]+$/, '');
        if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
        const packageDir = path.join(path.dirname(normalized), 'playwright');
        if (fs.existsSync(packageDir)) return require(packageDir);
    }
    throw new Error('Playwright is unavailable; run through npm run test:browser:hr-onboarding');
}

function contentType(file) {
    if (file.endsWith('.html')) return 'text/html; charset=utf-8';
    if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (file.endsWith('.css')) return 'text/css; charset=utf-8';
    if (file.endsWith('.svg')) return 'image/svg+xml';
    if (file.endsWith('.png')) return 'image/png';
    return 'application/octet-stream';
}

async function createStaticServer() {
    const server = http.createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (pathname.startsWith('/api/')) {
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ success: true, data: [] }));
            return;
        }
        const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const file = path.resolve(ROOT, relative);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.writeHead(404).end('Not found');
            return;
        }
        res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function json(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installApi(page, state) {
    await page.route('https://www.clarity.ms/**', route => route.abort());
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const pathname = url.pathname;
        const method = request.method();
        const body = request.postDataJSON?.() || {};
        state.requests.push(`${method} ${pathname}`);

        if (pathname === '/api/auth/verify') return json(route, { success: true, user: state.user });
        if (pathname.includes('/api/auth/action-permissions')) return json(route, { success: true, data: {} });
        if (pathname.includes('/api/settings/business-operating-profile')) return json(route, { success: true, data: {} });
        if (pathname === '/api/hr/vacancy-platforms') return json(route, { success: true, templates: [] });
        if (pathname === '/api/hr/vacancies' && method === 'GET') return json(route, { success: true, vacancies: state.vacancies });
        if (pathname === '/api/hr/vacancies/91/applications' && method === 'GET') return json(route, { success: true, applications: state.applications });
        if (pathname === '/api/hr/staff' || pathname === '/api/staff') {
            return json(route, {
                success: true,
                data: state.staff,
                departments: [{ key: 'all', title: 'Всі' }, { key: 'animators', title: 'Аніматори' }],
                displayGroups: [{ key: 'all', title: 'Всі', professionKeys: [] }, { key: 'animators', title: 'Аніматори', professionKeys: ['animator', 'barista', 'cook'] }]
            });
        }
        if (pathname === '/api/hr/onboarding/responsible-candidates') return json(route, { success: true, data: state.owners });
        if (pathname === '/api/hr/applications/501/hire' && method === 'POST') {
            state.hirePayloads.push(body);
            state.applications[0] = { ...state.applications[0], status: 'hired', staff_id: 1, profession_key: 'cook' };
            state.staff[0].secondary_professions = ['barista', 'cook'];
            state.processes.push({
                id: 104, staff_id: 1, staff_name: 'Browser QA Worker', profession_key: 'cook', profession_title: 'Кухар',
                is_primary: false, responsible_user_id: 12, responsible_name: 'Cook Mentor', status: 'in_progress',
                training_status: 'in_progress', admission_status: 'pending', internship_status: 'in_progress', total_items: 1,
                completed_items: 0, items: [{ id: 1, key: 'item_1', checklist_key: 'item_1', title: 'Кухонна практика', done: false }]
            });
            state.vacancies[0] = { ...state.vacancies[0], hired_count: 2, status: 'filled' };
            return json(route, { success: true, staff_id: 1, profession_key: 'cook', vacancy_status: 'filled', vacancy_action: 'auto_filled_by_headcount', hired_count: 2, target_hires: 2, message: 'Професію додано' });
        }
        if (pathname === '/api/hr/onboarding' && method === 'GET') return json(route, { success: true, data: state.processes });
        if (pathname === '/api/hr/staff/1/profession-checklist' && method === 'PUT') {
            state.checklistPayloads.push(body);
            const process = state.processes.find(row => row.profession_key === body.profession_key);
            if (process) {
                process.completed_items = body.completed ? 1 : 0;
                process.items[0].done = Boolean(body.completed);
            }
            return json(route, { success: true, data: body });
        }
        if (pathname === '/api/hr/professions') return json(route, { success: true, data: state.professions });
        if (pathname === '/api/staff/schedule' && method === 'GET') return json(route, { success: true, data: state.schedule });
        if (pathname === '/api/staff/attendance') return json(route, { success: true, data: [] });
        if (pathname.startsWith('/api/bookings/')) return json(route, []);
        if (pathname === '/api/training/overview-stats') return json(route, { success: true, data: {} });
        if (pathname === '/api/training/knowledge-base' || pathname === '/api/training/tests-list') return json(route, { success: true, data: [] });
        if (pathname === '/api/training/progress' || pathname === '/api/training/leaderboard') return json(route, { success: true, data: [] });
        return json(route, { success: true, data: [] });
    });
}

async function seedAuth(page) {
    await page.addInitScript(user => {
        localStorage.setItem('pzp_token', 'browser-smoke-token');
        localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_staff_schedule_expanded_groups', JSON.stringify(['animators']));
    }, { id: 1, username: 'browser.creator', name: 'Browser Creator', role: 'creator' });
}

async function run() {
    const { chromium } = requirePlaywright();
    const { server, baseUrl } = await createStaticServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        serviceWorkers: 'block'
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error' || message.type() === 'warning') pageErrors.push(`${message.type()}: ${message.text()}`);
    });
    const state = {
        user: { id: 1, username: 'browser.creator', name: 'Browser Creator', role: 'creator' },
        owners: [{ id: 12, username: 'cook.mentor', name: 'Cook Mentor', label: 'Cook Mentor', role: 'manager' }],
        professions: [
            { key: 'animator', title: 'Аніматор', is_active: true, checklist: ['Основи анімації'] },
            { key: 'barista', title: 'Бариста', is_active: true, checklist: ['Кавова практика'] },
            { key: 'cook', title: 'Кухар', is_active: true, checklist: ['Кухонна практика'] }
        ],
        staff: [{ id: 1, name: 'Browser QA Worker', department: 'animators', role_type: 'animator', secondary_professions: ['barista'], is_active: true }],
        vacancies: [{ id: 91, title: 'Кухар у команду', role_type: 'cook', department: 'kitchen', status: 'open', priority: 'normal', target_hires: 2, hired_count: 1, active_candidates: 1 }],
        applications: [{ id: 501, vacancy_id: 91, name: 'Browser Candidate', status: 'offer', vacancy_role_type: 'cook', vacancy_title: 'Кухар у команду', vacancy_department: 'kitchen', vacancy_target_hires: 2 }],
        processes: [
            { id: 101, staff_id: 1, staff_name: 'Browser QA Worker', profession_key: null, responsible_name: 'HR Lead', status: 'in_progress', training_status: 'not_started', generated_task_count: 4, active_task_count: 4, total_items: 1, completed_items: 0, items: [{ id: 1, title: 'Корпоративні правила', done: false }] },
            { id: 102, staff_id: 1, staff_name: 'Browser QA Worker', profession_key: 'animator', profession_title: 'Аніматор', is_primary: true, responsible_name: 'Animator Mentor', status: 'completed', admission_status: 'approved', internship_status: 'completed', total_items: 1, completed_items: 1, items: [{ id: 1, checklist_key: 'item_1', title: 'Основи анімації', done: true }] },
            { id: 103, staff_id: 1, staff_name: 'Browser QA Worker', profession_key: 'barista', profession_title: 'Бариста', is_primary: false, responsible_name: 'Barista Mentor', status: 'in_progress', admission_status: 'pending', internship_status: 'in_progress', total_items: 1, completed_items: 0, items: [{ id: 1, checklist_key: 'item_1', title: 'Кавова практика', done: false }] }
        ],
        schedule: [{ id: 701, staff_id: 1, date: '2026-07-14', shift_start: '09:00', shift_end: '18:00', status: 'working', profession_key: 'cook', segments: [{ professionKey: 'cook', shiftStart: '09:00', shiftEnd: '13:00', additionalProfessionKeys: ['barista'] }, { professionKey: 'barista', shiftStart: '13:00', shiftEnd: '18:00', additionalProfessionKeys: [] }] }],
        hirePayloads: [],
        checklistPayloads: []
        ,requests: []
    };

    try {
        await installApi(page, state);
        await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        assert.equal(
            state.requests.filter(item => item.includes('/api/settings/timeline-visibility')).length,
            0,
            'unauthenticated timeline does not poll protected visibility settings'
        );
        await seedAuth(page);

        await page.goto(`${baseUrl}/hr.html#vacancies`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(async fixtures => {
            const nativeFetch = window.fetch.bind(window);
            window.__hrVacancies = fixtures.vacancies;
            window.__hrApplications = fixtures.applications;
            window.__hirePayloads = [];
            window.fetch = async (input, options = {}) => {
                const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
                const method = String(options.method || 'GET').toUpperCase();
                const response = payload => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
                if (url.pathname === '/api/hr/vacancy-platforms') return response({ success: true, templates: [] });
                if (url.pathname === '/api/hr/vacancies' && method === 'GET') return response({ success: true, vacancies: window.__hrVacancies });
                if (url.pathname === '/api/hr/vacancies/91/applications' && method === 'GET') return response({ success: true, applications: window.__hrApplications });
                if ((url.pathname === '/api/hr/staff' || url.pathname === '/api/staff') && method === 'GET') return response({ success: true, data: fixtures.staff });
                if (url.pathname === '/api/hr/onboarding/responsible-candidates') return response({ success: true, data: fixtures.owners });
                if (url.pathname === '/api/hr/applications/501/hire' && method === 'POST') {
                    const body = JSON.parse(options.body || '{}');
                    window.__hirePayloads.push(body);
                    window.__hrApplications[0] = { ...window.__hrApplications[0], status: 'hired', staff_id: 1, profession_key: 'cook' };
                    window.__hrVacancies[0] = { ...window.__hrVacancies[0], status: 'filled', hired_count: 2 };
                    return response({ success: true, staff_id: 1, profession_key: 'cook', vacancy_status: 'filled', vacancy_action: 'auto_filled_by_headcount', hired_count: 2, target_hires: 2, message: 'Професію додано' });
                }
                return nativeFetch(input, options);
            };
            await window.loadVacancies();
        }, { vacancies: state.vacancies, applications: state.applications, staff: state.staff, owners: state.owners });
        await page.locator('#vacanciesList').getByText('Найнято 1 із 2').waitFor();
        await page.locator('.hr-vacancy-card').click();
        await page.locator('#candidatesKanban').getByText('Browser Candidate', { exact: true }).waitFor();
        await page.evaluate(() => {
            window.formModal = async () => ({ hireMode: 'existing_staff', existingStaffId: '1', startOnboarding: 'yes', responsibleUserId: '12' });
        });
        await page.locator('.kanban-card').getByRole('button', { name: 'Найняти' }).click();
        await page.waitForFunction(() => document.querySelector('#vacanciesList')?.textContent?.includes('Найнято 2 із 2'));
        const browserHirePayloads = await page.evaluate(() => window.__hirePayloads);
        assert.equal(browserHirePayloads.length, 1);
        assert.equal(browserHirePayloads[0].hire_mode, 'existing_staff');
        assert.equal(browserHirePayloads[0].existing_staff_id, 1);
        assert.equal('vacancy_action' in browserHirePayloads[0], false, 'headcount vacancy does not ask for manual close');
        state.staff[0].secondary_professions = ['barista', 'cook'];
        state.processes.push({
            id: 104, staff_id: 1, staff_name: 'Browser QA Worker', profession_key: 'cook', profession_title: 'Кухар',
            is_primary: false, responsible_user_id: 12, responsible_name: 'Cook Mentor', status: 'in_progress',
            training_status: 'in_progress', admission_status: 'pending', internship_status: 'in_progress', total_items: 1,
            completed_items: 0, items: [{ id: 1, key: 'item_1', checklist_key: 'item_1', title: 'Кухонна практика', done: false }]
        });

        await page.goto(`${baseUrl}/training.html`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-tab="onboarding"]').click();
        await page.locator('#trainingOnboardingList .training-onboarding-card').nth(3).waitFor();
        assert.equal(await page.locator('#trainingOnboardingList .training-onboarding-card').count(), 4);
        const corporateCard = page.locator('.training-onboarding-card').filter({ hasText: 'Корпоративні правила' });
        await corporateCard.getByText('у процесі', { exact: true }).waitFor();
        assert.equal(await corporateCard.getByText('не стартував', { exact: true }).count(), 0);
        await page.getByText('Кухар', { exact: true }).waitFor();
        const cookCard = page.locator('.training-onboarding-card').filter({ hasText: 'Кухар' });
        const checklistUpdated = page.waitForResponse(response => response.url().includes('/api/hr/staff/1/profession-checklist') && response.request().method() === 'PUT');
        await cookCard.locator('[data-onboarding-check]').check();
        await checklistUpdated;
        await page.waitForFunction(() => document.querySelector('.training-onboarding-card:last-child input')?.checked === true);
        assert.equal(state.checklistPayloads.at(-1)?.profession_key, 'cook');
        assert.equal(state.processes.find(row => row.profession_key === 'barista').completed_items, 0, 'barista readiness stays unchanged');

        await page.goto(`${baseUrl}/staff.html`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.body.textContent.includes('Browser QA Worker'));
        const scheduleText = await page.locator('#staffScheduleShell').innerText();
        assert.match(scheduleText, /Кухар|cook/i);
        assert.match(scheduleText, /Бариста|barista/i);

        console.log('HR onboarding cross-surface browser smoke passed');
    } catch (error) {
        const diagnostics = await page.evaluate(() => ({
            url: location.href,
            hash: location.hash,
            bodyClass: document.body.className,
            vacanciesText: document.querySelector('#vacanciesList')?.textContent || '',
            scheduleText: document.querySelector('#staffScheduleShell')?.textContent?.slice(0, 3000) || '',
            mainText: document.querySelector('main')?.textContent?.slice(0, 1000) || ''
        })).catch(() => ({}));
        console.error('Browser diagnostics:', JSON.stringify({ ...diagnostics, pageErrors, requests: state.requests.slice(-80) }));
        error.message += `\nBrowser diagnostics: ${JSON.stringify({ ...diagnostics, pageErrors })}`;
        throw error;
    } finally {
        await browser.close().catch(() => {});
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
});
