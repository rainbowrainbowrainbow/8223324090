'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { BASE_URL, authRequest } = require('../helpers');

test('Park admin edits professions and owns hiring records on migrated PostgreSQL', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true'
}, async () => {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    const username = 'qa_hiring_' + crypto.randomBytes(5).toString('hex');
    const password = crypto.randomBytes(24).toString('base64url');
    const created = await authRequest('POST', '/api/users', {
        username, password, name: 'Disposable hiring admin', role: 'admin',
        businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix'
    });
    assert.equal(created.status, 200);
    const db = new Client();
    await db.connect();
    try {
        const userId = (await db.query('SELECT id FROM users WHERE username = $1', [username])).rows[0].id;
        const organizationId = (await db.query(`INSERT INTO organizations (slug, name, status)
            VALUES ($1, 'Hiring fixture', 'active') RETURNING id`, [username])).rows[0].id;
        const businessId = (await db.query(`INSERT INTO businesses
            (organization_id, context_key, label, short_label, access_mode, modules, status)
            VALUES ($1,'event_genix','Hiring Park','Park','membership','[]'::jsonb,'active')
            ON CONFLICT (context_key) DO UPDATE SET organization_id=EXCLUDED.organization_id,
                access_mode='membership',status='active' RETURNING id`, [organizationId])).rows[0].id;
        await db.query(`INSERT INTO organization_memberships (organization_id,user_id,role,is_active)
            VALUES ($1,$2,'member',true)`, [organizationId,userId]);
        await db.query(`INSERT INTO business_memberships
            (business_id,organization_id,user_id,role,is_default,is_active)
            VALUES ($1,$2,$3,'admin',true,true)`, [businessId,organizationId,userId]);
        const loginResponse = await fetch(BASE_URL + '/api/auth/login', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        assert.equal(loginResponse.status, 200);
        const { token } = await loginResponse.json();
        const api = async (method, path, body, headers = {}) => {
            const response = await fetch(BASE_URL + path, { method,
                headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
                    'X-Business-Context': 'event_genix', ...headers },
                body: body ? JSON.stringify(body) : undefined });
            return { status: response.status, body: await response.json() };
        };
        const staff = (await db.query(`INSERT INTO staff (name,department,position,role_type)
            VALUES ('Hiring fixture','qa','Fixture','animator') RETURNING id`)).rows[0];
        const detail = await api('GET', '/api/hr/staff/' + staff.id);
        assert.equal(detail.status, 200);
        const saved = await api('PUT', '/api/hr/staff/' + staff.id,
            { role_type: 'cook', secondary_professions: ['waiter'] },
            { 'X-Staff-Profile-Revision': String(detail.body.data.profile_revision) });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.equal(saved.body.data.role_type, 'cook');
        const assignments = await api('GET', '/api/hr/staff/' + staff.id + '/role-assignments');
        assert.equal(assignments.status, 200);
        assert.ok(assignments.body.data.length > 0);
        assert.ok(assignments.body.data.every(row => !Object.hasOwn(row, 'hourly_rate')
            && !Object.hasOwn(row, 'payroll_scheme_id')));

        const vacancy = await api('POST', '/api/hr/vacancies', {
            title: 'Hiring fixture vacancy', role_type: 'animator', target_hires: 1
        });
        assert.equal(vacancy.status, 200, JSON.stringify(vacancy.body));
        const vacancyId = vacancy.body.vacancy.id;
        assert.equal(vacancy.body.vacancy.business_context, 'event_genix');
        const candidate = await api('POST', '/api/hr/vacancies/' + vacancyId + '/applications', {
            name: 'Disposable candidate', source: 'other'
        });
        assert.equal(candidate.status, 200, JSON.stringify(candidate.body));
        const applicationId = candidate.body.application.id;
        const form = new FormData();
        form.append('files', new Blob(['Disposable resume'], { type: 'text/plain' }), 'fixture.txt');
        const upload = await fetch(BASE_URL + '/api/hr/applications/' + applicationId + '/resume-files', {
            method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Business-Context': 'event_genix' },
            body: form
        });
        assert.equal(upload.status, 200, await upload.clone().text());
        const resume = (await db.query('SELECT id FROM job_application_resume_files WHERE application_id=$1',
            [applicationId])).rows[0];
        assert.ok(resume);
        const downloadPath = '/api/hr/applications/' + applicationId + '/resume-files/' + resume.id + '/download';
        const download = await fetch(BASE_URL + downloadPath, {
            headers: { Authorization: 'Bearer ' + token, 'X-Business-Context': 'event_genix' }
        });
        assert.equal(download.status, 200);
        assert.equal(await download.text(), 'Disposable resume');
        const secondCandidate = await api('POST', '/api/hr/vacancies/' + vacancyId + '/applications', {
            name: 'Second disposable candidate', source: 'other'
        });
        const mismatch = await api('GET', '/api/hr/applications/' + secondCandidate.body.application.id +
            '/resume-files/' + resume.id + '/download');
        assert.equal(mismatch.status, 404);
        const hire = await api('POST', '/api/hr/applications/' + applicationId + '/hire', {
            hire_mode: 'new_staff', department: 'qa', start_profession_onboarding: false
        });
        assert.equal(hire.status, 200, JSON.stringify(hire.body));
        const repeated = await api('POST', '/api/hr/applications/' + applicationId + '/hire', {
            hire_mode: 'new_staff'
        });
        assert.equal(repeated.status, 409);
        const hiredStageChange = await api('PATCH', '/api/hr/applications/' + applicationId, { status: 'rejected' });
        assert.equal(hiredStageChange.status, 409);
        const rejected = await api('PATCH', '/api/hr/applications/' + secondCandidate.body.application.id, {
            status: 'rejected'
        });
        assert.equal(rejected.status, 200);
        const unownedId = (await db.query(`INSERT INTO job_vacancies (title,role_type)
            VALUES ('Unowned fixture','animator') RETURNING id`)).rows[0].id;
        const foreignId = (await db.query(`INSERT INTO job_vacancies (title,role_type,business_context)
            VALUES ('Foreign fixture','animator','dar') RETURNING id`)).rows[0].id;
        for (const id of [unownedId, foreignId]) {
            const result = await api('POST', '/api/hr/vacancies/' + id + '/applications', { name: 'Forbidden' });
            assert.equal(result.status, 404);
        }
        const list = await api('GET', '/api/hr/vacancies?status=all');
        assert.equal(list.status, 200);
        assert.ok(list.body.vacancies.some(row => row.id === vacancyId));
        assert.ok(list.body.vacancies.every(row => row.business_context === 'event_genix'));
        const foreignContext = await api('GET', '/api/hr/vacancies?status=all', undefined,
            { 'X-Business-Context': 'dar' });
        assert.equal(foreignContext.status, 403);
        await db.query("UPDATE business_memberships SET action_denylist=ARRAY['hr.staff.manage'] WHERE user_id=$1", [userId]);
        const denied = await api('POST', '/api/hr/vacancies', { title: 'Forbidden', role_type: 'animator' });
        assert.equal(denied.status, 403);
        assert.equal(Number((await db.query("SELECT count(*) FROM job_vacancies WHERE title='Forbidden'")).rows[0].count), 0);
        await db.query("UPDATE business_memberships SET action_denylist='{}' WHERE user_id=$1", [userId]);
        if (process.env.HR_HIRING_BROWSER === 'true') {
            const { requirePlaywright } = require('../browser/hr-team-browser-smoke');
            const output = path.resolve(__dirname, '../../output/playwright/hr-hiring-actual');
            fs.mkdirSync(output, { recursive: true });
            const browser = await requirePlaywright().chromium.launch();
            try {
                for (const [width, theme] of [[1366, 'light'], [390, 'dark']]) {
                    const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
                    await page.addInitScript(({ token, theme }) => {
                        localStorage.setItem('pzp_token', token);
                        localStorage.setItem('pzp_dark_mode', String(theme === 'dark'));
                        localStorage.setItem('pzp_crm_business_context', 'event_genix');
                    }, { token, theme });
                    await page.goto(BASE_URL + '/hr#workers', { waitUntil: 'domcontentloaded' });
                    await page.locator('.hr-team-card[data-staff-id="' + staff.id + '"]').waitFor();
                    assert.equal(await page.locator('#hrNav .hr-tab[data-bucket]').count(), 5);
                    await page.locator('.hr-team-card[data-staff-id="' + staff.id + '"] .hr-team-open').click();
                    await page.locator('#staffProfileTabWork').click();
                    await page.waitForFunction(() => !document.getElementById('editRoleType').disabled);
                    await page.locator('#editRoleType').selectOption(width === 1366 ? 'barista' : 'cook');
                    if (width === 1366) {
                        await page.locator('#editSecondaryProfessionSearch').fill('Аніматор');
                        await page.locator('[data-secondary-add="animator"]').click();
                    } else {
                        await page.locator('[data-secondary-remove="animator"]').click();
                    }
                    await page.locator('#editSaveWork').click();
                    await page.waitForFunction(() => document.getElementById('editSaveWork').dataset.actionState === 'success');
                    const refreshed = (await api('GET', '/api/hr/staff/' + staff.id)).body.data;
                    assert.equal(refreshed.role_type, width === 1366 ? 'barista' : 'cook');
                    assert.equal(refreshed.secondary_professions.includes('animator'), width === 1366);
                    assert.equal(await page.locator('#editStaffHeaderRole').textContent(), width === 1366 ? 'Бариста' : 'Кухар');
                    await page.waitForFunction(() => document.getElementById('staffProfilePanelWork').dataset.loadState === 'ready');
                    await page.screenshot({ path: path.join(output, 'professions-' + width + '-' + theme + '.png') });
                    await page.goto(BASE_URL + '/hr#other', { waitUntil: 'domcontentloaded' });
                    await page.getByText('Вакансій немає.', { exact: false }).waitFor();
                    await page.locator('#vacStatusFilter').selectOption('filled');
                    const vacancyButton = page.getByRole('button', { name: 'Hiring fixture vacancy', exact: true });
                    await vacancyButton.focus();
                    await vacancyButton.press('Enter');
                    const kanban = page.locator('#candidatesKanban');
                    await kanban.getByText('Disposable candidate', { exact: true }).waitFor();
                    assert.equal(await kanban.locator('.kanban-col').count(), 6);
                    await kanban.locator('.kanban-col').filter({ hasText: 'Найнятий' })
                        .getByText('Disposable candidate', { exact: true }).waitFor();
                    await kanban.locator('.kanban-col').filter({ hasText: 'Відхилено' })
                        .getByText('Second disposable candidate', { exact: true }).waitFor();
                    for (const tab of ['responses', 'interviews', 'templates']) {
                        const control = page.locator(`[data-vacancy-tab="${tab}"]`);
                        await control.focus();
                        await control.press('Enter');
                        assert.equal(await control.getAttribute('aria-selected'), 'true');
                        assert.equal(await page.locator(`[data-vacancy-panel="${tab}"]`).isVisible(), true);
                        if (tab === 'interviews') {
                            const interview = page.locator('.vacancy-interview-row').filter({ has: page.getByRole('heading', { name: 'Disposable candidate', exact: true }) });
                            await interview.getByRole('button', { name: 'Запис співбесіди' }).click();
                            await page.locator('#fm_date').fill('2026-11-13');
                            await page.locator('#fm_notes').fill('Synthetic interview result');
                            await page.locator('.form-modal-overlay').getByRole('button', { name: 'Зберегти' }).click();
                            await interview.getByText('Synthetic interview result', { exact: true }).waitFor();
                        }
                    }
                    await page.locator('[data-vacancy-tab="vacancies"]').click();
                    await page.screenshot({ path: path.join(output, 'hiring-' + width + '-' + theme + '.png') });
                    await page.close();
                }
            } finally {
                await browser.close();
            }
        }
    } finally {
        await db.end();
    }
});
