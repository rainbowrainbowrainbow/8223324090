#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET_URL = String(process.env.TEST_URL || '').trim();
const ENABLED = process.env.RUN_HR_ONBOARDING_FULLSTACK_BROWSER === 'true';
const HEADLESS = process.env.HR_ONBOARDING_FULLSTACK_HEADLESS !== 'false';
const TIMEOUT_MS = Number(process.env.HR_ONBOARDING_FULLSTACK_TIMEOUT_MS) || 30_000;
const RUN_ID = `hr-fullstack-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

function requireIsolatedTarget() {
    assert.equal(ENABLED, true, 'set RUN_HR_ONBOARDING_FULLSTACK_BROWSER=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(TARGET_URL, 'TEST_URL is required');
    assertSafeIsolatedTestUrl(TARGET_URL);
    assert.ok(process.env.TEST_USER, 'TEST_USER is required');
    assert.ok(process.env.TEST_PASS, 'TEST_PASS is required');
}

function requirePlaywright() {
    try { return require('playwright'); } catch {}
    for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
        const normalized = entry.replace(/[\\/]+$/, '');
        if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
        const packageDir = path.join(path.dirname(normalized), 'playwright');
        if (fs.existsSync(packageDir)) return require(packageDir);
    }
    throw new Error('Playwright is unavailable; run through npm run test:browser:hr-onboarding:fullstack:isolated');
}

function parseBody(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
}

async function api(base, routePath, options = {}) {
    const response = await fetch(new URL(routePath, base), {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const body = parseBody(await response.text());
    if (!response.ok) {
        const detail = body?.error || body?.message || body?.code || (typeof body === 'string' ? body : '') || `HTTP ${response.status}`;
        throw new Error(`${options.method || 'GET'} ${routePath} returned ${response.status}: ${detail}`);
    }
    return body;
}

async function login(base, username, password) {
    const body = await api(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const token = body.accessToken || body.token;
    assert.ok(token, '/api/auth/login returns an access token');
    return {
        token,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user: body.user
    };
}

async function createHrSession(base) {
    const bootstrap = await login(base, process.env.TEST_USER, process.env.TEST_PASS);
    const createLinkedAccount = async ({ role, label }) => {
        const staff = await api(base, '/api/staff', {
            method: 'POST',
            token: bootstrap.token,
            body: {
                name: `${label} ${RUN_ID}`,
                department: 'qa',
                position: label,
                role_type: role
            }
        });
        assert.ok(Number(staff?.data?.id) > 0, `${label} staff profile is created`);
        const username = `${role}.e2e.${Date.now()}.${crypto.randomBytes(2).toString('hex')}`.slice(0, 50);
        const password = `Qa-${crypto.randomBytes(18).toString('base64url')}!`;
        const created = await api(base, '/api/users', {
            method: 'POST',
            token: bootstrap.token,
            body: {
                username,
                password,
                name: `${label} ${RUN_ID}`,
                role,
                staffId: Number(staff.data.id)
            }
        });
        assert.ok(Number(created?.user?.id) > 0, `isolated ${role} user is created`);
        return { username, password, userId: Number(created.user.id) };
    };

    const hrAccount = await createLinkedAccount({ role: 'hr', label: 'HR Fullstack' });
    const ownerAccount = await createLinkedAccount({ role: 'manager', label: 'Onboarding Owner' });
    const session = await login(base, hrAccount.username, hrAccount.password);
    assert.equal(session.user?.role, 'hr');
    return { ...session, userId: hrAccount.userId, responsibleUserId: ownerAccount.userId };
}

function matchesApiResponse(response, method, pathname) {
    const url = new URL(response.url());
    return url.pathname === pathname && response.request().method() === method;
}

async function responseJson(response, label) {
    const text = await response.text();
    const body = parseBody(text);
    assert.equal(response.ok(), true, `${label}: HTTP ${response.status()} ${body?.error || body?.message || text || ''}`);
    return body;
}

async function waitForApi(page, method, pathname) {
    return page.waitForResponse(response => matchesApiResponse(response, method, pathname), { timeout: TIMEOUT_MS });
}

async function waitForAppShell(page, options = {}) {
    await page.locator('#mainApp:not(.hidden)').waitFor();
    await page.waitForFunction(({ requireCrmApiFetch, requireHrFetch }) => {
        if (document.readyState === 'loading') return false;
        if (requireCrmApiFetch && typeof window.crmApiFetch !== 'function') return false;
        if (requireHrFetch && typeof window.hrFetch !== 'function') return false;
        return true;
    }, {
        requireCrmApiFetch: options.requireCrmApiFetch !== false,
        requireHrFetch: Boolean(options.requireHrFetch)
    });
}

async function reloadVacanciesWithStatus(page, status) {
    const responsePromise = waitForApi(page, 'GET', '/api/hr/vacancies');
    await page.evaluate(nextStatus => {
        const filter = document.getElementById('vacStatusFilter');
        if (filter) filter.value = nextStatus;
        return window.loadVacancies();
    }, status);
    return responseJson(await responsePromise, `load ${status} vacancies`);
}

async function fillFormModal(page, values) {
    const modal = page.locator('.form-modal-overlay').last();
    await modal.waitFor({ state: 'visible' });
    for (const [key, value] of Object.entries(values)) {
        const field = modal.locator(`#fm_${key}`);
        await field.waitFor({ state: 'attached' });
        const tag = await field.evaluate(element => element.tagName);
        if (tag === 'SELECT') await field.selectOption(String(value));
        else await field.fill(String(value));
    }
    return modal;
}

async function createVacancyThroughUi(page, fixture) {
    await page.locator('#btnAddVacancy').click();
    const modal = await fillFormModal(page, {
        title: fixture.title,
        role_type: fixture.professionKey,
        target_hires: fixture.targetHires,
        schedule: 'Disposable full-stack schedule'
    });
    await modal.locator('.confirm-ok').click();

    const priorityDialog = page.locator('.confirm-overlay:not(.form-modal-overlay)').filter({ hasText: 'Терміново?' }).last();
    await priorityDialog.waitFor({ state: 'visible' });
    const createResponsePromise = waitForApi(page, 'POST', '/api/hr/vacancies');
    await priorityDialog.locator('.confirm-cancel').click();
    const body = await responseJson(await createResponsePromise, `create ${fixture.professionKey} vacancy`);
    assert.equal(body?.vacancy?.title, fixture.title);
    assert.equal(Number(body?.vacancy?.target_hires), fixture.targetHires);
    await page.locator('#vacanciesList .hr-vacancy-card').filter({ hasText: fixture.title }).waitFor();
    return body.vacancy;
}

async function openVacancy(page, vacancy) {
    const card = page.locator('#vacanciesList .hr-vacancy-card').filter({ hasText: vacancy.title });
    const applicationsPromise = waitForApi(page, 'GET', `/api/hr/vacancies/${vacancy.id}/applications`);
    await card.locator('.vac-title').click();
    await responseJson(await applicationsPromise, `open vacancy ${vacancy.id}`);
    await page.locator('#candidatesSection').waitFor({ state: 'visible' });
}

async function createApplicationThroughUi(page, vacancy, fixture) {
    await openVacancy(page, vacancy);
    await page.locator('#btnAddCandidate').click();
    const modal = page.locator('#candidateIntakeModal');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('[name="name"]').fill(fixture.name);
    await modal.locator('[name="phone"]').fill(fixture.phone);
    await modal.locator('[name="experience"]').fill(`Disposable browser E2E ${RUN_ID}`);
    const createResponsePromise = waitForApi(page, 'POST', `/api/hr/vacancies/${vacancy.id}/applications`);
    await modal.locator('button[type="submit"]').click();
    const body = await responseJson(await createResponsePromise, `create application for vacancy ${vacancy.id}`);
    assert.ok(Number(body?.application?.id) > 0, 'application id is returned');
    await page.locator('#candidatesKanban .kanban-card').filter({ hasText: fixture.name }).waitFor();
    return body.application;
}

async function advanceApplicationToOffer(page, application, candidateName, vacancyId) {
    for (let step = 0; step < 3; step++) {
        const card = page.locator('#candidatesKanban .kanban-card').filter({ hasText: candidateName });
        const nextButton = card.getByRole('button').filter({ hasText: '→' }).first();
        await nextButton.waitFor({ state: 'visible' });
        const patchPromise = waitForApi(page, 'PATCH', `/api/hr/applications/${application.id}`);
        const refreshPromise = waitForApi(page, 'GET', `/api/hr/vacancies/${vacancyId}/applications`);
        await nextButton.click();
        await responseJson(await patchPromise, `advance application ${application.id}, step ${step + 1}`);
        await responseJson(await refreshPromise, `refresh application ${application.id}, step ${step + 1}`);
    }
    await page.locator('#candidatesKanban .kanban-card')
        .filter({ hasText: candidateName })
        .getByRole('button', { name: 'Найняти' })
        .waitFor({ state: 'visible' });
}

async function hireThroughUi(page, application, candidateName, options) {
    const card = page.locator('#candidatesKanban .kanban-card').filter({ hasText: candidateName });
    await card.getByRole('button', { name: 'Найняти' }).click();
    const values = {
        hireMode: options.mode,
        startOnboarding: 'yes',
        responsibleUserId: options.responsibleUserId
    };
    if (options.mode === 'existing_staff') values.existingStaffId = options.existingStaffId;
    else {
        values.department = 'animators';
        values.salary = '180';
    }
    const modal = await fillFormModal(page, values);
    const hireResponsePromise = waitForApi(page, 'POST', `/api/hr/applications/${application.id}/hire`);
    await modal.locator('.confirm-ok').click();
    return responseJson(await hireResponsePromise, `hire application ${application.id}`);
}

function findProcess(processes, staffId, professionKey) {
    return (processes || []).find(process => (
        Number(process.staff_id) === Number(staffId)
        && String(process.profession_key || '') === String(professionKey || '')
    ));
}

function localDate() {
    const now = new Date();
    return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
    ].join('-');
}

async function run() {
    requireIsolatedTarget();
    const base = new URL(TARGET_URL).origin;
    const { chromium } = requirePlaywright();
    const hrSession = await createHrSession(base);
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
    await context.addInitScript(session => {
        localStorage.setItem('pzp_token', session.token);
        localStorage.setItem('pzp_access_token', session.token);
        if (session.refreshToken) localStorage.setItem('pzp_refresh_token', session.refreshToken);
        if (session.refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(session.refreshExpiresAt));
        localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
        localStorage.setItem('pzp_staff_schedule_expanded_groups', JSON.stringify(['animators', 'cafe', 'kitchen']));
    }, hrSession);

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    await page.route('https://www.clarity.ms/**', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: ''
    }));
    await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 204, body: '' }));

    const diagnostics = {
        activeStep: 'bootstrap',
        apiTrace: [],
        apiFailures: [],
        requestFailures: [],
        consoleErrors: [],
        pageErrors: []
    };
    page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin !== base || !url.pathname.startsWith('/api/')) return;
        const item = `${response.request().method()} ${url.pathname}${url.search} ${response.status()}`;
        diagnostics.apiTrace.push(item);
        const expectedAccessBoundary = response.request().method() === 'GET'
            && url.pathname === '/api/dashboard/widgets/currency'
            && response.status() === 403;
        if (response.status() >= 400 && !expectedAccessBoundary) diagnostics.apiFailures.push(item);
    });
    const isExpectedShellNavigationAbort = (request, url) => {
        if (request.method() !== 'GET') return false;
        const errorText = request.failure()?.errorText || '';
        if (errorText !== 'net::ERR_ABORTED') return false;
        return url.origin === base && [
            '/api/dashboard/alerts',
            '/api/tasks/my-cabinet'
        ].includes(url.pathname);
    };
    page.on('requestfailed', request => {
        const url = new URL(request.url());
        if (isExpectedShellNavigationAbort(request, url)) return;
        if (url.origin === base || url.pathname.startsWith('/api/')) {
            diagnostics.requestFailures.push(`${request.method()} ${url.pathname}: ${request.failure()?.errorText || 'failed'}`);
        }
    });
    page.on('console', message => {
        if (message.type() !== 'error') return;
        const messageText = message.text();
        // The shared shell requests a creator-only currency widget. Its exact 403 is
        // asserted as an expected HR access boundary above; every other 4xx/5xx still fails.
        if (/^Failed to load resource: the server responded with a status of 403 \(Forbidden\)$/.test(messageText)) return;
        diagnostics.consoleErrors.push(messageText);
    });
    page.on('pageerror', error => diagnostics.pageErrors.push(error.message));

    const step = async (label, action) => {
        diagnostics.activeStep = label;
        process.stdout.write(`[hr-fullstack] ${label}\n`);
        return action();
    };

    const animatorVacancyTitle = `Animator ${RUN_ID}`;
    const baristaVacancyTitle = `Barista ${RUN_ID}`;
    const primaryCandidateName = `Primary ${RUN_ID}`;
    const secondaryCandidateName = `Secondary ${RUN_ID}`;
    let staffId = null;

    try {
        await step('open real HR vacancies UI', async () => {
            await page.goto(`${base}/hr.html#vacancies`, { waitUntil: 'domcontentloaded' });
            await waitForAppShell(page, { requireHrFetch: true });
            await page.locator('#btnAddVacancy').waitFor({ state: 'visible' });
        });

        const animatorVacancy = await step('create headcount=2 animator vacancy through UI', () => createVacancyThroughUi(page, {
            title: animatorVacancyTitle,
            professionKey: 'animator',
            targetHires: 2
        }));
        const animatorApplication = await step('create animator application through UI', () => createApplicationThroughUi(page, animatorVacancy, {
            name: primaryCandidateName,
            phone: '+380501230001'
        }));
        await step('move animator application to offer through UI', () => advanceApplicationToOffer(
            page,
            animatorApplication,
            primaryCandidateName,
            animatorVacancy.id
        ));
        const firstHire = await step('hire new employee and start animator onboarding through UI', () => hireThroughUi(
            page,
            animatorApplication,
            primaryCandidateName,
            { mode: 'new_staff', responsibleUserId: hrSession.responsibleUserId }
        ));
        staffId = Number(firstHire.staff_id);
        assert.ok(staffId > 0, 'new hire returns durable staff id');
        assert.equal(firstHire.vacancy_action, 'kept_open_by_headcount');
        assert.equal(firstHire.vacancy_status, 'open');
        assert.equal(Number(firstHire.hired_count), 1);
        assert.equal(Number(firstHire.target_hires), 2);
        await page.locator('#vacanciesList .hr-vacancy-card')
            .filter({ hasText: animatorVacancyTitle })
            .getByText('Найнято 1 із 2')
            .waitFor();

        const baristaVacancy = await step('create headcount=1 barista vacancy through UI', () => createVacancyThroughUi(page, {
            title: baristaVacancyTitle,
            professionKey: 'barista',
            targetHires: 1
        }));
        const baristaApplication = await step('create barista application through UI', () => createApplicationThroughUi(page, baristaVacancy, {
            name: secondaryCandidateName,
            phone: '+380501230002'
        }));
        await step('move barista application to offer through UI', () => advanceApplicationToOffer(
            page,
            baristaApplication,
            secondaryCandidateName,
            baristaVacancy.id
        ));
        const secondHire = await step('add barista to existing employee and start profession onboarding through UI', () => hireThroughUi(
            page,
            baristaApplication,
            secondaryCandidateName,
            { mode: 'existing_staff', existingStaffId: staffId, responsibleUserId: hrSession.responsibleUserId }
        ));
        assert.equal(Number(secondHire.staff_id), staffId);
        assert.equal(secondHire.profession_key, 'barista');
        assert.equal(secondHire.vacancy_action, 'auto_filled_by_headcount');
        assert.equal(secondHire.vacancy_status, 'filled');
        assert.equal(Number(secondHire.hired_count), 1);

        await step('verify keep-open and auto-filled headcount states in HR UI', async () => {
            await reloadVacanciesWithStatus(page, 'all');
            const animatorCard = page.locator('#vacanciesList .hr-vacancy-card').filter({ hasText: animatorVacancyTitle });
            const baristaCard = page.locator('#vacanciesList .hr-vacancy-card').filter({ hasText: baristaVacancyTitle });
            await animatorCard.getByText('Найнято 1 із 2').waitFor();
            await animatorCard.getByText('🟢 Відкрита').waitFor();
            await baristaCard.getByText('Найнято 1 із 1').waitFor();
            await baristaCard.getByText('✅ Заповнена').waitFor();
        });

        const template = await step('create corporate onboarding template through real API', async () => {
            const body = await api(base, '/api/hr/onboarding/templates', {
                method: 'POST',
                token: hrSession.token,
                body: {
                    name: `Corporate ${RUN_ID}`,
                    department: 'qa',
                    items: [{ id: 1, title: 'Corporate rules' }]
                }
            });
            assert.ok(Number(body?.data?.id) > 0, 'corporate template id is returned');
            return body.data;
        });

        await step('open Training onboarding with two profession processes', async () => {
            await page.goto(`${base}/training.html`, { waitUntil: 'domcontentloaded' });
            await waitForAppShell(page, { requireCrmApiFetch: false });
            const onboardingResponsePromise = waitForApi(page, 'GET', '/api/hr/onboarding');
            await page.locator('[data-tab="onboarding"]').click();
            await responseJson(await onboardingResponsePromise, 'load onboarding processes');
            const group = page.locator('.training-onboarding-staff-group').filter({ hasText: primaryCandidateName });
            await group.waitFor();
            assert.equal(await group.locator('.training-onboarding-card').count(), 2);
            await group.getByText('Аніматор', { exact: true }).waitFor();
            await group.getByText('Бариста', { exact: true }).waitFor();
        });

        await step('start corporate onboarding through Training UI', async () => {
            await page.locator('#trainingStartOnboarding').click();
            const modal = await fillFormModal(page, {
                scope: 'general',
                staffId,
                templateId: template.id,
                responsibleUserId: hrSession.responsibleUserId
            });
            const responsePromise = waitForApi(page, 'POST', '/api/hr/onboarding/start');
            await modal.locator('.confirm-ok').click();
            const body = await responseJson(await responsePromise, 'start corporate onboarding');
            assert.equal(Number(body?.data?.staff_id), staffId);
            assert.equal(body?.data?.profession_key, null);
            const group = page.locator('.training-onboarding-staff-group').filter({ hasText: primaryCandidateName });
            await group.getByText('Загальний корпоративний онбординг', { exact: true }).waitFor();
            assert.equal(await group.locator('.training-onboarding-card').count(), 3);
        });

        const beforeProcesses = await api(base, `/api/hr/onboarding?staff_id=${staffId}`, { token: hrSession.token });
        const animatorBefore = findProcess(beforeProcesses.data, staffId, 'animator');
        const baristaBefore = findProcess(beforeProcesses.data, staffId, 'barista');
        assert.ok(animatorBefore && baristaBefore, 'both profession processes exist before checklist update');

        await step('complete one barista checklist item in Training UI', async () => {
            const group = page.locator('.training-onboarding-staff-group').filter({ hasText: primaryCandidateName });
            const baristaCard = group.locator('.training-onboarding-card').filter({ hasText: 'Бариста' });
            const checkbox = baristaCard.locator('[data-onboarding-check]:not(:checked)').first();
            await checkbox.waitFor({ state: 'visible' });
            const checklistPromise = waitForApi(page, 'PUT', `/api/hr/staff/${staffId}/profession-checklist`);
            await checkbox.check();
            const body = await responseJson(await checklistPromise, 'update barista profession checklist');
            assert.equal(body?.success, true);
            await page.waitForFunction(({ staffId }) => {
                const input = document.querySelector(`input[data-staff-id="${staffId}"][data-profession-key="barista"]`);
                return input?.checked === true;
            }, { staffId });
        });

        await step('verify animator readiness did not change', async () => {
            const afterProcesses = await api(base, `/api/hr/onboarding?staff_id=${staffId}`, { token: hrSession.token });
            const animatorAfter = findProcess(afterProcesses.data, staffId, 'animator');
            const baristaAfter = findProcess(afterProcesses.data, staffId, 'barista');
            assert.equal(Number(animatorAfter.completed_items), Number(animatorBefore.completed_items));
            assert.ok(Number(baristaAfter.completed_items) > Number(baristaBefore.completed_items));
            assert.notEqual(Number(animatorAfter.id), Number(baristaAfter.id));
        });

        const shiftDate = localDate();
        await step('persist segmented animator and barista schedule through real API', async () => {
            const body = await api(base, '/api/hr/shifts', {
                method: 'POST',
                token: hrSession.token,
                body: {
                    staff_id: staffId,
                    shift_date: shiftDate,
                    shift_type: 'regular',
                    primaryProfessionKey: 'animator',
                    segments: [
                        { professionKey: 'animator', shiftStart: '09:00', shiftEnd: '13:00', breakMinutes: 0 },
                        { professionKey: 'barista', shiftStart: '13:00', shiftEnd: '18:00', breakMinutes: 0 }
                    ]
                }
            });
            assert.equal(body?.success, true);
            assert.deepEqual(body.data.segments.map(segment => segment.professionKey), ['animator', 'barista']);
        });

        await step('verify both professions in real Schedule UI and API read-back', async () => {
            const schedule = await api(base, `/api/staff/schedule?from=${shiftDate}&to=${shiftDate}`, { token: hrSession.token });
            const row = (schedule.data || []).find(item => Number(item.staff_id) === staffId);
            assert.ok(row, 'schedule API returns hired employee');
            assert.deepEqual(row.segments.map(segment => segment.professionKey), ['animator', 'barista']);

            const activeStaff = await api(base, '/api/staff?active=true', { token: hrSession.token });
            assert.ok(
                (activeStaff.data || []).some(item => Number(item.id) === staffId),
                'active staff API returns hired employee for the Schedule UI'
            );

            await page.goto(`${base}/staff.html`, { waitUntil: 'domcontentloaded' });
            await waitForAppShell(page);
            const rows = page.locator(`[data-schedule-staff-row="${staffId}"]`);
            await rows.first().waitFor({ state: 'visible' });
            const rowTexts = await rows.allTextContents();
            const combined = rowTexts.join(' ');
            assert.match(combined, /Аніматор/);
            assert.match(combined, /Бариста/);
            const dayCells = page.locator(`.sch-cell[data-staff="${staffId}"][data-date="${shiftDate}"]`);
            await dayCells.first().waitFor({ state: 'visible' });
            const cellText = (await dayCells.allTextContents()).join(' ');
            assert.match(cellText, /Аніматор/);
            assert.match(cellText, /Бариста/);
        });

        assert.deepEqual(diagnostics.pageErrors, [], 'no pageerror events');
        assert.deepEqual(diagnostics.consoleErrors, [], 'no browser console errors');
        assert.deepEqual(diagnostics.apiFailures, [], 'no unexpected API statuses');
        assert.deepEqual(diagnostics.requestFailures, [], 'no failed local/API requests');
        process.stdout.write('HR onboarding full-stack browser smoke passed\n');
    } catch (error) {
        const artifactDir = path.join(ROOT, 'output', 'playwright', 'hr-onboarding-fullstack');
        fs.mkdirSync(artifactDir, { recursive: true });
        const screenshotPath = path.join(artifactDir, 'failure.png');
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        const pageState = await page.evaluate(() => ({
            url: location.href,
            title: document.title,
            bodyText: document.body?.innerText?.slice(0, 4000) || ''
        })).catch(() => ({}));
        const detail = {
            activeStep: diagnostics.activeStep,
            pageState,
            apiTrace: diagnostics.apiTrace.slice(-100),
            apiFailures: diagnostics.apiFailures,
            requestFailures: diagnostics.requestFailures,
            consoleErrors: diagnostics.consoleErrors,
            pageErrors: diagnostics.pageErrors,
            screenshot: screenshotPath
        };
        const diagnosticText = `Full-stack diagnostics: ${JSON.stringify(detail)}`;
        error.message += `\n${diagnosticText}`;
        error.stack = `${error.stack || error.message}\n${diagnosticText}`;
        throw error;
    } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

run().catch(error => {
    process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
    process.exitCode = 1;
});
